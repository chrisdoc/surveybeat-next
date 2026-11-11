import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailOutbox,
  EmailSender,
  IdentityProvider,
  MembershipId,
  OrganizationDirectory,
  NewIds,
  OrganizationPeople,
  PeopleIndex,
  PersonId,
  OrganizationId,
  OrganizationPulses,
  OrganizationRounds,
  OrganizationActions,
  OrganizationNotes,
  PulseId,
  QuestionId,
  TeamId,
} from "@surveybeat/domain";
import { DELIVERY_PAGE_PATH, SurveyBeatApi, UNSUBSCRIBE_PAGE_PATH } from "@surveybeat/api";
import { EmailTemplatesLive } from "@surveybeat/emails";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Stack } from "alchemy/Stack";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { actionHandlers } from "./ActionHandlers.ts";
import { authBindings, authSettings } from "./auth/AuthConfig.ts";
import { authHandlers } from "./auth/AuthHandlers.ts";
import { d1PeopleIndex } from "./auth/D1PeopleIndex.ts";
import {
  durableObjectActions,
  durableObjectDirectory,
  durableObjectNotes,
  durableObjectPeople,
  durableObjectPulses,
  durableObjectRounds,
} from "./auth/DurableObjectPeople.ts";
import { PEOPLE_TEST_ROUTE, peopleTestRoutes } from "./auth/PeopleTestRoutes.ts";
import { workosIdentityProvider } from "./auth/WorkosIdentityProvider.ts";
import { capturingEmailSender } from "./CapturingEmailSender.ts";
import { cloudflareEmailSender } from "./CloudflareEmailSender.ts";
import { Database } from "./Database.ts";
import { REPAIR_PAGE_SIZE, repairWindow } from "./CronSweep.ts";
import { directoryHandlers } from "./DirectoryHandlers.ts";
import {
  EmailEvents,
  EmailQueue,
  EmailQueueDlq,
  EmailSendRequested,
  SendEmail,
  sendsRealEmail,
} from "./Email.ts";
import {
  handleDeadLetter,
  handleDeliveryEvent,
  handleSendMessage,
  InvitationTokensLive,
} from "./EmailDelivery.ts";
import { emailTestRoutes, isTestStage, TEST_ROUTES } from "./EmailTestRoutes.ts";
import { hostnameFor, mainWorkerDomainFor } from "./Hostnames.ts";
import { noteHandlers } from "./NoteHandlers.ts";
import { pulseHandlers } from "./PulseHandlers.ts";
import { roundHandlers } from "./RoundHandlers.ts";
import { PULSES_TEST_ROUTE, pulseTestRoutes } from "./PulseTestRoutes.ts";
import { ROUNDS_TEST_ROUTE, roundTestRoutes } from "./RoundTestRoutes.ts";
import { REVIEW_TEST_ROUTE, reviewTestRoutes } from "./ReviewWindowTestRoutes.ts";
import { RESEND_EMAIL_TEST_ROUTE, resendEmailTestRoutes } from "./ResendEmailTestRoutes.ts";
import { TEST_INVITATION_TEST_ROUTE, testInvitationTestRoutes } from "./TestInvitationTestRoutes.ts";
import { RESULT_RECOVERY_TEST_ROUTE, resultRecoveryTestRoutes } from "./ResultRecoveryTestRoutes.ts";
import { THEMES_TEST_ROUTE, themesTestRoutes } from "./ThemesTestRoutes.ts";
import Organization from "./Organization.ts";
import { pageRoutes } from "./PageRoutes.ts";
import { Jobs, JobsDlq, type JobMessage } from "./Queues.ts";

/** `apps/web`'s build output. Absolute, so it does not depend on where Alchemy is started. */
const assetsDirectory = new URL("../../../apps/web/dist", import.meta.url).pathname;

/** HttpPlatform normally needs a FileSystem, which does not exist in a Worker isolate. */
const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<"gzip">(),
    compressResponse: (response) => Effect.succeed(response),
  },
  fileResponse: () => Effect.die("HttpPlatform.fileResponse not supported"),
  fileWebResponse: () => Effect.die("HttpPlatform.fileWebResponse not supported"),
});

/** 32 random hex characters. */
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

const newOrganizationId = () => OrganizationId.make(randomId());

/**
 * The Main Worker: the API (domain schemas, `@surveybeat/api` declaration, handlers backed by the
 * Organization Durable Object) plus the static assets built from `apps/web`.
 */
export default class MainWorker extends Cloudflare.Worker<MainWorker>()(
  "Main",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const hostname = hostnameFor(stack.stage, "app");
    const domain = mainWorkerDomainFor(stack.stage);
    return {
      main: import.meta.url,
      // The API routes always reach the Worker. Any other path is a static asset.
      assets: {
        directory: assetsDirectory,
        runWorkerFirst: [
          "/auth/*",
          "/api/*",
          "/delivery",
          "/delivery/*",
          ...(isTestStage(stack.stage)
            ? [
                TEST_ROUTES,
                PEOPLE_TEST_ROUTE,
                PULSES_TEST_ROUTE,
                ROUNDS_TEST_ROUTE,
                THEMES_TEST_ROUTE,
                REVIEW_TEST_ROUTE,
                RESULT_RECOVERY_TEST_ROUTE,
                TEST_INVITATION_TEST_ROUTE,
                RESEND_EMAIL_TEST_ROUTE,
              ]
            : []),
        ],
      },
      // The Organization Durable Object builds email links from this. Stages on workers.dev have none.
      env: {
        ...(yield* authBindings),
        OPENROUTER_API_KEY: Config.Redacted("OPENROUTER_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
        ...(hostname === undefined ? {} : { APP_ORIGIN: `https://${hostname}` }),
      },
      ...(domain === undefined ? {} : { domain }),
    };
  }),
  Effect.gen(function* () {
    const organizations = yield* Organization;
    const jobs = yield* Jobs;
    const jobsDlq = yield* JobsDlq;

    yield* Cloudflare.Queues.consumeQueueMessages<JobMessage>(
      jobs,
      { batchSize: 10, maxRetries: 3, deadLetterQueue: jobsDlq },
      (stream) => Stream.runForEach(stream, () => Effect.log("JOB_PROCESSED")),
    );

    // The dead-letter queue is not drained or alerted on by Cloudflare. Log the code only, never the message.
    yield* Cloudflare.Queues.consumeQueueMessages<JobMessage>(jobsDlq, (stream) =>
      Stream.runForEach(stream, () => Effect.logError("JOB_DEAD_LETTERED")),
    );

    // Transactional email. Production sends through Cloudflare Email Sending; every other stage
    // records the messages in D1 and binds no `send_email` at all (docs/infra.md).
    const { stage } = yield* Stack;
    const database = yield* Cloudflare.D1.QueryDatabase(yield* Database);
    const emailQueue = yield* EmailQueue;
    const emailDlq = yield* EmailQueueDlq;
    const sendClient = sendsRealEmail(stage) ? yield* Cloudflare.Email.Send(yield* SendEmail) : undefined;

    yield* Cloudflare.Queues.consumeQueueMessages(
      emailQueue,
      // Retries cover leases held by another delivery and rejections waiting for their next attempt.
      { batchSize: 10, maxRetries: 10, deadLetterQueue: emailDlq },
      (stream) =>
        Effect.gen(function* () {
          const sender =
            sendClient === undefined
              ? yield* capturingEmailSender(database)
              : yield* cloudflareEmailSender(sendClient);
          yield* Stream.runForEach(stream, (message) =>
            handleSendMessage(organizations, database, message),
          ).pipe(
            Effect.provideService(EmailSender, sender),
            Effect.provide(EmailTemplatesLive.pipe(Layer.provide(InvitationTokensLive))),
          );
        }),
    );
    yield* Cloudflare.Queues.consumeQueueMessages(emailDlq, (stream) =>
      Stream.runForEach(stream, (message) => handleDeadLetter(organizations, message)),
    );

    // Bounces and complaints, from the event subscription on the sending subdomain (infra/alchemy.run.ts).
    if (sendsRealEmail(stage)) {
      yield* Cloudflare.Queues.consumeQueueMessages(
        yield* EmailEvents,
        { batchSize: 10, maxRetries: 5 },
        (stream) =>
          Stream.runForEach(stream, (message) => handleDeliveryEvent(organizations, database, message)),
      );
    }

    // Sign-in. The WorkOS client is built once per isolate (it caches the JWKS), the D1 index per request.
    const settings = yield* Effect.cached(authSettings);
    const identityProvider = yield* Effect.cached(
      Effect.map(settings, ({ workos }) => workosIdentityProvider(workos)),
    );
    const people = durableObjectPeople(organizations);
    const directory = durableObjectDirectory(organizations);
    const pulses = durableObjectPulses(organizations);
    const rounds = durableObjectRounds(organizations);
    const actions = durableObjectActions(organizations);
    const notes = durableObjectNotes(organizations);
    const emailWrites = yield* Cloudflare.Queues.WriteQueue(emailQueue);

    // Daily Cron repairs missing alarms across all Organizations (ADR 0006). One page of the index
    // per run: the read and the Durable Object calls stay bounded as Organizations are added.
    yield* Cloudflare.Workers.cron("0 0 * * *", () =>
      Effect.gen(function* () {
        const day = Math.floor((yield* Clock.currentTimeMillis) / 86_400_000);
        const counted = yield* database
          .prepare("SELECT COUNT(*) AS total FROM organization_index")
          .all<{ total: number }>();
        const window = repairWindow(counted.results[0]?.total ?? 0, day, REPAIR_PAGE_SIZE);
        const orgs = yield* database
          .prepare("SELECT organization_id FROM organization_index ORDER BY organization_id LIMIT ? OFFSET ?")
          .bind(window.limit, window.offset)
          .all<{ organization_id: string }>();
        for (const row of orgs.results) {
          yield* organizations.getByName(row.organization_id).repairAlarm().pipe(Effect.orDie);
        }
      }),
    );

    const services = Effect.gen(function* () {
      const runtime = yield* Effect.context<RuntimeContext>();
      const outbox = EmailOutbox.of({
        // A failed enqueue leaves the send pending; repeating the request queues it again.
        queue: (organizationId, sendId) =>
          Schema.encodeEffect(EmailSendRequested)({ organizationId, sendId }).pipe(
            Effect.flatMap((message) => emailWrites.send(message)),
            Effect.provideContext(runtime),
            Effect.asVoid,
            Effect.orDie,
          ),
      });
      return Context.make(IdentityProvider, yield* identityProvider).pipe(
        Context.add(PeopleIndex, yield* d1PeopleIndex(database)),
        Context.add(OrganizationPeople, people),
        Context.add(OrganizationDirectory, directory),
        Context.add(OrganizationPulses, pulses),
        Context.add(OrganizationRounds, rounds),
        Context.add(OrganizationActions, actions),
        Context.add(OrganizationNotes, notes),
        Context.add(EmailOutbox, outbox),
        Context.add(
          NewIds,
          NewIds.of({
            organizationId: Effect.sync(newOrganizationId),
            personId: Effect.sync(() => PersonId.make(randomId())),
            teamId: Effect.sync(() => TeamId.make(randomId())),
            membershipId: Effect.sync(() => MembershipId.make(randomId())),
            pulseId: Effect.sync(() => PulseId.make(randomId())),
            questionId: Effect.sync(() => QuestionId.make(randomId())),
          }),
        ),
      );
    });
    const auth = authHandlers({ allowlist: Effect.map(settings, ({ allowlist }) => allowlist), services });

    const api = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(SurveyBeatApi).pipe(
        Layer.provide([
          auth,
          directoryHandlers(services),
          pulseHandlers(services),
          roundHandlers(services),
          actionHandlers(services),
          noteHandlers(services),
        ]),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
      ),
    );

    const pages = pageRoutes(organizations, database);
    const testRoutes = isTestStage(stage) ? emailTestRoutes(organizations, emailWrites, database) : undefined;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = request.url.split("?")[0];

        if (path === DELIVERY_PAGE_PATH || path === UNSUBSCRIBE_PAGE_PATH) return yield* pages;

        if (isTestStage(stage)) {
          if (path === TEST_ROUTES && testRoutes) return yield* testRoutes;
          if (path === PEOPLE_TEST_ROUTE) return yield* peopleTestRoutes(organizations, database);
          if (path === PULSES_TEST_ROUTE) return yield* pulseTestRoutes(organizations);
          if (path === ROUNDS_TEST_ROUTE) return yield* roundTestRoutes(organizations, database);
          if (path === THEMES_TEST_ROUTE) return yield* themesTestRoutes(organizations);
          if (path === REVIEW_TEST_ROUTE) return yield* reviewTestRoutes(organizations);
          if (path === RESULT_RECOVERY_TEST_ROUTE) return yield* resultRecoveryTestRoutes(organizations);
          if (path === TEST_INVITATION_TEST_ROUTE)
            return yield* testInvitationTestRoutes(organizations, emailWrites, database);
          if (path === RESEND_EMAIL_TEST_ROUTE)
            return yield* resendEmailTestRoutes(organizations, emailWrites, database);
        }

        return yield* api;
      }).pipe(Effect.orDie),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.Email.SendBinding,
        Cloudflare.Queues.WriteQueueBinding,
        Cloudflare.Workers.CronEventSourceLive,
      ),
    ),
  ),
) {}
