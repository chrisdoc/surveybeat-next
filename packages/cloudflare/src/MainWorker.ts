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
  Organization as OrganizationModel,
  OrganizationId,
  OrganizationNotFound,
  TeamId,
} from "@surveybeat/domain";
import { SurveyBeatApi } from "@surveybeat/api";
import { EmailTemplatesLive } from "@surveybeat/emails";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Stack } from "alchemy/Stack";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { authBindings, authSettings } from "./auth/AuthConfig.ts";
import { authHandlers } from "./auth/AuthHandlers.ts";
import { d1PeopleIndex } from "./auth/D1PeopleIndex.ts";
import { durableObjectDirectory, durableObjectPeople } from "./auth/DurableObjectPeople.ts";
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
          ...(isTestStage(stack.stage) ? [TEST_ROUTES, PEOPLE_TEST_ROUTE] : []),
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
    const emailWrites = yield* Cloudflare.Queues.WriteQueue(emailQueue);
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
        Context.add(EmailOutbox, outbox),
        Context.add(
          NewIds,
          NewIds.of({
            organizationId: Effect.sync(newOrganizationId),
            personId: Effect.sync(() => PersonId.make(randomId())),
            teamId: Effect.sync(() => TeamId.make(randomId())),
            membershipId: Effect.sync(() => MembershipId.make(randomId())),
          }),
        ),
      );
    });
    const auth = authHandlers({ allowlist: Effect.map(settings, ({ allowlist }) => allowlist), services });

    const api = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(SurveyBeatApi).pipe(
        Layer.provide([group, auth, directoryHandlers(services)]),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
      ),
    );

    if (!isTestStage(stage)) return { fetch: api };
    const testRoutes = emailTestRoutes(organizations, emailWrites, database);
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = request.url.split("?")[0];
        if (path === TEST_ROUTES) return yield* testRoutes;
        if (path === PEOPLE_TEST_ROUTE) return yield* peopleTestRoutes(organizations, database);
        return yield* api;
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.Email.SendBinding,
        Cloudflare.Queues.WriteQueueBinding,
      ),
    ),
  ),
) {}
