import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import {
  type CommandResult,
  decide,
  decidePulse,
  type PulseCommand,
  type PulseCommandResult,
  PulseId,
  pulsesView,
  pulseView,
  defaultSendPolicy,
  type DeliveryEventKind,
  type DirectoryCommand,
  type EmailAddress,
  type FollowUp,
  makeSendStore,
  type PersonId,
  type SendId,
  type SendOutcome,
  settingsView,
  TeamId,
  teamsView,
  teamView,
  teamSummaryOf,
  type TransactionalEmail,
  calculateRoundInstants,
  nextEightWeeksCadenceDates,
  nextWeekdayDate,
  parseDateIso,
  RoundId,
  JobId,
  type RoundRecord,
  type RoundSummary,
  type RoundDetail,
  type RoundList,
  type RoundCommand,
  type RoundCommandResult,
  type RoundViewed,
  authorizeRoundAction,
  type FrozenRoundMember,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Scope from "effect/Scope";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlPulses } from "./SqlPulses.ts";
import { makeSqlRounds } from "./SqlRounds.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

/**
 * Relative to the directory Alchemy runs in, which is the repository root (`pnpm infra:deploy`, `pnpm test`).
 * It must be a literal: the same expression runs again inside the bundle, where `import.meta.url` differs.
 */
const migrationsDirectory = "packages/cloudflare/migrations";

const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

/**
 * The Organization Durable Object (ADR 0006): one object per Organization, SQLite storage.
 * Methods return plain data (no `Option`), because they cross the RPC boundary.
 * The Main Worker maps it to the domain schemas.
 */
export default class Organization extends Cloudflare.DurableObject<Organization>()(
  "Organization",
  Effect.gen(function* () {
    // Outer phase: capture the SQL files into the bundle.
    const migrations = yield* Cloudflare.SqlMigrations(migrationsDirectory);

    // Inner phase: runs once per object activation, before any method is exposed.
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;

      // Pass `storage` (not just `db`) so `withTransaction` uses `storage.transaction()`.
      const scope = yield* Scope.make();
      const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provide(Reactivity.layer),
      );

      yield* migrations.apply().pipe(Effect.orDie);

      // Transactional email: the domain's SendStore on this object's `email_send` table.
      const sends = makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy);
      // People, Teams, and Memberships: the domain decides, this object loads and applies.
      const directory = makeSqlDirectory(sql, sends);
      // The question library and Pulses, decided against the directory (roles, Teams, N).
      const pulses = makeSqlPulses(sql);
      // Round lifecycle engine and schedule table (ADR 0006).
      const rounds = makeSqlRounds(sql);
      const both = Effect.all([directory.load, pulses.load]);

      /** Only sends still waiting go back to the queue; one already sent or failed stays as it is. */
      const pendingOnly = (followUps: ReadonlyArray<FollowUp>) =>
        Effect.filter(followUps, (step) =>
          step._tag === "QueueEmail"
            ? sends
                .get(step.sendId)
                .pipe(Effect.map((record) => record._tag === "Some" && record.value.state._tag === "Pending"))
            : Effect.succeed(true),
        );

      /** Arms the DO alarm to the earliest pending job due time, or deletes the alarm if none pending. */
      const repairAlarm = () =>
        Effect.gen(function* () {
          const earliest = yield* rounds.getEarliestPendingJobDueAt();
          if (earliest !== null) {
            const currentAlarm = yield* Effect.promise(() => state.raw.storage.getAlarm());
            if (currentAlarm !== earliest) {
              yield* Effect.promise(() => state.raw.storage.setAlarm(earliest));
            }
          } else {
            yield* Effect.promise(() => state.raw.storage.deleteAlarm());
          }
        }).pipe(Effect.orDie);

      /** Schedules the next Round for a Pulse, keyed by (pulse_id, planned_open_date). */
      const scheduleNextRound = (pulseId: PulseId, teamId: TeamId, now: number) =>
        Effect.gen(function* () {
          const paused = yield* rounds.isPulsePaused(pulseId);
          if (paused) return;

          const existingScheduled = yield* rounds.findScheduledRound(pulseId);
          if (existingScheduled !== null) return;

          const [dirState, pulseState] = yield* both;
          const pulse = pulseState.pulses.find((p) => p.id === pulseId);
          if (pulse === undefined) return;
          const team = dirState.teams.find((t) => t.id === teamId);
          if (team === undefined) return;

          const activeMembers = dirState.memberships.filter(
            (m) => m.teamId === teamId && m.endedAt === null && (m.role === "lead" || m.role === "member"),
          );
          // Seam: Person time zone override if it exists; otherwise Team time zone.
          const memberTimeZones = activeMembers.map(() => team.timeZone);
          const skipped = yield* rounds.getSkippedWeeks(pulseId);

          const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: team.timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const parts: Record<string, string> = {};
          for (const p of dtf.formatToParts(new Date(now))) {
            parts[p.type] = p.value;
          }
          const curYear = parseInt(parts.year ?? "0", 10);
          const curMonth = parseInt(parts.month ?? "0", 10);
          const curDay = parseInt(parts.day ?? "0", 10);

          let candidateDate = nextWeekdayDate(curYear, curMonth, curDay, pulse.settings.cadence.day, true);
          let instants = calculateRoundInstants(
            candidateDate,
            pulse.settings.cadence.time,
            memberTimeZones,
            team.timeZone,
            pulse.settings.answerWindowDays,
          );

          if (instants.openInstant <= now) {
            candidateDate = nextWeekdayDate(curYear, curMonth, curDay, pulse.settings.cadence.day, false);
            instants = calculateRoundInstants(
              candidateDate,
              pulse.settings.cadence.time,
              memberTimeZones,
              team.timeZone,
              pulse.settings.answerWindowDays,
            );
          }

          while (skipped.has(candidateDate)) {
            const p = parseDateIso(candidateDate);
            const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + 7 * 86_400_000);
            candidateDate = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;
            instants = calculateRoundInstants(
              candidateDate,
              pulse.settings.cadence.time,
              memberTimeZones,
              team.timeZone,
              pulse.settings.answerWindowDays,
            );
          }

          const roundId = RoundId.make(randomId());
          const round: RoundRecord = {
            id: roundId,
            pulseId,
            teamId,
            status: "scheduled",
            plannedOpenDate: candidateDate,
            plannedOpenAt: instants.openInstant,
            openedAt: null,
            plannedCloseAt: instants.closeInstant,
            closedAt: null,
            effectiveMinimumGroupSize: null,
            pulseName: pulse.settings.name,
            answerWindowDays: pulse.settings.answerWindowDays,
            reminders: pulse.settings.reminders,
            anonymityMode: pulse.settings.anonymityMode,
            distribution: pulse.settings.distribution,
            createdAt: now,
            updatedAt: now,
          };

          yield* rounds.insertRound(round);
          yield* rounds.insertJob({
            id: JobId.make(randomId()),
            roundId,
            type: "open",
            dueAt: instants.openInstant,
            status: "pending",
            payload: null,
            createdAt: now,
            completedAt: null,
          });

          yield* repairAlarm();
        });

      /** Updates the Scheduled Round's planned times and settings when Pulse settings change. */
      const updateScheduledRoundForPulse = (pulseId: PulseId, now: number) =>
        Effect.gen(function* () {
          const scheduled = yield* rounds.findScheduledRound(pulseId);
          if (scheduled === null) return;

          const [dirState, pulseState] = yield* both;
          const pulse = pulseState.pulses.find((p) => p.id === pulseId);
          if (pulse === undefined) return;
          const team = dirState.teams.find((t) => t.id === scheduled.teamId);
          if (team === undefined) return;

          const activeMembers = dirState.memberships.filter(
            (m) =>
              m.teamId === scheduled.teamId &&
              m.endedAt === null &&
              (m.role === "lead" || m.role === "member"),
          );
          const memberTimeZones = activeMembers.map(() => team.timeZone);

          const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone: team.timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const parts: Record<string, string> = {};
          for (const p of dtf.formatToParts(new Date(now))) {
            parts[p.type] = p.value;
          }
          const curYear = parseInt(parts.year ?? "0", 10);
          const curMonth = parseInt(parts.month ?? "0", 10);
          const curDay = parseInt(parts.day ?? "0", 10);

          let candidateDate = nextWeekdayDate(curYear, curMonth, curDay, pulse.settings.cadence.day, true);
          let instants = calculateRoundInstants(
            candidateDate,
            pulse.settings.cadence.time,
            memberTimeZones,
            team.timeZone,
            pulse.settings.answerWindowDays,
          );

          if (instants.openInstant <= now) {
            candidateDate = nextWeekdayDate(curYear, curMonth, curDay, pulse.settings.cadence.day, false);
            instants = calculateRoundInstants(
              candidateDate,
              pulse.settings.cadence.time,
              memberTimeZones,
              team.timeZone,
              pulse.settings.answerWindowDays,
            );
          }

          yield* rounds.updateScheduledRound(
            scheduled.id,
            pulse.settings.name,
            pulse.settings.answerWindowDays,
            pulse.settings.reminders,
            instants.openInstant,
            instants.closeInstant,
            now,
          );
          yield* rounds.updateJobDueAt(scheduled.id, "open", instants.openInstant);
          yield* repairAlarm();
        });

      /** Idempotent DO method: opens a Round, freezes questions and members, schedules close & next Round. */
      const executeOpenJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null || round.status !== "scheduled") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const [dirState, pulseState] = yield* both;
          const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
          const team = dirState.teams.find((t) => t.id === round.teamId);
          if (pulse === undefined || team === undefined) {
            yield* rounds.cancelRound(roundId, now);
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const activeMembers = dirState.memberships.filter(
            (m) =>
              m.teamId === round.teamId && m.endedAt === null && (m.role === "lead" || m.role === "member"),
          );
          const memberTimeZones = activeMembers.map(() => team.timeZone);

          const instants = calculateRoundInstants(
            round.plannedOpenDate,
            pulse.settings.cadence.time,
            memberTimeZones,
            team.timeZone,
            round.answerWindowDays,
          );

          const frozenMembers: ReadonlyArray<FrozenRoundMember> = activeMembers.map((m) => {
            const sendAt =
              instants.sends.find((s) => s.timeZone === team.timeZone)?.sendAt ?? instants.openInstant;
            return {
              roundId,
              personId: m.personId,
              timeZone: team.timeZone,
              sendAt,
            };
          });

          // Freezes eligible members and question versions in storage.
          yield* rounds.openRound(roundId, now, instants.closeInstant, pulse.questions, frozenMembers);

          // Slice 08 seam: invitations and emails will be dispatched here. Currently records open.
          yield* rounds.insertJob({
            id: JobId.make(randomId()),
            roundId,
            type: "close",
            dueAt: instants.closeInstant,
            status: "pending",
            payload: null,
            createdAt: now,
            completedAt: null,
          });

          yield* rounds.markJobCompleted(jobId, now);

          // Create the next Scheduled Round right then
          yield* scheduleNextRound(round.pulseId, round.teamId, now);
        });

      /** Idempotent DO method: closes an Open Round, stores effective N, enqueues computeResult. */
      const executeCloseJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null || round.status !== "open") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const dirState = yield* directory.load;
          // Stricter of Organization's current N and round's stored N (ADR 0004)
          const effectiveN = Math.max(
            dirState.minimumGroupSize,
            round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
          );

          yield* rounds.closeRound(roundId, now, effectiveN);
          yield* rounds.cancelJobsForRound(roundId, ["send", "remind"]);
          yield* rounds.markJobCompleted(jobId, now);

          // Enqueue computeResult through stub (slice 11 stub)
          const computeJobId = JobId.make(randomId());
          yield* rounds.insertJob({
            id: computeJobId,
            roundId,
            type: "compute",
            dueAt: now,
            status: "pending",
            payload: null,
            createdAt: now,
            completedAt: null,
          });

          yield* executeComputeJob(computeJobId, roundId, now);
        });

      /** Idempotent DO method: computes result (stub in slice 07), moves to Ready then Shared. */
      const executeComputeJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null || round.status !== "closed") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // Slice 11 stub: compute Result, transition to Ready and immediately in R1 to Shared.
          yield* rounds.markRoundReadyAndShared(roundId, now);
          yield* rounds.markJobCompleted(jobId, now);
        });

      /** Processes all jobs currently due from the schedule table, then updates the alarm. */
      const runDueJobs = (nowMs?: number) =>
        Effect.gen(function* () {
          const now = nowMs ?? (yield* Clock.currentTimeMillis);
          while (true) {
            const dueJobs = yield* rounds.getDueJobs(now);
            if (dueJobs.length === 0) break;
            for (const job of dueJobs) {
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  if (job.type === "open") {
                    yield* executeOpenJob(job.id, job.roundId, now);
                  } else if (job.type === "close") {
                    yield* executeCloseJob(job.id, job.roundId, now);
                  } else if (job.type === "compute") {
                    yield* executeComputeJob(job.id, job.roundId, now);
                  }
                }),
              );
            }
          }
          yield* repairAlarm();
        }).pipe(Effect.orDie);

      return {
        alarm: () =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* runDueJobs(now);
          }).pipe(Effect.orDie),

        create: (id: string, name: string) =>
          sql
            .withTransaction(sql`INSERT INTO organization (id, name) VALUES (${id}, ${name})`)
            .pipe(Effect.as({ id, name }), Effect.orDie),

        /** Idempotent: the Organization and its creator as its first Person (an Organization admin in WorkOS). */
        createWithAdmin: (id: string, name: string, personId: string, email: string, workosUserId: string) =>
          sql
            .withTransaction(
              Effect.all([
                sql`INSERT INTO organization (id, name) VALUES (${id}, ${name}) ON CONFLICT (id) DO NOTHING`,
                sql`INSERT INTO person (id, email, workos_user_id, organization_admin)
                    VALUES (${personId}, ${email}, ${workosUserId}, 1)
                    ON CONFLICT (id) DO NOTHING`,
              ]),
            )
            .pipe(Effect.asVoid, Effect.orDie),

        linkPerson: (personId: string, workosUserId: string, email: string) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const other = yield* sql<{ id: string }>`
                  SELECT id FROM person WHERE workos_user_id = ${workosUserId} AND id <> ${personId}`;
                if (other.length > 0) return false;
                yield* sql`
                  UPDATE person SET workos_user_id = ${workosUserId}
                   WHERE id = ${personId} AND email = ${email} AND removed_at IS NULL AND workos_user_id IS NULL`;
                const linked = yield* sql<{ id: string }>`
                  SELECT id FROM person
                   WHERE id = ${personId} AND workos_user_id = ${workosUserId} AND removed_at IS NULL`;
                return linked.length > 0;
              }),
            )
            .pipe(Effect.orDie),

        activePerson: (workosUserId: string) =>
          sql<{ id: string; organization_admin: number }>`
            SELECT id, organization_admin FROM person
             WHERE workos_user_id = ${workosUserId} AND removed_at IS NULL`.pipe(
            Effect.map((rows) => {
              const row = rows[0];
              return row === undefined
                ? null
                : { id: row.id, organizationAdmin: row.organization_admin === 1 };
            }),
            Effect.orDie,
          ),

        runDirectoryCommand: (actorId: PersonId, command: DirectoryCommand, now: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const decision = decide(yield* directory.load, actorId, command, now);
                if (decision._tag === "Rejected") return decision satisfies CommandResult;
                yield* directory.apply(decision.changes);
                return {
                  _tag: "Accepted",
                  followUps: yield* pendingOnly(decision.followUps),
                } satisfies CommandResult;
              }),
            )
            .pipe(Effect.orDie),
        viewTeams: (actorId: PersonId) =>
          directory.load.pipe(Effect.map((state) => teamsView(state, actorId))),
        viewTeam: (actorId: PersonId, teamId: TeamId) =>
          directory.load.pipe(Effect.map((state) => teamView(state, actorId, teamId))),
        viewSettings: (actorId: PersonId) =>
          directory.load.pipe(Effect.map((state) => settingsView(state, actorId))),

        runPulseCommand: (actorId: PersonId, command: PulseCommand, now: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const [people, library] = yield* both;
                const decision = decidePulse(people, library, actorId, command, now);
                if (decision._tag === "Rejected") return decision satisfies PulseCommandResult;
                yield* pulses.apply(decision.changes);

                if (command._tag === "CreatePulse") {
                  yield* scheduleNextRound(command.pulseId, command.teamId, now);
                } else if (command._tag === "UpdatePulseSettings") {
                  yield* updateScheduledRoundForPulse(command.pulseId, now);
                }

                return { _tag: "Accepted" } satisfies PulseCommandResult;
              }),
            )
            .pipe(Effect.orDie),
        viewPulses: (actorId: PersonId, teamId: TeamId) =>
          both.pipe(Effect.map(([people, library]) => pulsesView(people, library, actorId, teamId))),
        viewPulse: (actorId: PersonId, teamId: TeamId, pulseId: PulseId) =>
          both.pipe(Effect.map(([people, library]) => pulseView(people, library, actorId, teamId, pulseId))),

        /** Lead controls: skip, pause, resume, close early, cancel. Authorised through permission table. */
        runRoundCommand: (actorId: PersonId, command: RoundCommand, now: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const [dirState, pulseState] = yield* both;
                const auth = authorizeRoundAction(dirState, actorId, "team.manageRounds", command.teamId);
                if (auth._tag === "Rejected") return auth satisfies RoundCommandResult;

                switch (command._tag) {
                  case "SkipWeek": {
                    const team = dirState.teams.find((t) => t.id === command.teamId);
                    const pulse = pulseState.pulses.find((p) => p.id === command.pulseId);
                    if (team === undefined) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "TeamNotFound" },
                      } satisfies RoundCommandResult;
                    }
                    if (pulse === undefined) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "PulseNotFound" },
                      } satisfies RoundCommandResult;
                    }

                    const validWeeks = nextEightWeeksCadenceDates(
                      now,
                      pulse.settings.cadence.day,
                      team.timeZone,
                    );
                    if (!validWeeks.includes(command.plannedOpenDate)) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "WeekOutOfRange" },
                      } satisfies RoundCommandResult;
                    }

                    yield* rounds.skipWeek(command.pulseId, command.plannedOpenDate, now);
                    const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                    if (scheduled !== null && scheduled.plannedOpenDate === command.plannedOpenDate) {
                      yield* rounds.cancelRound(scheduled.id, now);
                      yield* rounds.cancelJobsForRound(scheduled.id);
                      yield* scheduleNextRound(command.pulseId, command.teamId, now);
                    }
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "UnskipWeek": {
                    yield* rounds.unskipWeek(command.pulseId, command.plannedOpenDate);
                    const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                    const open = yield* rounds.findOpenRound(command.pulseId);
                    if (scheduled === null && open === null) {
                      yield* scheduleNextRound(command.pulseId, command.teamId, now);
                    }
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "PausePulse": {
                    yield* rounds.pausePulse(command.pulseId, now);
                    const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                    if (scheduled !== null) {
                      yield* rounds.cancelRound(scheduled.id, now);
                      yield* rounds.cancelJobsForRound(scheduled.id);
                    }
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "ResumePulse": {
                    yield* rounds.resumePulse(command.pulseId);
                    const scheduled = yield* rounds.findScheduledRound(command.pulseId);
                    const open = yield* rounds.findOpenRound(command.pulseId);
                    if (scheduled === null && open === null) {
                      yield* scheduleNextRound(command.pulseId, command.teamId, now);
                    }
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "CloseRoundEarly": {
                    const round = yield* rounds.getRound(command.roundId);
                    if (round === null || round.teamId !== command.teamId) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "RoundNotFound" },
                      } satisfies RoundCommandResult;
                    }
                    if (round.status !== "open") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "RoundNotOpen" },
                      } satisfies RoundCommandResult;
                    }

                    const effectiveN = Math.max(
                      dirState.minimumGroupSize,
                      round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
                    );
                    yield* rounds.closeRound(round.id, now, effectiveN);
                    yield* rounds.cancelJobsForRound(round.id, ["send", "remind", "close"]);

                    const computeJobId = JobId.make(randomId());
                    yield* rounds.insertJob({
                      id: computeJobId,
                      roundId: round.id,
                      type: "compute",
                      dueAt: now,
                      status: "pending",
                      payload: null,
                      createdAt: now,
                      completedAt: null,
                    });
                    yield* executeComputeJob(computeJobId, round.id, now);
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "CancelRound": {
                    const round = yield* rounds.getRound(command.roundId);
                    if (round === null || round.teamId !== command.teamId) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "RoundNotFound" },
                      } satisfies RoundCommandResult;
                    }
                    if (round.status !== "scheduled" && round.status !== "open") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "InvalidRoundState", status: round.status },
                      } satisfies RoundCommandResult;
                    }

                    yield* rounds.cancelRound(round.id, now);
                    yield* rounds.cancelJobsForRound(round.id);
                    yield* rounds.deleteSubmissionsAndParticipationsSeam(round.id);
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }
                }
              }),
            )
            .pipe(Effect.orDie),

        viewRounds: (
          actorId: PersonId,
          teamId: TeamId,
          pulseId: PulseId,
        ): Effect.Effect<RoundViewed<RoundList>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewRounds", teamId);
            if (auth._tag === "Rejected") {
              const rejected: RoundViewed<RoundList> = auth;
              return rejected;
            }
            const all = yield* rounds.getRoundsForPulse(pulseId);
            const viewed: RoundViewed<RoundList> = {
              _tag: "Viewed",
              value: {
                pulseId,
                rounds: all.map((r): RoundSummary => ({
                  id: r.id,
                  pulseId: r.pulseId,
                  teamId: r.teamId,
                  status: r.status,
                  plannedOpenDate: r.plannedOpenDate,
                  plannedOpenAt: r.plannedOpenAt,
                  openedAt: r.openedAt,
                  plannedCloseAt: r.plannedCloseAt,
                  closedAt: r.closedAt,
                  pulseName: r.pulseName,
                })),
              },
            };
            return viewed;
          }).pipe(Effect.orDie),

        viewRound: (
          actorId: PersonId,
          teamId: TeamId,
          roundId: RoundId,
        ): Effect.Effect<RoundViewed<RoundDetail>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewRounds", teamId);
            if (auth._tag === "Rejected") {
              const rejected: RoundViewed<RoundDetail> = auth;
              return rejected;
            }
            const team = dirState.teams.find((t) => t.id === teamId);
            if (team === undefined) {
              const rejected: RoundViewed<RoundDetail> = {
                _tag: "Rejected",
                rejection: { _tag: "TeamNotFound" },
              };
              return rejected;
            }
            const r = yield* rounds.getRound(roundId);
            if (r === null || r.teamId !== teamId) {
              const rejected: RoundViewed<RoundDetail> = {
                _tag: "Rejected",
                rejection: { _tag: "RoundNotFound" },
              };
              return rejected;
            }
            const questions = yield* rounds.getRoundQuestions(roundId);
            const viewed: RoundViewed<RoundDetail> = {
              _tag: "Viewed",
              value: {
                id: r.id,
                pulseId: r.pulseId,
                team: teamSummaryOf(team, auth.actor),
                status: r.status,
                plannedOpenDate: r.plannedOpenDate,
                plannedOpenAt: r.plannedOpenAt,
                openedAt: r.openedAt,
                plannedCloseAt: r.plannedCloseAt,
                closedAt: r.closedAt,
                effectiveMinimumGroupSize: r.effectiveMinimumGroupSize,
                pulseName: r.pulseName,
                answerWindowDays: r.answerWindowDays,
                reminders: r.reminders,
                anonymityMode: r.anonymityMode,
                distribution: r.distribution,
                questions,
                createdAt: r.createdAt,
              },
            };
            return viewed;
          }).pipe(Effect.orDie),

        runDueJobs: (now?: number) => runDueJobs(now),

        runScheduleJob: (jobId: string, nowMs?: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const job = yield* rounds.getJob(JobId.make(jobId));
                if (job === null || job.status !== "pending") return;
                const now = nowMs ?? (yield* Clock.currentTimeMillis);
                if (job.type === "open") {
                  yield* executeOpenJob(job.id, job.roundId, now);
                } else if (job.type === "close") {
                  yield* executeCloseJob(job.id, job.roundId, now);
                } else if (job.type === "compute") {
                  yield* executeComputeJob(job.id, job.roundId, now);
                }
                yield* repairAlarm();
              }),
            )
            .pipe(Effect.orDie),

        repairAlarm: () => repairAlarm(),
        getAlarm: () => Effect.promise(() => state.raw.storage.getAlarm()).pipe(Effect.orDie),
        scheduleNextRound: (pulseId: string, teamId: string, now: number) =>
          scheduleNextRound(PulseId.make(pulseId), TeamId.make(teamId), now),
        getEarliestPendingJobDueAt: () => rounds.getEarliestPendingJobDueAt(),
        getRoundsCount: (pulseId: string) =>
          sql<{ count: number }>`SELECT count(*) as count FROM round WHERE pulse_id = ${pulseId}`.pipe(
            Effect.map((rows) => rows[0]?.count ?? 0),
            Effect.orDie,
          ),
        getJob: (jobId: string) => rounds.getJob(JobId.make(jobId)),
        getRound: (roundId: string) => rounds.getRound(RoundId.make(roundId)),
        getJobsForRound: (roundId: string) =>
          sql<{
            id: string;
            type: string;
            status: string;
            due_at: number;
          }>`SELECT id, type, status, due_at FROM schedule_job WHERE round_id = ${roundId} ORDER BY due_at ASC`.pipe(
            Effect.orDie,
          ),

        get: (id: string) =>
          sql<{ id: string; name: string }>`SELECT id, name FROM organization WHERE id = ${id}`.pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.orDie,
          ),

        createEmailSend: (id: SendId, recipient: EmailAddress, email: TransactionalEmail) =>
          sends.create(id, recipient, email),
        getEmailSend: (id: SendId) => sends.get(id).pipe(Effect.map(Option.getOrNull)),
        claimEmailSend: (id: SendId, now: number) => sends.claim(id, now),
        settleEmailSend: (id: SendId, attempt: number, outcome: SendOutcome, now: number) =>
          sends.settle(id, attempt, outcome, now).pipe(Effect.map(Option.getOrNull)),
        abandonEmailSend: (id: SendId, now: number) =>
          sends.abandon(id, now).pipe(Effect.map(Option.getOrNull)),
        recordEmailDeliveryEvent: (id: SendId, kind: DeliveryEventKind, code: string | null, now: number) =>
          sends.recordDeliveryEvent(id, kind, code, now).pipe(Effect.map(Option.getOrNull)),
      };
    });
  }),
) {}
