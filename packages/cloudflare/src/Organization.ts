import * as Cloudflare from "@alchemy.run/cloudflare";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { organizationActions } from "./organization/Actions.ts";
import { organizationDirectory } from "./organization/Directory.ts";
import { makeEmailOutbox } from "./organization/EmailOutbox.ts";
import { organizationEmailVisibility } from "./organization/EmailVisibility.ts";
import { failureSummary } from "./organization/JobFailure.ts";
import { organizationNotes } from "./organization/Notes.ts";
import { organizationOffboarding } from "./organization/Offboarding.ts";
import { organizationPersonalData } from "./organization/PersonalData.ts";
import { organizationResults } from "./organization/Results.ts";
import { organizationRoundCommands } from "./organization/RoundCommands.ts";
import { renameLegacyPersonColumn } from "./organization/LegacySchema.ts";
import { repairRoundPlannedOpenDates } from "./organization/RoundDateRepair.ts";
import { firstRatingQuestionOf, makeRoundJobs } from "./organization/RoundJobs.ts";
import { organizationRoundViews } from "./organization/RoundViews.ts";
import { makeScheduling } from "./organization/Scheduling.ts";
import { organizationSends } from "./organization/Sends.ts";
import { organizationSubmissions } from "./organization/Submissions.ts";
import { organizationTestSupport } from "./organization/TestSupport.ts";
import {
  decidePulse,
  decideTestSend,
  defaultSendPolicy,
  deriveInvitationToken,
  deriveTestInvitationToken,
  emailLocaleOf,
  hashToken,
  importInvitationTokenKey,
  makeSendStore,
  PersonId,
  PulseId,
  pulseView,
  pulsesView,
  RoundId,
  SendId,
  testInvitationLifetimeMs,
  testSendsPerHour,
} from "@surveybeat/domain";
import type {
  TeamId,
  InvitationTokenRef,
  PulseCommand,
  PulseCommandResult,
  TestSendResult,
  TransactionalEmail,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { makeOpenRouterAiClient } from "./ai/OpenRouterAiClient.ts";
import { EmailQueue } from "./Email.ts";
import { makeSqlActions } from "./SqlActions.ts";
import { makeSqlNotes } from "./SqlNotes.ts";
import { makeSqlDirectory } from "./SqlDirectory.ts";
import { makeSqlPulses } from "./SqlPulses.ts";
import { makeSqlRounds, secureRandomBytes } from "./SqlRounds.ts";
import { makeSqlSendRepository } from "./SqlSendRepository.ts";

const migrationsDirectory = "packages/cloudflare/migrations";

const fallbackAppOrigin = "https://app.invalid";

const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

const TestSendCount = Schema.Struct({ n: Schema.Int });

const organizationObject = Effect.gen(function* () {
  const migrations = yield* Cloudflare.SqlMigrations(migrationsDirectory);
  const emailQueue = yield* Cloudflare.Queues.WriteQueue(yield* EmailQueue);

  // @effect-diagnostics-next-line returnEffectInGen:off -- the object setup must be returned, not yielded: flattening it would run the setup when the outer phase runs, not once per activation.
  return Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    const appOrigin = yield* Config.String("APP_ORIGIN").pipe(
      Config.withDefault(fallbackAppOrigin),
      Effect.orDie,
    );

    const invitationKey = yield* Config.Redacted("INVITATION_TOKEN_KEY").pipe(
      Effect.flatMap((secret) => Effect.promise(() => importInvitationTokenKey(Redacted.value(secret)))),
      Effect.orDie,
    );

    const tokenOf = (ref: InvitationTokenRef) =>
      Effect.promise(() => deriveInvitationToken(invitationKey, ref));

    const aiKey = yield* Config.Redacted("OPENROUTER_API_KEY").pipe(
      Config.withDefault(Redacted.make("")),
      Effect.orDie,
    );

    const ai = makeOpenRouterAiClient(aiKey);

    const scope = yield* Scope.make();

    const sql = yield* SqliteClient.make({ storage: state.raw.storage }).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provide(Reactivity.layer),
    );

    yield* migrations.apply().pipe(Effect.orDie);

    yield* renameLegacyPersonColumn(sql).pipe(Effect.orDie);

    const rounds = makeSqlRounds(sql, secureRandomBytes);
    const outbox = makeEmailOutbox(sql, emailQueue);

    const repairAlarm = () =>
      Effect.gen(function* () {
        const nextJob = yield* rounds.getEarliestPendingJobDueAt();
        const now = yield* Clock.currentTimeMillis;
        const sendsWaiting = yield* outbox.isWaiting;
        const earliest = sendsWaiting ? Math.min(now, nextJob ?? now) : nextJob;

        if (earliest !== null) {
          const currentAlarm = yield* Effect.promise(() => state.raw.storage.getAlarm());

          if (currentAlarm !== earliest) {
            yield* Effect.promise(() => state.raw.storage.setAlarm(earliest));
          }
        } else {
          yield* Effect.promise(() => state.raw.storage.deleteAlarm());
        }
      }).pipe(Effect.orDie);

    const sends = outbox.recording(
      makeSendStore(makeSqlSendRepository(sql), defaultSendPolicy),
      Effect.suspend(() => repairAlarm()),
    );

    const directory = makeSqlDirectory(sql, sends);
    const pulses = makeSqlPulses(sql);
    const actions = makeSqlActions(sql);
    const notes = makeSqlNotes(sql);
    const both = Effect.all([directory.load, pulses.load]);

    const scheduling = makeScheduling({ rounds, directory, pulses, repairAlarm, randomId });

    const jobs = makeRoundJobs({
      sql,
      rounds,
      directory,
      pulses,
      actions,
      sends,
      scheduling,
      repairAlarm,
      randomId,
      tokenOf,
      appOrigin,
      ai,
    });

    yield* repairRoundPlannedOpenDates({
      sql,
      rounds,
      directory,
      pulses,
      scheduling,
      now: yield* Clock.currentTimeMillis,
    }).pipe(Effect.catchCause((cause) => Effect.logError("ROUND_PLANNED_OPEN_DATE_REPAIR_FAILED", cause)));

    const queueTestSend = (
      actorId: PersonId,
      teamId: TeamId,
      pulseId: PulseId,
      now: number,
      perHour: boolean,
    ) =>
      Effect.gen(function* () {
        const [people, library] = yield* both;
        const decision = decideTestSend(people, library, actorId, teamId, pulseId);

        if (decision._tag === "Rejected") {
          return { _tag: "Rejected", rejection: decision.rejection } satisfies TestSendResult;
        }

        const { person, pulse } = decision;

        if (perHour) {
          const sentRecently = yield* sql`SELECT COUNT(*) AS n FROM test_send
              WHERE person_id = ${actorId} AND sent_at > ${now - 3_600_000}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TestSendCount))),
            Effect.orDie,
          );

          if ((sentRecently[0]?.n ?? 0) >= testSendsPerHour) {
            return {
              _tag: "Rejected",
              rejection: { _tag: "TestSendLimitReached", perHour: testSendsPerHour },
            } satisfies TestSendResult;
          }
        }

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
          ratingQuestion: firstRatingQuestionOf(pulse.questions, library),
          actions: eligibleActions.slice(0, 3).map((action) => action.title),
          aiProcessing: people.aiProcessing,
        };

        yield* sends.create(sendId, person.email, testEmail);

        return { _tag: "Accepted", sendId, email: person.email } satisfies TestSendResult;
      });

    return {
      alarm: () =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const jobsExit = yield* Effect.exit(jobs.runDueJobs(now));
          const dispatchExit = yield* Effect.exit(outbox.dispatch);
          yield* repairAlarm();

          const exits = [jobsExit, dispatchExit];

          for (const exit of exits) {
            if (Exit.isFailure(exit)) {
              yield* Effect.logError(`[OPERATOR_ALERT] ALARM_FAILED ${failureSummary(exit.cause)}`);
            }
          }

          const failure = exits.find(Exit.isFailure);

          if (failure !== undefined) {
            return yield* Effect.failCause(failure.cause);
          }
        }).pipe(Effect.orDie),

      runPulseCommand: (actorId: PersonId, command: PulseCommand, now: number) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const [people, library] = yield* both;
              const decision = decidePulse(people, library, actorId, command, now);

              if (decision._tag === "Rejected") {
                return decision satisfies PulseCommandResult;
              }

              yield* pulses.apply(decision.changes);

              if (command._tag === "CreatePulse") {
                yield* scheduling.scheduleNextRound(command.pulseId, command.teamId, now);
              } else if (command._tag === "UpdatePulseSettings") {
                yield* scheduling.updateScheduledRoundForPulse(command.pulseId, now);
              }

              return { _tag: "Accepted" } satisfies PulseCommandResult;
            }),
          )
          .pipe(Effect.orDie),
      viewPulses: (actorId: PersonId, teamId: TeamId) =>
        Effect.all([both, rounds.pulseFacts(teamId)]).pipe(
          Effect.map(([[people, library], facts]) =>
            pulsesView(
              people,
              library,
              actorId,
              teamId,
              (pulseId) =>
                facts[pulseId] ?? {
                  paused: false,
                  nextRoundDate: null,
                },
            ),
          ),
        ),
      viewPulse: (actorId: PersonId, teamId: TeamId, pulseId: PulseId) =>
        both.pipe(Effect.map(([people, library]) => pulseView(people, library, actorId, teamId, pulseId))),

      sendTestInvitation: (actorId: PersonId, teamId: TeamId, pulseId: PulseId, now: number) =>
        sql.withTransaction(queueTestSend(actorId, teamId, pulseId, now, true)).pipe(Effect.orDie),
      ...organizationEmailVisibility({ sql, sends, rounds, directory }),
      ...organizationRoundCommands({
        sql,
        rounds,
        directory,
        pulses,
        actions,
        sends,
        scheduling,
        jobs,
        repairAlarm,
        randomId,
        tokenOf,
        appOrigin,
      }),
      ...organizationRoundViews({ rounds, directory, pulses }),

      ...organizationResults({ rounds, directory, actions }),
      ...organizationActions({ actions, rounds, directory, sql, randomId }),
      ...organizationNotes({ notes, rounds, directory, sql }),
      ...organizationTestSupport({ sql, sends, rounds, directory, state, scheduling, jobs, queueTestSend }),

      getRoundResult: (roundId: string) => rounds.getRoundResult(RoundId.make(roundId)),
      getRoundThemes: (roundId: string) => rounds.getRoundThemes(RoundId.make(roundId)),

      repairAlarm: () => repairAlarm(),
      getRound: (roundId: string) => rounds.getRound(RoundId.make(roundId)),
      getInvitationBySendId: (sendId: string) => rounds.getInvitationBySendId(SendId.make(sendId)),
      optOutReminders: (pulseId: string, personId: string, now?: number) =>
        Effect.flatMap(now === undefined ? Clock.currentTimeMillis : Effect.succeed(now), (at) =>
          rounds.optOutReminders(PulseId.make(pulseId), PersonId.make(personId), at),
        ),
      setPersonTimeZone: (personId: string, timeZone: string) =>
        Effect.gen(function* () {
          const pid = PersonId.make(personId);
          yield* rounds.setPersonTimeZone(pid, timeZone);
          const now = yield* Clock.currentTimeMillis;
          const [dirState, pulseState] = yield* both;

          const teamIds = new Set(
            dirState.memberships.filter((m) => m.personId === pid && m.endedAt === null).map((m) => m.teamId),
          );

          for (const pulse of pulseState.pulses) {
            if (teamIds.has(pulse.teamId)) {
              yield* scheduling.updateScheduledRoundForPulse(pulse.id, now);
            }
          }
        }),
      failInvitation: (roundId: string, personId: string, reason: string, now?: number) =>
        Effect.flatMap(now === undefined ? Clock.currentTimeMillis : Effect.succeed(now), (at) =>
          rounds.updateInvitationStatus(RoundId.make(roundId), PersonId.make(personId), "failed", reason, at),
        ),

      ...organizationSubmissions({ rounds, directory, pulses, actions }),

      ...organizationDirectory({ sql, rounds, directory }),

      ...organizationPersonalData(sql),

      ...organizationOffboarding({ sql, directory, pulses, storage: state.raw.storage }),

      ...organizationSends(sql, sends),
    };
  });
});

type OrganizationShape = Effect.Success<Effect.Success<typeof organizationObject>>;

export default class Organization extends Cloudflare.DurableObject<Organization, OrganizationShape>()(
  "Organization",
) {}

export const OrganizationLive = Organization.make(organizationObject).pipe(
  Layer.provide(Cloudflare.Queues.WriteQueueBinding),
);
