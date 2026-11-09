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
  Organization as OrganizationModel,
  OrganizationId,
  OrganizationNotFound,
  OrganizationPulses,
  OrganizationRounds,
  OrganizationActions,
  PulseId,
  QuestionId,
  TeamId,
} from "@surveybeat/domain";
import { SurveyBeatApi } from "@surveybeat/api";
import { EmailTemplatesLive } from "@surveybeat/emails";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Stack } from "alchemy/Stack";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
import { handleDeadLetter, handleDeliveryEvent, handleSendMessage } from "./EmailDelivery.ts";
import { emailTestRoutes, isTestStage, TEST_ROUTES } from "./EmailTestRoutes.ts";
import { hostnameFor } from "./Hostnames.ts";
import { pulseHandlers } from "./PulseHandlers.ts";
import { roundHandlers } from "./RoundHandlers.ts";
import { PULSES_TEST_ROUTE, pulseTestRoutes } from "./PulseTestRoutes.ts";
import { ROUNDS_TEST_ROUTE, roundTestRoutes } from "./RoundTestRoutes.ts";
import Organization from "./Organization.ts";
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

/** Ids we mint are 32 hex characters. Anything else cannot exist, so no Durable Object is woken for it. */
const isOrganizationId = (id: string) => /^[0-9a-f]{32}$/.test(id);

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
          "/orgs",
          "/orgs/*",
          "/auth/*",
          "/api/*",
          "/delivery",
          "/delivery/*",
          ...(isTestStage(stack.stage)
            ? [TEST_ROUTES, PEOPLE_TEST_ROUTE, PULSES_TEST_ROUTE, ROUNDS_TEST_ROUTE]
            : []),
        ],
      },
      env: yield* authBindings,
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
          ).pipe(Effect.provideService(EmailSender, sender), Effect.provide(EmailTemplatesLive));
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

    const group = HttpApiBuilder.group(SurveyBeatApi, "organizations", (handlers) =>
      handlers
        .handle("create", ({ payload }) =>
          Effect.gen(function* () {
            const id = newOrganizationId();
            const created = yield* organizations.getByName(id).create(id, payload.name);
            return OrganizationModel.make({ id: OrganizationId.make(created.id), name: created.name });
          }).pipe(Effect.orDie),
        )
        .handle("getById", ({ params }) =>
          Effect.gen(function* () {
            if (!isOrganizationId(params.id)) return yield* new OrganizationNotFound();
            const found = yield* organizations.getByName(params.id).get(params.id).pipe(Effect.orDie);
            if (found === null) return yield* new OrganizationNotFound();
            return OrganizationModel.make({ id: OrganizationId.make(found.id), name: found.name });
          }),
        ),
    );

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
          group,
          auth,
          directoryHandlers(services),
          pulseHandlers(services),
          roundHandlers(services),
          actionHandlers(services),
        ]),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
      ),
    );

    const renderDeliveryPage = (token: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Change delivery time · SurveyBeat</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
    select, button { width: 100%; padding: 0.625rem; border-radius: 0.375rem; font-size: 0.875rem; box-sizing: border-box; }
    select { background: #0f172a; border: 1px solid #334155; color: #f8fafc; margin-bottom: 1.25rem; }
    button { background: #3b82f6; color: white; border: none; font-weight: 500; cursor: pointer; }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Change delivery time</h1>
    <p>We'll deliver your check-ins and reminders at your local time.</p>
    <form method="POST" action="/delivery">
      <input type="hidden" name="token" value="${token}" />
      <label for="timeZone">Time zone</label>
      <select name="timeZone" id="timeZone" required>
        <option value="Europe/Berlin">Europe/Berlin</option>
        <option value="Europe/London">Europe/London</option>
        <option value="America/New_York">America/New_York</option>
        <option value="America/Chicago">America/Chicago</option>
        <option value="America/Denver">America/Denver</option>
        <option value="America/Los_Angeles">America/Los_Angeles</option>
        <option value="Asia/Tokyo">Asia/Tokyo</option>
        <option value="UTC">UTC</option>
      </select>
      <button type="submit">Save preference</button>
    </form>
    <script>
      try {
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (userTz) {
          const sel = document.getElementById("timeZone");
          let found = false;
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === userTz) { sel.selectedIndex = i; found = true; break; }
          }
          if (!found) {
            const opt = document.createElement("option");
            opt.value = userTz;
            opt.text = userTz;
            opt.selected = true;
            sel.prepend(opt);
          }
        }
      } catch (e) {}
    </script>
  </div>
</body>
</html>`;

    const renderDeliverySuccessPage = (timeZone: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Delivery preference updated · SurveyBeat</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; color: #34d399; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Preferences updated</h1>
    <p>Your delivery time zone has been set to <strong>${timeZone}</strong>.</p>
  </div>
</body>
</html>`;

    const renderUnsubscribePage = (token: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Turn off reminders · SurveyBeat</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
    button { width: 100%; padding: 0.625rem; border-radius: 0.375rem; font-size: 0.875rem; box-sizing: border-box; background: #ef4444; color: white; border: none; font-weight: 500; cursor: pointer; }
    button:hover { background: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Turn off reminders</h1>
    <p>You will no longer receive reminders for this Pulse check-in.</p>
    <form method="POST" action="/api/reminders/unsubscribe">
      <input type="hidden" name="t" value="${token}" />
      <button type="submit">Turn off reminders</button>
    </form>
  </div>
</body>
</html>`;

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
            return HttpServerResponse.html(renderDeliveryPage(token));
          }
          if (request.method === "POST") {
            const body = yield* parseRequestBody(request);
            const token = body["token"] ?? "";
            const timeZone = body["timeZone"] ?? "";
            if (!token || !timeZone) {
              return HttpServerResponse.text("Missing token or timeZone", { status: 400 });
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
              return HttpServerResponse.text("Invitation link not found or expired", { status: 404 });
            }
            yield* organizations
              .getByName(row.organization_id)
              .setPersonTimeZone(row.person_id, timeZone)
              .pipe(Effect.orDie);
            const acceptHeader = request.headers["accept"] ?? "";
            if (acceptHeader.includes("application/json")) {
              return yield* HttpServerResponse.json({ ok: true, timeZone }).pipe(Effect.orDie);
            }
            return HttpServerResponse.html(renderDeliverySuccessPage(timeZone));
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
            return HttpServerResponse.html(renderUnsubscribePage(token));
          }
          if (request.method === "POST") {
            const url = new URL(request.url, "https://app.surveybeat.app");
            let token = url.searchParams.get("t");
            if (!token) {
              const body = yield* parseRequestBody(request);
              token = body["t"] ?? body["token"] ?? null;
            }
            if (!token) {
              return HttpServerResponse.text("Missing token", { status: 400 });
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
              return HttpServerResponse.text("Invitation link not found or expired", { status: 404 });
            }
            yield* organizations
              .getByName(row.organization_id)
              .optOutReminders(row.pulse_id, row.person_id)
              .pipe(Effect.orDie);
            return HttpServerResponse.text("Unsubscribed from reminders.");
          }
          return HttpServerResponse.empty({ status: 405 });
        }

        if (isTestStage(stage)) {
          if (path === TEST_ROUTES && testRoutes) return yield* testRoutes;
          if (path === PEOPLE_TEST_ROUTE) return yield* peopleTestRoutes(organizations, database);
          if (path === PULSES_TEST_ROUTE) return yield* pulseTestRoutes(organizations);
          if (path === ROUNDS_TEST_ROUTE) return yield* roundTestRoutes(organizations, database);
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
