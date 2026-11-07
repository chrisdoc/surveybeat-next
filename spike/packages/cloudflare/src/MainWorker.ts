import * as Cloudflare from "@alchemy.run/cloudflare";
import { SpikeApi } from "@spike/api";
import { Organization as OrganizationModel, OrganizationNotFound } from "@spike/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import Organization from "./Organization.ts";
import { Jobs, JobsDlq, type JobMessage } from "./Queues.ts";

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

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export default class MainWorker extends Cloudflare.Worker<MainWorker>()(
  "Main",
  { main: import.meta.url },
  Effect.gen(function* () {
    const orgs = yield* Organization;
    const jobsQueue = yield* Jobs;
    const dlqQueue = yield* JobsDlq;
    const jobs = yield* Cloudflare.Queues.WriteQueue(jobsQueue);

    // Queue consumer: fails on purpose when `fail` is set. After maxRetries it is dead-lettered.
    yield* Cloudflare.Queues.consumeQueueMessages<JobMessage>(
      jobsQueue,
      {
        batchSize: 1,
        maxRetries: 2,
        retryDelay: 1,
        maxWaitTime: "1 second",
        deadLetterQueue: dlqQueue,
      },
      (stream) =>
        Stream.runForEach(stream, (msg) =>
          msg.body.fail
            ? Effect.fail(
                new Error(`job ${msg.body.id} failed on purpose (attempt ${msg.attempts})`),
              )
            : Effect.log(`job ${msg.body.id} ok`),
        ),
    );

    // The DLQ needs its own consumer: Cloudflare neither drains nor alerts on it.
    yield* Cloudflare.Queues.consumeQueueMessages<JobMessage>(dlqQueue, (stream) =>
      Stream.runForEach(stream, (msg) =>
        Effect.gen(function* () {
          yield* Effect.log(`DLQ received ${msg.body.id} after ${msg.attempts} attempts`);
          yield* orgs.getByName("dlq").logDlq(JSON.stringify(msg.body), msg.attempts);
        }).pipe(Effect.orDie),
      ),
    );

    const group = HttpApiBuilder.group(SpikeApi, "organizations", (handlers) =>
      handlers
        .handle("create", ({ payload }) =>
          Effect.gen(function* () {
            const id = randomId();
            const org = yield* orgs.getByName(id).create(id, payload.name);
            return new OrganizationModel(org);
          }).pipe(Effect.orDie),
        )
        .handle("get", ({ params }) =>
          Effect.gen(function* () {
            const org = yield* orgs.getByName(params.id).get(params.id).pipe(Effect.orDie);
            if (org === null)
              return yield* Effect.fail(new OrganizationNotFound({ id: params.id }));
            return new OrganizationModel(org);
          }),
        ),
    );

    const api = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(SpikeApi).pipe(
        Layer.provide(group),
        Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
      ),
    );

    const json = (body: unknown, status = 200) => HttpServerResponse.json(body, { status });

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://x");
        const path = url.pathname;

        // ---- spike-only debug routes (not part of the HttpApi) ----
        if (path === "/queue/send" && request.method === "POST") {
          const id = url.searchParams.get("id") ?? crypto.randomUUID();
          const fail = url.searchParams.get("fail") === "1";
          yield* jobs.send({ id, fail } satisfies JobMessage).pipe(Effect.orDie);
          return yield* json({ sent: { id, fail } }, 202);
        }
        if (path === "/debug/dlq") {
          return yield* json(yield* orgs.getByName("dlq").dlqLog().pipe(Effect.orDie));
        }
        let m = /^\/debug\/orgs\/([0-9a-f]{32})\/(schema|counts|alarm-log)$/.exec(path);
        if (m) {
          const stub = orgs.getByName(m[1]!);
          const what = m[2];
          const out =
            what === "schema"
              ? yield* stub.introspect().pipe(Effect.orDie)
              : what === "counts"
                ? yield* stub.counts().pipe(Effect.orDie)
                : yield* stub.alarmLog().pipe(Effect.orDie);
          return yield* json(out);
        }
        m = /^\/debug\/orgs\/([0-9a-f]{32})\/arm-alarm$/.exec(path);
        if (m && request.method === "POST") {
          const delay = Number(url.searchParams.get("ms") ?? "30000");
          return yield* json(yield* orgs.getByName(m[1]!).armAlarm(delay).pipe(Effect.orDie));
        }
        m = /^\/debug\/orgs\/([0-9a-f]{32})\/create-then-fail$/.exec(path);
        if (m && request.method === "POST") {
          const stub = orgs.getByName(m[1]!);
          const fresh = randomId();
          const before = yield* stub.counts().pipe(Effect.orDie);
          const result = yield* stub.createThenFail(fresh, "rolled-back").pipe(Effect.orDie);
          const after = yield* stub.counts().pipe(Effect.orDie);
          const leaked = yield* stub.get(fresh).pipe(Effect.orDie);
          return yield* json({ result, before, after, leakedRow: leaked });
        }

        return yield* api;
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Cloudflare.Queues.WriteQueueBinding, Cloudflare.Queues.EventSourceLive),
    ),
  ),
) {}
