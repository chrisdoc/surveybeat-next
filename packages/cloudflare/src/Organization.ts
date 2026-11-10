import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import {
  type CommandResult,
  decide,
  decidePulse,
  decideTestSend,
  type PulseCommand,
  type PulseCommandResult,
  PulseId,
  pulsesView,
  pulseView,
  type TestSendResult,
  testInvitationLifetimeMs,
  testSendsPerHour,
  defaultSendPolicy,
  type DeliveryEventKind,
  type DirectoryCommand,
  DEFAULT_LOCALE,
  type DirectoryState,
  type EmailAddress,
  emailLocaleOf,
  type FollowUp,
  Locale,
  makeSendStore,
  PersonId,
  SendId,
  type SendOutcome,
  settingsView,
  TeamId,
  teamsView,
  teamView,
  teamSummaryOf,
  type TransactionalEmail,
  calculateReminders,
  calculateResultsReadyDeliveryTime,
  calculateRoundInstants,
  deriveInvitationToken,
  deriveTestInvitationToken,
  hashToken,
  importInvitationTokenKey,
  type InvitationTokenRef,
  type StoredEmail,
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
  type PulseRecord,
  type PulseState,
  type SubmissionAnswer,
  calculateRoundResult,
  enforceEffectiveNOnResult,
  type RoundResult,
  ActionId,
  type ActionItem,
  type ActionList,
  type CreateAction,
  type UpdateAction,
  type ActionViewed,
  buildMemberHistory,
  buildTeamOverview,
  type MemberHistory,
  type TeamOverview,
  AiClient,
  buildThemesInput,
  runThemesAttempt,
  shouldRequestThemes,
  viewRoundResult,
  delayedRoundResult,
  nextRetryAt,
  type NoteViewed,
  type RoundNoteView,
  noteChange,
  previewAnswers,
  testSubmissionContext,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { makeOpenRouterAiClient } from "./ai/OpenRouterAiClient.ts";
import { makeSqlActions } from "./SqlActions.ts";
import { makeSqlNotes } from "./SqlNotes.ts";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlPulses } from "./SqlPulses.ts";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

/**
 * Relative to the directory Alchemy runs in, which is the repository root (`pnpm infra:deploy`, `pnpm test`).
 * It must be a literal: the same expression runs again inside the bundle, where `import.meta.url` differs.
 */
const migrationsDirectory = "packages/cloudflare/migrations";

/** A stored language the schema's CHECK constraints admit; anything else is read as unset. */
const localeOrNull = (value: string | null): Locale | null => (Schema.is(Locale)(value) ? value : null);
const localeOr = (value: string | null, fallback: Locale): Locale =>
  Schema.is(Locale)(value) ? value : fallback;

/**
 * The lease a themes job takes while its network call is in flight: its due time moves this far ahead, so a
 * concurrent alarm or request cannot start a second call. If the object dies mid-call, the job retries after it.
 */
const THEMES_LEASE_MS = 10 * 60_000;

/** Origin used in email links when the stage has no custom hostname (never delivered for real). */
const fallbackAppOrigin = "https://app.invalid";

const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

const TestSendCount = Schema.Struct({ n: Schema.Int });

const AttemptsPayload = Schema.Struct({ attempts: Schema.Int });
const parseAttempts = (payload: string | null): number => {
  if (payload === null) return 0;
  try {
    const p: unknown = JSON.parse(payload);
    const decoded = Schema.decodeUnknownOption(AttemptsPayload)(p);
    return Option.match(decoded, {
      onNone: () => 0,
      onSome: (val) => val.attempts,
    });
  } catch {
    return 0;
  }
};

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

      // The app's public origin, bound by the Main Worker from the stage (`MainWorker.ts`). Stages without
      // a custom hostname live on workers.dev, whose URL is not known at declaration time. They never send
      // real email (docs/infra.md), so their links fall back to a reserved .invalid origin (the email schema requires https) rather than production.
      const appOrigin = yield* Config.String("APP_ORIGIN").pipe(
        Config.withDefault(fallbackAppOrigin),
        Effect.orDie,
      );

      // Invitation tokens are derived from this key, never stored (issue 42): only their hashes are.
      const invitationKey = yield* Config.Redacted("INVITATION_TOKEN_KEY").pipe(
        Effect.flatMap((secret) => Effect.promise(() => importInvitationTokenKey(Redacted.value(secret)))),
        Effect.orDie,
      );
      const tokenOf = (ref: InvitationTokenRef) =>
        Effect.promise(() => deriveInvitationToken(invitationKey, ref));

      // The OpenRouter key for the Comment themes call (ADR 0015). Empty on stages without it: the call then
      // fails closed with AiNotConfigured. Provided only where the themes attempt runs, never to other code.
      const aiKey = yield* Config.Redacted("OPENROUTER_API_KEY").pipe(
        Config.withDefault(Redacted.make("")),
        Effect.orDie,
      );
      const ai = makeOpenRouterAiClient(aiKey);

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
      const rounds = makeSqlRounds(sql, secureRandomBytes);
      // Actions committed from Results (slice 13).
      const actions = makeSqlActions(sql);
      // The Lead's Note on a Round (R2 04).
      const notes = makeSqlNotes(sql);
      const both = Effect.all([directory.load, pulses.load]);

      /** A removed Person's test sends are forgotten with their other records (ADR 0021). */
      const deleteTestSendsForPerson = (personId: PersonId) =>
        sql`DELETE FROM test_send WHERE person_id = ${personId}`.pipe(Effect.asVoid, Effect.orDie);

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

      /** Active Members and Leads of a Team with the time zone each receives at: their own, else the Team's. */
      const activeMembersWithTimeZones = (dirState: DirectoryState, teamId: TeamId, teamTimeZone: string) =>
        Effect.gen(function* () {
          const activeMembers = dirState.memberships.filter(
            (m) => m.teamId === teamId && m.endedAt === null && (m.role === "lead" || m.role === "member"),
          );
          const memberTimeZones = yield* Effect.forEach(activeMembers, (m) =>
            rounds.getPersonTimeZone(m.personId).pipe(Effect.map((tz) => tz ?? teamTimeZone)),
          );
          return { activeMembers, memberTimeZones };
        });

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

          const { memberTimeZones } = yield* activeMembersWithTimeZones(dirState, teamId, team.timeZone);
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
            reviewEndsAt: null,
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

          const { memberTimeZones } = yield* activeMembersWithTimeZones(
            dirState,
            scheduled.teamId,
            team.timeZone,
          );

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

      /** When a Round closing now leaves its Review window: the Pulse's window in days, copied at close (issue 106). */
      const reviewEndsAtOf = (pulseState: PulseState, pulseId: PulseId, now: number) => {
        const pulse = pulseState.pulses.find((p) => p.id === pulseId);
        return now + (pulse?.settings.reviewWindowDays ?? 0) * 86_400_000;
      };

      const firstRatingQuestionOf = (pulse: PulseRecord, pulseState: PulseState) => {
        const firstVersionId = pulse.questions[0];
        const firstVersion =
          firstVersionId !== undefined ? pulseState.versions.find((v) => v.id === firstVersionId) : undefined;
        return firstVersion && firstVersion.content.type._tag === "Rating"
          ? {
              text: firstVersion.content.text,
              lowLabel: firstVersion.content.type.lowLabel,
              highLabel: firstVersion.content.type.highLabel,
            }
          : null;
      };

      /** Idempotent DO method: opens a Round, freezes questions and members, sends invitations, schedules reminders & close & next Round. */
      const executeOpenJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null || round.status !== "scheduled") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // Idempotency: if invitations already exist for this round, open was already executed.
          const existingInvitations = yield* rounds.getInvitations(roundId);
          if (existingInvitations.length > 0) {
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

          const { activeMembers, memberTimeZones } = yield* activeMembersWithTimeZones(
            dirState,
            round.teamId,
            team.timeZone,
          );

          const instants = calculateRoundInstants(
            round.plannedOpenDate,
            pulse.settings.cadence.time,
            memberTimeZones,
            team.timeZone,
            round.answerWindowDays,
          );

          const frozenMembers: ReadonlyArray<FrozenRoundMember> = activeMembers.map((m, idx) => {
            const tz = memberTimeZones[idx] ?? team.timeZone;
            const sendAt = instants.sends.find((s) => s.timeZone === tz)?.sendAt ?? instants.openInstant;
            return {
              roundId,
              personId: m.personId,
              timeZone: tz,
              sendAt,
            };
          });

          // Freezes eligible members and question versions in storage.
          yield* rounds.openRound(roundId, now, instants.closeInstant, pulse.questions, frozenMembers);

          const ratingQuestion = firstRatingQuestionOf(pulse, pulseState);
          const eligibleActions = yield* actions.getEligibleActionsForRound(
            round.teamId,
            round.pulseId,
            round.plannedOpenAt,
          );
          const emailActions = eligibleActions.slice(0, 3).map((a) => a.title);

          // Dispatch invitations and schedule reminders
          for (const m of frozenMembers) {
            const person = dirState.people.find((p) => p.id === m.personId);
            if (person === undefined || person.removedAt !== null) continue;

            // Generation 0 is the Invitation as opened; only its hash is stored.
            const invitation = { roundId, personId: m.personId, generation: 0 };
            const tokenHash = yield* tokenOf(invitation).pipe(
              Effect.flatMap((token) => Effect.promise(() => hashToken(token))),
            );
            const sendId = SendId.make(randomId());

            yield* rounds.insertInvitations([
              {
                roundId,
                personId: m.personId,
                tokenHash,
                sendId,
                status: "pending",
                failedReason: null,
                resendCount: 0,
                createdAt: now,
                updatedAt: now,
              },
            ]);

            const invitationEmail: TransactionalEmail = {
              _tag: "InvitationEmail",
              locale: emailLocaleOf(dirState, person.id),
              pulseName: pulse.settings.name,
              minimumGroupSize: dirState.minimumGroupSize,
              invitation,
              baseUrl: appOrigin,
              ratingQuestion,
              actions: emailActions,
              aiProcessing: dirState.aiProcessing,
            };

            if (m.sendAt <= now) {
              yield* sends.create(sendId, person.email, invitationEmail);
            } else {
              yield* rounds.insertJob({
                id: JobId.make(randomId()),
                roundId,
                type: "send",
                dueAt: m.sendAt,
                status: "pending",
                payload: JSON.stringify({ personId: m.personId }),
                createdAt: now,
                completedAt: null,
              });
            }

            // Reminders
            const reminderInstants = calculateReminders(
              m.sendAt,
              round.answerWindowDays,
              pulse.settings.reminders,
              instants.closeInstant,
            );
            for (const remindAt of reminderInstants) {
              yield* rounds.insertJob({
                id: JobId.make(randomId()),
                roundId,
                type: "remind",
                dueAt: remindAt,
                status: "pending",
                payload: JSON.stringify({ personId: m.personId }),
                createdAt: now,
                completedAt: null,
              });
            }
          }

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

      // Jobs name only the Person: the token is derived when the job runs. Jobs scheduled before tokens
      // were derived also hold their random `token`; they use it as is, since it matches the stored hash.
      const InvitationJobPayload = Schema.Struct({
        personId: Schema.String,
        token: Schema.optionalKey(Schema.String),
      });
      const decodeInvitationJobPayload = Schema.decodeUnknownOption(InvitationJobPayload);

      const ResultsReadyJobPayload = Schema.Struct({
        kind: Schema.Literal("resultsReady"),
        personId: Schema.String,
        roundId: Schema.String,
      });
      const decodeResultsReadyJobPayload = Schema.decodeUnknownOption(ResultsReadyJobPayload);

      const parseJobPayload = (
        raw: string | null,
      ): { readonly personId: string; readonly token?: string } | null => {
        if (raw === null) return null;
        try {
          return Option.getOrNull(decodeInvitationJobPayload(JSON.parse(raw)));
        } catch {
          return null;
        }
      };

      const parseSendPayload = (
        raw: string | null,
      ):
        | { readonly kind: "resultsReady"; readonly personId: string; readonly roundId: string }
        | { readonly personId: string; readonly token?: string }
        | null => {
        if (raw === null) return null;
        try {
          const parsed = JSON.parse(raw);
          const rr = Option.getOrNull(decodeResultsReadyJobPayload(parsed));
          if (rr !== null) return rr;
          return Option.getOrNull(decodeInvitationJobPayload(parsed));
        } catch {
          return null;
        }
      };

      /** Dispatches an Invitation or Results-ready email when a send time arrives. */
      const executeSendJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const payload = parseSendPayload(job.payload);
          if (payload === null) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          if ("kind" in payload) {
            // Results-ready delivery: round must be ready or shared
            if (round.status !== "ready" && round.status !== "shared") {
              yield* rounds.markJobCompleted(jobId, now);
              return;
            }

            const [dirState, pulseState] = yield* both;
            const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
            const team = dirState.teams.find((t) => t.id === round.teamId);
            const person = dirState.people.find((p) => p.id === payload.personId);
            if (pulse === undefined || person === undefined || person.removedAt !== null) {
              yield* rounds.markJobCompleted(jobId, now);
              return;
            }

            const storedResult = yield* rounds.getRoundResult(roundId);
            const responseRatePercent = Math.round((storedResult?.responseRate ?? 0) * 100);

            const resultsReadyEmail: TransactionalEmail = {
              _tag: "ResultsReadyEmail",
              locale: emailLocaleOf(dirState, person.id),
              pulseName: pulse.settings.name,
              teamName: team?.name ?? pulse.settings.name,
              resultsUrl: `${appOrigin}/teams/${round.teamId}/rounds/${roundId}`,
              responseRatePercent,
            };

            const sendId = SendId.make(randomId());
            yield* sends.create(sendId, person.email, resultsReadyEmail);
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // Invitation delivery: round must be open
          if (round.status !== "open") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const { personId } = payload;
          const [dirState, pulseState] = yield* both;
          const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
          const person = dirState.people.find((p) => p.id === personId);
          if (pulse === undefined || person === undefined || person.removedAt !== null) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const inv = yield* rounds.getInvitation(roundId, PersonId.make(personId));
          if (inv === null || inv.status === "revoked") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const ratingQuestion = firstRatingQuestionOf(pulse, pulseState);
          const eligibleActions = yield* actions.getEligibleActionsForRound(
            round.teamId,
            round.pulseId,
            round.plannedOpenAt,
          );

          const common = {
            locale: emailLocaleOf(dirState, person.id),
            pulseName: pulse.settings.name,
            minimumGroupSize: dirState.minimumGroupSize,
            baseUrl: appOrigin,
            ratingQuestion,
            actions: eligibleActions.slice(0, 3).map((a) => a.title),
            aiProcessing: dirState.aiProcessing,
          };
          const invitationEmail: StoredEmail =
            payload.token === undefined
              ? {
                  _tag: "InvitationEmail",
                  ...common,
                  invitation: { roundId, personId, generation: inv.resendCount },
                }
              : // A job scheduled before tokens were derived: its token is in the job already.
                { _tag: "InvitationEmail", ...common, token: payload.token };

          yield* sends.create(inv.sendId, person.email, invitationEmail);
          yield* rounds.markJobCompleted(jobId, now);
        });

      /** Dispatches a reminder email for an open round if eligible. */
      const executeRemindJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          const round = yield* rounds.getRound(roundId);
          if (round === null || round.status !== "open") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // Skipped if close is less than 2 hours away
          if (now >= round.plannedCloseAt - 2 * 3600_000) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const payload = parseJobPayload(job.payload);
          if (payload === null) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const { personId } = payload;
          const pid = PersonId.make(personId);

          // Skipped if member has answered
          const answered = yield* rounds.hasAnswered(roundId, pid);
          if (answered) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // Skipped if member has opted out of reminders for this pulse
          const optedOut = yield* rounds.isOptedOut(round.pulseId, pid);
          if (optedOut) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const [dirState, pulseState] = yield* both;
          const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
          const person = dirState.people.find((p) => p.id === personId);
          if (pulse === undefined || person === undefined || person.removedAt !== null) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const isMember = dirState.memberships.some(
            (m) => m.teamId === round.teamId && m.personId === pid && m.endedAt === null,
          );
          if (!isMember) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          // A revoked Invitation (Round cancelled) gets no reminder; a Resend moves it to a new generation.
          const inv = yield* rounds.getInvitation(roundId, pid);
          if (inv === null || inv.status === "revoked") {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const ratingQuestion = firstRatingQuestionOf(pulse, pulseState);
          const eligibleActions = yield* actions.getEligibleActionsForRound(
            round.teamId,
            round.pulseId,
            round.plannedOpenAt,
          );

          const common = {
            locale: emailLocaleOf(dirState, person.id),
            pulseName: pulse.settings.name,
            baseUrl: appOrigin,
            ratingQuestion,
            actions: eligibleActions.slice(0, 3).map((a) => a.title),
            aiProcessing: dirState.aiProcessing,
          };
          const reminderEmail: StoredEmail =
            payload.token === undefined
              ? {
                  _tag: "ReminderEmail",
                  ...common,
                  invitation: { roundId, personId, generation: inv.resendCount },
                }
              : // A job scheduled before tokens were derived: its token is in the job already.
                {
                  _tag: "ReminderEmail",
                  ...common,
                  token: payload.token,
                  unsubscribeUrl: `${appOrigin}/api/reminders/unsubscribe?t=${payload.token}`,
                };

          const sendId = SendId.make(randomId());
          yield* sends.create(sendId, person.email, reminderEmail);
          yield* rounds.markJobCompleted(jobId, now);
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

          const [dirState, pulseState] = yield* both;
          // Stricter of Organization's current N and round's stored N (ADR 0004)
          const effectiveN = Math.max(
            dirState.minimumGroupSize,
            round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
          );
          const reviewEndsAt = reviewEndsAtOf(pulseState, round.pulseId, now);

          yield* rounds.closeRound(roundId, now, effectiveN, reviewEndsAt);
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

      /** The Persons with `role` in the Team: active Memberships only. */
      const activePersonsWithRole = (dirState: DirectoryState, teamId: TeamId, role: "lead" | "member") =>
        dirState.memberships
          .filter((m) => m.teamId === teamId && m.endedAt === null && m.role === role)
          .map((m) => m.personId);

      /**
       * Schedules each person's results-ready email for their own morning, or sends it at once when that time
       * has passed. Job ids are per Round and person, so scheduling twice adds nothing.
       */
      const scheduleResultsReady = (round: RoundRecord, personIds: ReadonlyArray<PersonId>, now: number) =>
        Effect.gen(function* () {
          const dirState = yield* directory.load;
          const team = dirState.teams.find((t) => t.id === round.teamId);
          const teamTimeZone = team?.timeZone ?? "UTC";

          for (const personId of personIds) {
            const personTz = yield* rounds.getPersonTimeZone(personId);
            const effectiveTz = personTz ?? teamTimeZone;
            const deliveryTime = calculateResultsReadyDeliveryTime(now, effectiveTz);
            const resultsJobId = JobId.make(`results-ready-${round.id}-${personId}`);

            yield* rounds.insertJob({
              id: resultsJobId,
              roundId: round.id,
              type: "send",
              dueAt: deliveryTime,
              status: "pending",
              payload: JSON.stringify({
                kind: "resultsReady",
                personId,
                roundId: round.id,
              }),
              createdAt: now,
              completedAt: null,
            });

            if (deliveryTime <= now) {
              yield* executeSendJob(resultsJobId, round.id, now);
            }
          }
        });

      /**
       * Shares a Ready Round's Result with the Team (ADR 0004 and the Review window, Issue #106). Idempotent, and
       * it runs inside the caller's transaction. Earlier Ready Rounds of the Pulse are shared with it: a later
       * Round's trend and change already carry their scores, so no Result may reach a member before its Round is
       * Shared. Members get their results-ready email as each Round is shared; Leads got theirs at close.
       */
      const shareResults = (roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const target = yield* rounds.getRound(roundId);
          if (target === null || target.status !== "ready") return;

          const dirState = yield* directory.load;
          const earlier = yield* rounds.getReadyRoundIdsForPulseBefore(
            target.pulseId,
            target.plannedOpenDate,
          );
          for (const id of [...earlier, roundId]) {
            const round = yield* rounds.getRound(id);
            if (round === null) continue;
            const changed = yield* rounds.shareRound(id, now);
            if (!changed) continue;

            yield* rounds.cancelJobsForRound(id, ["share"]);
            // Leads already have theirs from close (same job id, so this adds none); a member made Lead since still gets one.
            yield* scheduleResultsReady(
              round,
              [
                ...activePersonsWithRole(dirState, round.teamId, "lead"),
                ...activePersonsWithRole(dirState, round.teamId, "member"),
              ],
              now,
            );
          }
          yield* repairAlarm();
        });

      /** Idempotent: the Review window has ended, so the Round's Result is shared (a no-op if it already is). */
      const executeShareJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;

          yield* shareResults(roundId, now);
          yield* rounds.markJobCompleted(jobId, now);
        });

      /**
       * Test stages only (reached through test routes behind `isTestStage`): the next compute attempts of a Round
       * that fail with a defect, before any write. Lives in memory, so it is gone when the object is evicted.
       */
      const injectedComputeFailures = new Map<RoundId, number>();

      /**
       * Idempotent DO method: computes Result, saves to round_result, moves to Ready then Shared. A defect retries at
       * the backoff time (Issue #128). It gives up once 24 h have passed since the job was created: a delayed Result is
       * stored, and the Lead may retry from the Round.
       */
      const executeComputeJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          const job = yield* rounds.getJob(jobId);
          if (job === null || job.status !== "pending") return;
          // A retry that is not due yet: a doubled alarm or request changes nothing.
          if (job.dueAt > now) return;

          const round = yield* rounds.getRound(roundId);
          if (
            round === null ||
            (round.status !== "closed" && round.status !== "ready" && round.status !== "shared")
          ) {
            yield* rounds.markJobCompleted(jobId, now);
            return;
          }

          const dirState = yield* directory.load;
          const effectiveN = Math.max(
            dirState.minimumGroupSize,
            round.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
          );

          const computeEffect = Effect.gen(function* () {
            const questions = yield* rounds.getRoundQuestionsDetailed(roundId);
            const submissions = yield* rounds.getSubmissionsForRound(roundId);
            const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);
            const pastHistory = yield* rounds.getPastRoundsResultsForPulse(
              round.pulseId,
              12,
              round.plannedOpenDate,
            );

            const result = calculateRoundResult({
              roundId,
              pulseId: round.pulseId,
              teamId: round.teamId,
              status: round.status,
              plannedOpenDate: round.plannedOpenDate,
              anonymityMode: round.anonymityMode,
              closedAt: round.closedAt,
              effectiveMinimumGroupSize: effectiveN,
              eligibleMembersCount,
              questions,
              submissions,
              pastRoundsHistory: pastHistory,
            });

            // Test stages only: a defect here is raised before any write, as a failing computation would be.
            const injected = injectedComputeFailures.get(roundId) ?? 0;
            if (injected > 0) {
              injectedComputeFailures.set(roundId, injected - 1);
              return yield* Effect.die(new Error("injected compute failure"));
            }

            yield* rounds.saveRoundResult(roundId, result, now);
            yield* rounds.markRoundReady(roundId, now);

            // The one themes call for this Round (ADR 0016, 0019). It runs as its own job, never inside this transaction.
            if (shouldRequestThemes(result, dirState.aiProcessing)) {
              const requested = yield* rounds.requestThemes(roundId, now);
              if (requested) {
                yield* rounds.insertJob({
                  id: JobId.make(`themes-${roundId}`),
                  roundId,
                  type: "themes",
                  dueAt: now,
                  status: "pending",
                  payload: null,
                  createdAt: now,
                  completedAt: null,
                });
              }
            }

            // Leads get their results-ready email now. Members get theirs when the Round is Shared.
            yield* scheduleResultsReady(round, activePersonsWithRole(dirState, round.teamId, "lead"), now);

            // Shared at once when the Review window is zero (or already over); otherwise a share job at its end.
            const readied = yield* rounds.getRound(roundId);
            const reviewEndsAt = readied?.reviewEndsAt ?? null;
            if (reviewEndsAt === null || reviewEndsAt <= now) {
              yield* shareResults(roundId, now);
            } else {
              yield* rounds.insertJob({
                id: JobId.make(`share-${roundId}`),
                roundId,
                type: "share",
                dueAt: reviewEndsAt,
                status: "pending",
                payload: null,
                createdAt: now,
                completedAt: null,
              });
            }

            yield* repairAlarm();
            yield* rounds.markJobCompleted(jobId, now);
          });

          yield* computeEffect.pipe(
            Effect.catchDefect((defect: unknown) =>
              Effect.gen(function* () {
                // A defect after the Result was stored (the Round is no longer Closed) leaves that Result in place.
                const current = yield* rounds.getRound(roundId);
                if (current === null || current.status !== "closed") {
                  yield* Effect.logError(
                    `[OPERATOR_ALERT] Results follow-up failed after compute for round ${roundId}: ${String(defect)}`,
                  );
                  yield* rounds.markJobCompleted(jobId, now);
                  return;
                }
                // The 24 h budget starts when the job is created: a Lead's retry makes a new job, so a fresh one.
                const attempts = parseAttempts(job.payload) + 1;
                const dueAt = nextRetryAt(job.createdAt, attempts, now);

                if (dueAt !== null) {
                  yield* rounds.updateJobPayload(jobId, JSON.stringify({ attempts }));
                  yield* rounds.updateJobDueAtById(jobId, dueAt);
                  yield* repairAlarm();
                  return;
                }

                yield* Effect.logError(
                  `[OPERATOR_ALERT] Results computation gave up for round ${roundId}: ${String(defect)}`,
                );
                const submissions = yield* rounds.getSubmissionsForRound(roundId);
                const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);
                const delayedResult = delayedRoundResult({
                  roundId,
                  pulseId: round.pulseId,
                  teamId: round.teamId,
                  status: round.status,
                  plannedOpenDate: round.plannedOpenDate,
                  anonymityMode: round.anonymityMode,
                  closedAt: round.closedAt,
                  effectiveMinimumGroupSize: effectiveN,
                  eligibleMembersCount,
                  submissionsCount: submissions.length,
                });
                yield* rounds.saveRoundResult(roundId, delayedResult, now);
                yield* rounds.markJobCompleted(jobId, now);
              }),
            ),
          );
        });

      /**
       * Idempotent: the Round's one Comment themes and discussion guide call (ADR 0016, ADR 0019). The network
       * call runs between two transactions, never inside one. The job's due time is moved ahead as a lease
       * while the call is in flight. Nothing is logged: the input, the reply, and any error body stay out.
       */
      const executeThemesJob = (jobId: JobId, roundId: RoundId, now: number) =>
        Effect.gen(function* () {
          // 1. Check everything the call needs, and take the lease.
          const prepared = yield* sql.withTransaction(
            Effect.gen(function* () {
              const job = yield* rounds.getJob(jobId);
              if (job === null || job.status !== "pending" || job.type !== "themes") return null;

              const themes = yield* rounds.getRoundThemes(roundId);
              if (themes === null || themes.status !== "pending") {
                yield* rounds.markJobCompleted(jobId, now);
                return null;
              }

              const dirState = yield* directory.load;
              // An admin may have turned AI processing off since the request: then nothing is sent.
              if (!dirState.aiProcessing) {
                yield* rounds.giveUpThemes(roundId, now);
                yield* rounds.markJobCompleted(jobId, now);
                return null;
              }

              const round = yield* rounds.getRound(roundId);
              const stored = yield* rounds.getRoundResult(roundId);
              // The Organization's N may have been raised since close: decide on, and send, only what
              // the Result shows under today's effective N (ADR 0004, Rule R9).
              const effective =
                stored === null ? null : enforceEffectiveNOnResult(stored, dirState.minimumGroupSize);
              if (round === null || effective === null || !shouldRequestThemes(effective, true)) {
                yield* rounds.giveUpThemes(roundId, now);
                yield* rounds.markJobCompleted(jobId, now);
                return null;
              }

              yield* rounds.updateJobDueAtById(jobId, now + THEMES_LEASE_MS);
              const openActionTitles = yield* actions.getOpenActionTitlesForTeam(round.teamId);
              return {
                input: buildThemesInput(effective, openActionTitles, dirState.people),
                requestedAt: themes.requestedAt,
                attempts: themes.attempts,
              };
            }),
          );
          if (prepared === null) return;
          // The lease is now the job's due time: arm the alarm for its expiry, in case the object dies mid-call.
          yield* repairAlarm();

          // 2. The one network call, outside any transaction.
          const decision = yield* runThemesAttempt({
            input: prepared.input,
            requestedAt: prepared.requestedAt,
            attempts: prepared.attempts,
            now,
          }).pipe(Effect.provideService(AiClient, ai));

          // 3. Record the outcome, unless the Round's themes were settled meanwhile.
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const current = yield* rounds.getRoundThemes(roundId);
              if (current === null || current.status !== "pending") {
                yield* rounds.markJobCompleted(jobId, now);
                return;
              }
              switch (decision._tag) {
                case "Store":
                  yield* rounds.storeThemes(roundId, decision.themes, now);
                  yield* rounds.markJobCompleted(jobId, now);
                  return;
                case "RetryAt":
                  yield* rounds.recordThemesAttemptFailed(roundId, decision.attempts);
                  yield* rounds.updateJobDueAtById(jobId, decision.dueAt);
                  return;
                case "GiveUp":
                  yield* rounds.giveUpThemes(roundId, now);
                  yield* rounds.markJobCompleted(jobId, now);
                  return;
              }
            }),
          );
          yield* repairAlarm();
        });

      /** Processes all jobs currently due from the schedule table, then updates the alarm. */
      const runDueJobs = (nowMs?: number) =>
        Effect.gen(function* () {
          const now = nowMs ?? (yield* Clock.currentTimeMillis);
          while (true) {
            const dueJobs = yield* rounds.getDueJobs(now);
            if (dueJobs.length === 0) break;
            for (const job of dueJobs) {
              // The themes call makes a network request, so it runs outside any transaction (ADR 0016).
              if (job.type === "themes") {
                yield* executeThemesJob(job.id, job.roundId, now);
                continue;
              }
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  if (job.type === "open") {
                    yield* executeOpenJob(job.id, job.roundId, now);
                  } else if (job.type === "close") {
                    yield* executeCloseJob(job.id, job.roundId, now);
                  } else if (job.type === "compute") {
                    yield* executeComputeJob(job.id, job.roundId, now);
                  } else if (job.type === "send") {
                    yield* executeSendJob(job.id, job.roundId, now);
                  } else if (job.type === "remind") {
                    yield* executeRemindJob(job.id, job.roundId, now);
                  } else if (job.type === "share") {
                    yield* executeShareJob(job.id, job.roundId, now);
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
          sql<{
            id: string;
            organization_admin: number;
            locale: string | null;
            detected_locale: string | null;
            default_locale: string | null;
          }>`
            SELECT person.id, person.organization_admin, person.locale, person.detected_locale,
                   (SELECT default_locale FROM organization LIMIT 1) AS default_locale
              FROM person
             WHERE person.workos_user_id = ${workosUserId} AND person.removed_at IS NULL`.pipe(
            Effect.map((rows) => {
              const row = rows[0];
              if (row === undefined) return null;
              return {
                id: row.id,
                organizationAdmin: row.organization_admin === 1,
                // The schema's CHECKs keep these to the known languages; anything else is read as unset.
                locale: localeOrNull(row.locale),
                detectedLocale: localeOrNull(row.detected_locale),
                organizationLocale: localeOr(row.default_locale, DEFAULT_LOCALE),
              };
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
                if (command._tag === "RemovePerson") {
                  yield* rounds.revokeInvitationForPerson(command.personId, now);
                  yield* rounds.deleteParticipationForPerson(command.personId);
                  yield* deleteTestSendsForPerson(command.personId);
                }
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

        /**
         * A test of a Pulse to the actor's own address (ADR 0021). Only the send is recorded here: its
         * token is derived from a random test id and stored as a hash, and the email goes through the
         * queue like every other. No Submission, Answer, or Participation is written.
         */
        sendTestInvitation: (actorId: PersonId, teamId: TeamId, pulseId: PulseId, now: number) =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const [people, library] = yield* both;
                const decision = decideTestSend(people, library, actorId, teamId, pulseId);
                if (decision._tag === "Rejected")
                  return { _tag: "Rejected", rejection: decision.rejection } satisfies TestSendResult;
                const { person, pulse } = decision;

                const sentRecently = yield* sql`SELECT COUNT(*) AS n FROM test_send
                  WHERE person_id = ${actorId} AND sent_at > ${now - 3_600_000}`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TestSendCount))),
                  Effect.orDie,
                );
                if ((sentRecently[0]?.n ?? 0) >= testSendsPerHour)
                  return {
                    _tag: "Rejected",
                    rejection: { _tag: "TestSendLimitReached", perHour: testSendsPerHour },
                  } satisfies TestSendResult;

                yield* sql`DELETE FROM test_send WHERE sent_at <= ${now - testInvitationLifetimeMs}`;

                const ref = { pulseId, personId: actorId, testId: randomId() };
                const token = yield* Effect.promise(() => deriveTestInvitationToken(invitationKey, ref));
                const tokenHash = yield* Effect.promise(() => hashToken(token));
                const sendId = SendId.make(randomId());
                yield* sql`INSERT INTO test_send (send_id, person_id, pulse_id, token_hash, sent_at)
                  VALUES (${sendId}, ${actorId}, ${pulseId}, ${tokenHash}, ${now})`;

                const eligibleActions = yield* actions.getEligibleActionsForRound(teamId, pulseId, now);
                const testEmail: TransactionalEmail = {
                  _tag: "TestInvitationEmail",
                  locale: emailLocaleOf(people, actorId),
                  pulseName: pulse.settings.name,
                  minimumGroupSize: people.minimumGroupSize,
                  test: ref,
                  baseUrl: appOrigin,
                  ratingQuestion: firstRatingQuestionOf(pulse, library),
                  actions: eligibleActions.slice(0, 3).map((action) => action.title),
                  aiProcessing: people.aiProcessing,
                };
                yield* sends.create(sendId, person.email, testEmail);
                return { _tag: "Accepted", sendId, email: person.email } satisfies TestSendResult;
              }),
            )
            .pipe(Effect.orDie),
        /** The test send a token-less email belongs to, for indexing its token once sent (ADR 0021). */
        getTestSendBySendId: (sendId: string) =>
          sql<{ token_hash: string; pulse_id: string; sent_at: number }>`
            SELECT token_hash, pulse_id, sent_at FROM test_send WHERE send_id = ${sendId}`.pipe(
            Effect.map((rows) => {
              const row = rows[0];
              return row === undefined
                ? null
                : { tokenHash: row.token_hash, pulseId: row.pulse_id, sentAt: row.sent_at };
            }),
            Effect.orDie,
          ),

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
                    yield* rounds.closeRound(
                      round.id,
                      now,
                      effectiveN,
                      reviewEndsAtOf(pulseState, round.pulseId, now),
                    );
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

                  case "ShareResults": {
                    const round = yield* rounds.getRound(command.roundId);
                    if (round === null || round.teamId !== command.teamId) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "RoundNotFound" },
                      } satisfies RoundCommandResult;
                    }
                    // Only a Lead shares: an admin may manage Rounds but sees no Result before it is shared.
                    if (auth.actor.roles.get(command.teamId) !== "lead") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "Forbidden" },
                      } satisfies RoundCommandResult;
                    }
                    if (round.status === "shared") {
                      return { _tag: "Accepted" } satisfies RoundCommandResult;
                    }
                    if (round.status !== "ready") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "InvalidRoundState", status: round.status },
                      } satisfies RoundCommandResult;
                    }

                    yield* shareResults(round.id, now);
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "RetryResult": {
                    const round = yield* rounds.getRound(command.roundId);
                    if (round === null || round.teamId !== command.teamId) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "RoundNotFound" },
                      } satisfies RoundCommandResult;
                    }
                    // Only a Lead retries: only a Lead sees that the Result could not be computed.
                    if (auth.actor.roles.get(command.teamId) !== "lead") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "Forbidden" },
                      } satisfies RoundCommandResult;
                    }
                    // Already computed: a repeated click changes nothing.
                    if (round.status === "ready" || round.status === "shared") {
                      return { _tag: "Accepted" } satisfies RoundCommandResult;
                    }
                    if (round.status !== "closed") {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "InvalidRoundState", status: round.status },
                      } satisfies RoundCommandResult;
                    }
                    // A computation is already retrying: a repeated click joins it.
                    if (yield* rounds.hasPendingJob(round.id, "compute")) {
                      return { _tag: "Accepted" } satisfies RoundCommandResult;
                    }

                    // A fresh compute job: its own 24 h budget, run at once like the close.
                    yield* rounds.deleteRoundResult(round.id);
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
                    yield* rounds.revokeInvitationsForRound(round.id, now);
                    yield* rounds.deleteSubmissionsAndParticipations(round.id);
                    yield* repairAlarm();
                    return { _tag: "Accepted" } satisfies RoundCommandResult;
                  }

                  case "ResendInvitation": {
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

                    const inv = yield* rounds.getInvitation(command.roundId, command.personId);
                    if (inv === null) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "InvitationNotFound" },
                      } satisfies RoundCommandResult;
                    }

                    const [dirState, pulseState] = yield* both;
                    const person = dirState.people.find((p) => p.id === command.personId);
                    if (person === undefined || person.removedAt !== null) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "InvitationNotFound" },
                      } satisfies RoundCommandResult;
                    }

                    const pulse = pulseState.pulses.find((p) => p.id === round.pulseId);
                    if (pulse === undefined) {
                      return {
                        _tag: "Rejected",
                        rejection: { _tag: "PulseNotFound" },
                      } satisfies RoundCommandResult;
                    }

                    // A Resend moves to the next generation, so the old link stops working.
                    const invitation = {
                      roundId: command.roundId,
                      personId: command.personId,
                      generation: inv.resendCount + 1,
                    };
                    const newTokenHash = yield* tokenOf(invitation).pipe(
                      Effect.flatMap((token) => Effect.promise(() => hashToken(token))),
                    );
                    const newSendId = SendId.make(randomId());
                    yield* rounds.resendInvitation(
                      command.roundId,
                      command.personId,
                      newSendId,
                      newTokenHash,
                      now,
                    );

                    const ratingQuestion = firstRatingQuestionOf(pulse, pulseState);
                    const eligibleActions = yield* actions.getEligibleActionsForRound(
                      round.teamId,
                      round.pulseId,
                      round.plannedOpenAt,
                    );

                    const invitationEmail: TransactionalEmail = {
                      _tag: "InvitationEmail",
                      locale: emailLocaleOf(dirState, person.id),
                      pulseName: pulse.settings.name,
                      minimumGroupSize: dirState.minimumGroupSize,
                      invitation,
                      baseUrl: appOrigin,
                      ratingQuestion,
                      actions: eligibleActions.slice(0, 3).map((a) => a.title),
                      aiProcessing: dirState.aiProcessing,
                    };

                    yield* sends.create(newSendId, person.email, invitationEmail);
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
            const paused = yield* rounds.isPulsePaused(pulseId);
            const viewed: RoundViewed<RoundList> = {
              _tag: "Viewed",
              value: {
                pulseId,
                paused,
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
            const failedInvitations = yield* rounds.getFailedInvitations(roundId);
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
                failedInvitations,
                createdAt: r.createdAt,
              },
            };
            return viewed;
          }).pipe(Effect.orDie),

        viewResults: (
          actorId: PersonId,
          teamId: TeamId,
          roundId: RoundId,
        ): Effect.Effect<RoundViewed<RoundResult>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewResults", teamId);
            if (auth._tag === "Rejected") {
              const rejected: RoundViewed<RoundResult> = auth;
              return rejected;
            }

            const team = dirState.teams.find((t) => t.id === teamId);
            if (team === undefined) {
              const rejected: RoundViewed<RoundResult> = {
                _tag: "Rejected",
                rejection: { _tag: "TeamNotFound" },
              };
              return rejected;
            }

            const r = yield* rounds.getRound(roundId);
            if (r === null || r.teamId !== teamId) {
              const rejected: RoundViewed<RoundResult> = {
                _tag: "Rejected",
                rejection: { _tag: "RoundNotFound" },
              };
              return rejected;
            }

            const effectiveN = Math.max(
              dirState.minimumGroupSize,
              r.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
            );

            // Rule R7: During an Open Round, only response count is returned, zero scores or comments
            if (r.status === "scheduled" || r.status === "open") {
              const submissions = yield* rounds.getSubmissionsForRound(roundId);
              const eligibleMembersCount = yield* rounds.getRoundMembersCount(roundId);
              const questions = yield* rounds.getRoundQuestionsDetailed(roundId);

              const openResult = calculateRoundResult({
                roundId,
                pulseId: r.pulseId,
                teamId: r.teamId,
                status: r.status,
                plannedOpenDate: r.plannedOpenDate,
                anonymityMode: r.anonymityMode,
                closedAt: r.closedAt,
                effectiveMinimumGroupSize: effectiveN,
                eligibleMembersCount,
                questions,
                submissions,
                pastRoundsHistory: [],
              });

              return { _tag: "Viewed", value: openResult } satisfies RoundViewed<RoundResult>;
            }

            // Closed/ready/shared round: read the stored round_result. Without one, the compute job owns the Result
            // (it is pending, or retrying): show the delayed stand-in and store nothing (Issue #128).
            const storedResult = yield* rounds.getRoundResult(roundId);
            // Delayed while a compute job is pending; with no Result and no job left, the Lead may retry.
            const resultPending = storedResult === null && (yield* rounds.hasPendingJob(roundId, "compute"));
            const result: RoundResult =
              storedResult ??
              delayedRoundResult({
                roundId,
                pulseId: r.pulseId,
                teamId: r.teamId,
                status: r.status,
                plannedOpenDate: r.plannedOpenDate,
                anonymityMode: r.anonymityMode,
                closedAt: r.closedAt,
                effectiveMinimumGroupSize: effectiveN,
                eligibleMembersCount: yield* rounds.getRoundMembersCount(roundId),
                submissionsCount: (yield* rounds.getSubmissionsForRound(roundId)).length,
              });

            // Members/viewers see results without comments; only Lead sees comments behind N (ADR 0004, Issue #3).
            // Effective N (Rule R9) and the themes and discussion guide (ADR 0016, 0019) are applied in viewRoundResult.
            const isLead = auth.actor.roles.get(teamId) === "lead";
            const themes = yield* rounds.getRoundThemes(roundId);
            const resultToShow = viewRoundResult({
              stored: result,
              organizationN: dirState.minimumGroupSize,
              isLead,
              themes,
              round: { status: r.status, reviewEndsAt: r.reviewEndsAt },
              resultPending,
            });

            const viewed: RoundViewed<RoundResult> = {
              _tag: "Viewed",
              value: resultToShow,
            };
            return viewed;
          }).pipe(Effect.orDie),

        viewTeamOverview: (
          actorId: PersonId,
          teamId: TeamId,
        ): Effect.Effect<RoundViewed<TeamOverview>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewResults", teamId);
            if (auth._tag === "Rejected") {
              const rejected: RoundViewed<TeamOverview> = auth;
              return rejected;
            }

            const team = dirState.teams.find((t) => t.id === teamId);
            if (team === undefined) {
              const rejected: RoundViewed<TeamOverview> = {
                _tag: "Rejected",
                rejection: { _tag: "TeamNotFound" },
              };
              return rejected;
            }

            const results = yield* rounds.getSharedRoundResultsForTeam(teamId);
            const teamActions = yield* actions.getActionsForTeam(teamId);
            const viewed: RoundViewed<TeamOverview> = {
              _tag: "Viewed",
              value: buildTeamOverview({
                teamId,
                results,
                minimumGroupSize: dirState.minimumGroupSize,
                actions: teamActions,
              }),
            };
            return viewed;
          }).pipe(Effect.orDie),

        viewMemberHistory: (actorId: PersonId): Effect.Effect<MemberHistory, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const participated = yield* rounds.getParticipatedRounds(actorId);
            const inputs = yield* Effect.forEach(participated, (row) =>
              Effect.map(rounds.getRoundQuestionsDetailed(row.roundId), (questions) => ({
                ...row,
                questions,
                canViewResults:
                  authorizeRoundAction(dirState, actorId, "team.viewResults", row.teamId)._tag !== "Rejected",
              })),
            );
            return buildMemberHistory({ rounds: inputs, minimumGroupSize: dirState.minimumGroupSize });
          }).pipe(Effect.orDie),

        listActions: (
          actorId: PersonId,
          teamId: TeamId,
        ): Effect.Effect<ActionViewed<ActionList>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewActions", teamId);
            if (auth._tag === "Rejected") {
              const rejected: ActionViewed<ActionList> = {
                _tag: "Rejected",
                rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
              };
              return rejected;
            }
            const team = dirState.teams.find((t) => t.id === teamId);
            if (team === undefined) {
              const rejected: ActionViewed<ActionList> = {
                _tag: "Rejected",
                rejection: { _tag: "TeamNotFound" },
              };
              return rejected;
            }
            const all = yield* actions.getActionsForTeam(teamId);
            const viewed: ActionViewed<ActionList> = {
              _tag: "Viewed",
              value: {
                teamId,
                actions: all,
              },
            };
            return viewed;
          }).pipe(Effect.orDie),

        createAction: (
          actorId: PersonId,
          teamId: TeamId,
          payload: CreateAction,
          now: number,
        ): Effect.Effect<ActionViewed<ActionItem>, never, never> =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const dirState = yield* directory.load;
                const auth = authorizeRoundAction(dirState, actorId, "team.createAction", teamId);
                if (auth._tag === "Rejected") {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: {
                      _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
                    },
                  };
                  return rejected;
                }
                const team = dirState.teams.find((t) => t.id === teamId);
                if (team === undefined) {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: { _tag: "TeamNotFound" },
                  };
                  return rejected;
                }
                // Check owner is an active member in team
                const isMember = dirState.memberships.some(
                  (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
                );
                if (!isMember) {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: { _tag: "OwnerNotInTeam" },
                  };
                  return rejected;
                }
                // Check round exists in team
                const round = yield* rounds.getRound(payload.roundId);
                if (round === null || round.teamId !== teamId) {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  };
                  return rejected;
                }

                const actionId = ActionId.make(randomId());
                yield* actions.insertAction({
                  id: actionId,
                  teamId,
                  roundId: payload.roundId,
                  title: payload.title,
                  ownerId: payload.ownerId,
                  dueDate: payload.dueDate ?? null,
                  dimension: payload.dimension ?? null,
                  status: "committed",
                  createdAt: now,
                  updatedAt: now,
                  doneAt: null,
                });

                const item = yield* actions.getActionItem(actionId);
                const viewed: ActionViewed<ActionItem> = {
                  _tag: "Viewed",
                  value: item!,
                };
                return viewed;
              }),
            )
            .pipe(Effect.orDie),

        updateAction: (
          actorId: PersonId,
          teamId: TeamId,
          actionId: ActionId,
          payload: UpdateAction,
          now: number,
        ): Effect.Effect<ActionViewed<ActionItem>, never, never> =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const dirState = yield* directory.load;
                const auth = authorizeRoundAction(dirState, actorId, "team.updateAction", teamId);
                if (auth._tag === "Rejected") {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: {
                      _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
                    },
                  };
                  return rejected;
                }
                const team = dirState.teams.find((t) => t.id === teamId);
                if (team === undefined) {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: { _tag: "TeamNotFound" },
                  };
                  return rejected;
                }
                const existing = yield* actions.getAction(actionId);
                if (existing === null || existing.teamId !== teamId) {
                  const rejected: ActionViewed<ActionItem> = {
                    _tag: "Rejected",
                    rejection: { _tag: "ActionNotFound" },
                  };
                  return rejected;
                }

                if (payload.ownerId !== undefined) {
                  const isMember = dirState.memberships.some(
                    (m) => m.teamId === teamId && m.personId === payload.ownerId && m.endedAt === null,
                  );
                  if (!isMember) {
                    const rejected: ActionViewed<ActionItem> = {
                      _tag: "Rejected",
                      rejection: { _tag: "OwnerNotInTeam" },
                    };
                    return rejected;
                  }
                }

                let newDoneAt: number | null = existing.doneAt;
                if (payload.status === "done" && existing.status !== "done") {
                  newDoneAt = now;
                } else if (payload.status !== undefined && payload.status !== "done") {
                  newDoneAt = null;
                }

                yield* actions.updateAction(actionId, {
                  title: payload.title ?? existing.title,
                  ownerId: payload.ownerId ?? existing.ownerId,
                  dueDate: payload.dueDate !== undefined ? payload.dueDate : existing.dueDate,
                  dimension: payload.dimension !== undefined ? payload.dimension : existing.dimension,
                  status: payload.status ?? existing.status,
                  updatedAt: now,
                  doneAt: newDoneAt,
                });

                const item = yield* actions.getActionItem(actionId);
                const viewed: ActionViewed<ActionItem> = {
                  _tag: "Viewed",
                  value: item!,
                };
                return viewed;
              }),
            )
            .pipe(Effect.orDie),

        viewRoundNote: (
          actorId: PersonId,
          teamId: TeamId,
          roundId: RoundId,
        ): Effect.Effect<NoteViewed<RoundNoteView>, never, never> =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            const auth = authorizeRoundAction(dirState, actorId, "team.viewNote", teamId);
            if (auth._tag === "Rejected") {
              const rejected: NoteViewed<RoundNoteView> = {
                _tag: "Rejected",
                rejection: { _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden" },
              };
              return rejected;
            }
            const round = yield* rounds.getRound(roundId);
            if (round === null || round.teamId !== teamId) {
              const rejected: NoteViewed<RoundNoteView> = {
                _tag: "Rejected",
                rejection: { _tag: "RoundNotFound" },
              };
              return rejected;
            }
            // During the Review window only the Lead sees the Note; the Team sees it once the Round is Shared.
            const isLead = auth.actor.roles.get(teamId) === "lead";
            const note = isLead || round.status === "shared" ? yield* notes.getNote(roundId) : null;
            const viewed: NoteViewed<RoundNoteView> = { _tag: "Viewed", value: { roundId, note } };
            return viewed;
          }).pipe(Effect.orDie),

        saveRoundNote: (
          actorId: PersonId,
          teamId: TeamId,
          roundId: RoundId,
          text: string,
          now: number,
        ): Effect.Effect<NoteViewed<RoundNoteView>, never, never> =>
          sql
            .withTransaction(
              Effect.gen(function* () {
                const dirState = yield* directory.load;
                const auth = authorizeRoundAction(dirState, actorId, "team.writeNote", teamId);
                if (auth._tag === "Rejected") {
                  const rejected: NoteViewed<RoundNoteView> = {
                    _tag: "Rejected",
                    rejection: {
                      _tag: auth.rejection._tag === "TeamNotFound" ? "TeamNotFound" : "Forbidden",
                    },
                  };
                  return rejected;
                }
                const round = yield* rounds.getRound(roundId);
                if (round === null || round.teamId !== teamId) {
                  const rejected: NoteViewed<RoundNoteView> = {
                    _tag: "Rejected",
                    rejection: { _tag: "RoundNotFound" },
                  };
                  return rejected;
                }
                // Blank text after trimming clears the Note; anything else replaces it.
                const change = noteChange(text);
                if (change._tag === "Delete") {
                  yield* notes.deleteNote(roundId);
                } else {
                  yield* notes.upsertNote({ roundId, teamId, text: change.text, updatedAt: now });
                }
                const note = yield* notes.getNote(roundId);
                const viewed: NoteViewed<RoundNoteView> = { _tag: "Viewed", value: { roundId, note } };
                return viewed;
              }),
            )
            .pipe(Effect.orDie),

        recomputeResult: (roundId: string) =>
          Effect.gen(function* () {
            const rid = RoundId.make(roundId);
            const r = yield* rounds.getRound(rid);
            if (r === null) return false;
            const dirState = yield* directory.load;
            const effectiveN = Math.max(
              dirState.minimumGroupSize,
              r.effectiveMinimumGroupSize ?? dirState.minimumGroupSize,
            );
            const now = yield* Clock.currentTimeMillis;
            const questions = yield* rounds.getRoundQuestionsDetailed(rid);
            const submissions = yield* rounds.getSubmissionsForRound(rid);
            const eligibleMembersCount = yield* rounds.getRoundMembersCount(rid);
            const pastHistory = yield* rounds.getPastRoundsResultsForPulse(r.pulseId, 12, r.plannedOpenDate);

            const result = calculateRoundResult({
              roundId: rid,
              pulseId: r.pulseId,
              teamId: r.teamId,
              status: r.status,
              plannedOpenDate: r.plannedOpenDate,
              anonymityMode: r.anonymityMode,
              closedAt: r.closedAt,
              effectiveMinimumGroupSize: effectiveN,
              eligibleMembersCount,
              questions,
              submissions,
              pastRoundsHistory: pastHistory,
            });
            yield* rounds.saveRoundResult(rid, result, now);
            return true;
          }).pipe(Effect.orDie),

        /** Test stages only (`isTestStage`): the next `count` compute attempts of the Round fail with a defect. */
        injectComputeFailures: (roundId: string, count: number) =>
          Effect.sync(() => {
            injectedComputeFailures.set(RoundId.make(roundId), count);
          }),
        getRoundResult: (roundId: string) => rounds.getRoundResult(RoundId.make(roundId)),
        getRoundThemes: (roundId: string) => rounds.getRoundThemes(RoundId.make(roundId)),

        runDueJobs: (now?: number) => runDueJobs(now),

        runScheduleJob: (jobId: string, nowMs?: number) =>
          Effect.gen(function* () {
            const peeked = yield* rounds.getJob(JobId.make(jobId));
            if (peeked !== null && peeked.type === "themes") {
              // Outside any transaction, as in runDueJobs (ADR 0016).
              const now = nowMs ?? (yield* Clock.currentTimeMillis);
              yield* executeThemesJob(peeked.id, peeked.roundId, now);
              yield* repairAlarm();
              return;
            }
            yield* sql.withTransaction(
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
                } else if (job.type === "send") {
                  yield* executeSendJob(job.id, job.roundId, now);
                } else if (job.type === "remind") {
                  yield* executeRemindJob(job.id, job.roundId, now);
                } else if (job.type === "share") {
                  yield* executeShareJob(job.id, job.roundId, now);
                }
                yield* repairAlarm();
              }),
            );
          }).pipe(Effect.orDie),

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

        getInvitations: (roundId: string) => rounds.getInvitations(RoundId.make(roundId)),
        getInvitationByTokenHash: (tokenHash: string) => rounds.getInvitationByTokenHash(tokenHash),
        getInvitationBySendId: (sendId: string) => rounds.getInvitationBySendId(SendId.make(sendId)),
        optOutReminders: (pulseId: string, personId: string, now?: number) =>
          rounds.optOutReminders(PulseId.make(pulseId), PersonId.make(personId), now ?? Date.now()),
        isOptedOut: (pulseId: string, personId: string) =>
          rounds.isOptedOut(PulseId.make(pulseId), PersonId.make(personId)),
        // A Round that is still Scheduled is re-timed, because the earliest member send decides when it opens.
        setPersonTimeZone: (personId: string, timeZone: string) =>
          Effect.gen(function* () {
            const pid = PersonId.make(personId);
            yield* rounds.setPersonTimeZone(pid, timeZone);
            const now = yield* Clock.currentTimeMillis;
            const [dirState, pulseState] = yield* both;
            const teamIds = new Set(
              dirState.memberships
                .filter((m) => m.personId === pid && m.endedAt === null)
                .map((m) => m.teamId),
            );
            for (const pulse of pulseState.pulses) {
              if (teamIds.has(pulse.teamId)) yield* updateScheduledRoundForPulse(pulse.id, now);
            }
          }),
        getPersonTimeZone: (personId: string) => rounds.getPersonTimeZone(PersonId.make(personId)),
        recordParticipation: (roundId: string, personId: string) =>
          rounds.recordParticipation(RoundId.make(roundId), PersonId.make(personId)),
        hasAnswered: (roundId: string, personId: string) =>
          rounds.hasAnswered(RoundId.make(roundId), PersonId.make(personId)),
        failInvitation: (roundId: string, personId: string, reason: string, now?: number) =>
          rounds.updateInvitationStatus(
            RoundId.make(roundId),
            PersonId.make(personId),
            "failed",
            reason,
            now ?? Date.now(),
          ),

        getSubmissionRoundContext: (roundId: string, personId: string | null) =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            return yield* rounds.getSubmissionRoundContext(
              RoundId.make(roundId),
              personId === null ? null : PersonId.make(personId),
              dirState.minimumGroupSize,
            );
          }),
        /**
         * The answer page's context for a test Invitation (ADR 0021). Read-only: no Round, no Submission,
         * and no Invitation row. Built from the Pulse's saved Questions and settings; `null` when the Pulse
         * is gone or has no Questions.
         */
        getTestSubmissionContext: (pulseId: string, expiresAt: number) =>
          Effect.gen(function* () {
            const [dirState, pulseState] = yield* both;
            const pulse = pulseState.pulses.find((p) => p.id === PulseId.make(pulseId));
            if (pulse === undefined || pulse.questions.length === 0) return null;
            const questions = pulse.questions.flatMap((versionId) => {
              const version = pulseState.versions.find((v) => v.id === versionId);
              return version === undefined
                ? []
                : [{ id: versionId, text: version.content.text, type: version.content.type }];
            });
            const now = yield* Clock.currentTimeMillis;
            const eligibleActions = yield* actions.getEligibleActionsForRound(pulse.teamId, pulse.id, now);
            return testSubmissionContext({
              pulseName: pulse.settings.name,
              minimumGroupSize: dirState.minimumGroupSize,
              pulseId: pulse.id,
              questions,
              actions: eligibleActions.map((action) => ({ id: action.id, title: action.title })),
              expiresAt,
              aiProcessing: dirState.aiProcessing,
            });
          }),
        /** What the Lead would be shown for test answers: redacted as the real path does, and written nowhere (ADR 0021). */
        previewTestAnswers: (answers: ReadonlyArray<SubmissionAnswer>) =>
          directory.load.pipe(Effect.map((dirState) => previewAnswers(answers, dirState.people))),
        recordFirstAnswer: (
          roundId: string,
          personId: string,
          editKeyHash: string,
          answers: ReadonlyArray<SubmissionAnswer>,
        ) =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            return yield* rounds
              .recordFirstAnswer(
                RoundId.make(roundId),
                PersonId.make(personId),
                editKeyHash,
                answers,
                dirState.people,
              )
              .pipe(
                Effect.map((res) => ({ _tag: "Success" as const, ...res })),
                Effect.catchTag("AlreadyAnswered", () =>
                  Effect.succeed({ _tag: "AlreadyAnswered" as const }),
                ),
                Effect.catchTag("RoundNotOpen", () => Effect.succeed({ _tag: "RoundNotOpen" as const })),
              );
          }),
        saveAnswer: (editKeyHash: string, answers: ReadonlyArray<SubmissionAnswer>) =>
          Effect.gen(function* () {
            const dirState = yield* directory.load;
            return yield* rounds.saveAnswer(editKeyHash, answers, dirState.people).pipe(
              Effect.map((res) => ({ _tag: "Success" as const, ...res })),
              Effect.catchTag("SubmissionNotFound", () =>
                Effect.succeed({ _tag: "SubmissionNotFound" as const }),
              ),
              Effect.catchTag("RoundNotOpen", () => Effect.succeed({ _tag: "RoundNotOpen" as const })),
            );
          }),
        deleteParticipationForPerson: (personId: string) =>
          rounds.deleteParticipationForPerson(PersonId.make(personId)),

        get: (id: string) =>
          sql<{ id: string; name: string }>`SELECT id, name FROM organization WHERE id = ${id}`.pipe(
            Effect.map((rows) => rows[0] ?? null),
            Effect.orDie,
          ),

        createEmailSend: (id: SendId, recipient: EmailAddress, email: StoredEmail) =>
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
