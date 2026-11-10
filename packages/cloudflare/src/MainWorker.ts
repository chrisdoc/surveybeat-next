import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  EmailOutbox,
  EmailSender,
  hashToken,
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
import { SurveyBeatApi } from "@surveybeat/api";
import { EmailTemplatesLive, messagesFor } from "@surveybeat/emails";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
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
import { hostnameFor } from "./Hostnames.ts";
import { noteHandlers } from "./NoteHandlers.ts";
import { pulseHandlers } from "./PulseHandlers.ts";
import { roundHandlers } from "./RoundHandlers.ts";
import { PULSES_TEST_ROUTE, pulseTestRoutes } from "./PulseTestRoutes.ts";
import { ROUNDS_TEST_ROUTE, roundTestRoutes } from "./RoundTestRoutes.ts";
import { THEMES_TEST_ROUTE, themesTestRoutes } from "./ThemesTestRoutes.ts";
import Organization from "./Organization.ts";
import { Jobs, JobsDlq, type JobMessage } from "./Queues.ts";
import {
  pageLocale,
  renderDeliveryPage,
  renderDeliverySuccessPage,
  renderUnsubscribePage,
} from "./ServerPages.ts";

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

/** Plain-text replies from the delivery and unsubscribe routes can be German, so they name their charset. */
const PLAIN_TEXT = "text/plain; charset=utf-8";

/**
 * The Main Worker: the API (domain schemas, `@surveybeat/api` declaration, handlers backed by the
 * Organization Durable Object) plus the static assets built from `apps/web`.
 */
export default class MainWorker extends Cloudflare.Worker<MainWorker>()(
  "Main",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const hostname = hostnameFor(stack.stage, "app");
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
            ? [TEST_ROUTES, PEOPLE_TEST_ROUTE, PULSES_TEST_ROUTE, ROUNDS_TEST_ROUTE, THEMES_TEST_ROUTE]
            : []),
        ],
      },
      // The Organization Durable Object builds email links from this. Stages on workers.dev have none.
      env: {
        ...(yield* authBindings),
        OPENROUTER_API_KEY: Config.Redacted("OPENROUTER_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
        ...(hostname === undefined ? {} : { APP_ORIGIN: `https://${hostname}` }),
      },
      ...(hostname === undefined ? {} : { domain: hostname }),
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

    // Daily Cron repairs missing alarms across all Organizations (ADR 0006)
    yield* Cloudflare.Workers.cron("0 0 * * *", () =>
      Effect.gen(function* () {
        const orgs = yield* database
          .prepare("SELECT organization_id FROM organization_index")
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

    const JsonRecord = Schema.Record(Schema.String, Schema.String);
    const decodeJsonRecord = Schema.decodeUnknownOption(JsonRecord);

    const parseRequestBody = (req: HttpServerRequest): Effect.Effect<Record<string, string>> =>
      Effect.gen(function* () {
        const text = yield* req.text.pipe(Effect.orDie);
        const contentType = req.headers["content-type"] ?? "";
        if (contentType.includes("application/json")) {
          try {
            const parsed = Option.getOrElse(
              decodeJsonRecord(JSON.parse(text)),
              (): Record<string, string> => ({}),
            );
            return { ...parsed };
          } catch {
            return {};
          }
        }
        const params = new URLSearchParams(text);
        const result: Record<string, string> = {};
        for (const [k, v] of params.entries()) {
          result[k] = v;
        }
        return result;
      });

    const testRoutes = isTestStage(stage) ? emailTestRoutes(organizations, emailWrites, database) : undefined;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = request.url.split("?")[0];

        if (path === "/delivery") {
          if (request.method === "HEAD") {
            return HttpServerResponse.empty({ status: 200 });
          }
          if (request.method === "GET") {
            const url = new URL(request.url, "https://app.surveybeat.app");
            const token = url.searchParams.get("token") ?? "";
            const locale = pageLocale(url.searchParams.get("lang"), request.headers["accept-language"]);
            return HttpServerResponse.html(renderDeliveryPage(token, locale));
          }
          if (request.method === "POST") {
            const body = yield* parseRequestBody(request);
            const url = new URL(request.url, "https://app.surveybeat.app");
            const locale = pageLocale(
              url.searchParams.get("lang") ?? body["lang"],
              request.headers["accept-language"],
            );
            const m = messagesFor(locale);
            const token = body["token"] ?? "";
            const timeZone = body["timeZone"] ?? "";
            if (!token || !timeZone) {
              return HttpServerResponse.text(m.message("page.error.missingTokenOrTimeZone"), {
                status: 400,
                contentType: PLAIN_TEXT,
              });
            }
            const tokenHash = yield* Effect.promise(() => hashToken(token));
            const row = yield* database
              .prepare(
                "SELECT organization_id, round_id, person_id, pulse_id FROM invitation_index WHERE token_hash = ?",
              )
              .bind(tokenHash)
              .first<{ organization_id: string; round_id: string; person_id: string; pulse_id: string }>()
              .pipe(Effect.orDie);
            if (row === null) {
              return HttpServerResponse.text(m.message("page.error.invalid"), {
                status: 404,
                contentType: PLAIN_TEXT,
              });
            }
            yield* organizations
              .getByName(row.organization_id)
              .setPersonTimeZone(row.person_id, timeZone)
              .pipe(Effect.orDie);
            const acceptHeader = request.headers["accept"] ?? "";
            if (acceptHeader.includes("application/json")) {
              return yield* HttpServerResponse.json({ ok: true, timeZone }).pipe(Effect.orDie);
            }
            return HttpServerResponse.html(renderDeliverySuccessPage(timeZone, locale));
          }
          return HttpServerResponse.empty({ status: 405 });
        }

        if (path === "/api/reminders/unsubscribe") {
          if (request.method === "HEAD") {
            return HttpServerResponse.empty({ status: 200 });
          }
          if (request.method === "GET") {
            const url = new URL(request.url, "https://app.surveybeat.app");
            const token = url.searchParams.get("t") ?? "";
            const locale = pageLocale(url.searchParams.get("lang"), request.headers["accept-language"]);
            return HttpServerResponse.html(renderUnsubscribePage(token, locale));
          }
          if (request.method === "POST") {
            const url = new URL(request.url, "https://app.surveybeat.app");
            const body = yield* parseRequestBody(request);
            const locale = pageLocale(
              url.searchParams.get("lang") ?? body["lang"],
              request.headers["accept-language"],
            );
            const m = messagesFor(locale);
            let token = url.searchParams.get("t");
            if (!token) {
              token = body["t"] ?? body["token"] ?? null;
            }
            if (!token) {
              return HttpServerResponse.text(m.message("page.error.missingToken"), {
                status: 400,
                contentType: PLAIN_TEXT,
              });
            }
            const tokenHash = yield* Effect.promise(() => hashToken(token));
            const row = yield* database
              .prepare(
                "SELECT organization_id, round_id, person_id, pulse_id FROM invitation_index WHERE token_hash = ?",
              )
              .bind(tokenHash)
              .first<{ organization_id: string; round_id: string; person_id: string; pulse_id: string }>()
              .pipe(Effect.orDie);
            if (row === null) {
              return HttpServerResponse.text(m.message("page.error.invalid"), {
                status: 404,
                contentType: PLAIN_TEXT,
              });
            }
            yield* organizations
              .getByName(row.organization_id)
              .optOutReminders(row.pulse_id, row.person_id)
              .pipe(Effect.orDie);
            return HttpServerResponse.text(m.message("page.unsubscribed"), { contentType: PLAIN_TEXT });
          }
          return HttpServerResponse.empty({ status: 405 });
        }

        if (isTestStage(stage)) {
          if (path === TEST_ROUTES && testRoutes) return yield* testRoutes;
          if (path === PEOPLE_TEST_ROUTE) return yield* peopleTestRoutes(organizations, database);
          if (path === PULSES_TEST_ROUTE) return yield* pulseTestRoutes(organizations);
          if (path === ROUNDS_TEST_ROUTE) return yield* roundTestRoutes(organizations, database);
          if (path === THEMES_TEST_ROUTE) return yield* themesTestRoutes(organizations);
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
