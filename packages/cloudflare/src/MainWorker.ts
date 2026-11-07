import * as Cloudflare from "@alchemy.run/cloudflare";
import { Organization as OrganizationModel, OrganizationId, OrganizationNotFound } from "@surveybeat/domain";
import { SurveyBeatApi } from "@surveybeat/api";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
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

const newOrganizationId = () =>
  OrganizationId.make(
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    ),
  );

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
      assets: { directory: assetsDirectory, runWorkerFirst: ["/orgs", "/orgs/*"] },
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

    const api = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(SurveyBeatApi).pipe(
        Layer.provide(group),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
      ),
    );

    return { fetch: api };
  }).pipe(Effect.provide(Cloudflare.Queues.EventSourceLive)),
) {}
