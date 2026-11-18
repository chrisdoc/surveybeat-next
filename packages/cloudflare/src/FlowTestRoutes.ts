import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const FLOW_TEST_ROUTE = "/__test/flow/open-round";

export const flowTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    if (request.method !== "POST") {
      return yield* HttpServerResponse.json({ error: "method not allowed" }, { status: 405 });
    }
    const params = new URL(request.url, "http://localhost").searchParams;
    const organization = organizations.getByName(params.get("organization") ?? "");
    const scheduled = yield* organization.scheduledRoundFor(params.get("pulse") ?? "");
    if (scheduled === null) {
      return yield* HttpServerResponse.json({ error: "no scheduled round" }, { status: 404 });
    }

    const now = yield* Clock.currentTimeMillis;
    const openJob = (yield* organization.getJobsForRound(scheduled.id)).find(
      (job) => job.type === "open" && job.status === "pending",
    );
    if (openJob === undefined) {
      return yield* HttpServerResponse.json({ error: "no pending open job" }, { status: 409 });
    }
    yield* organization.runScheduleJob(openJob.id, now);

    const sendJobs = (yield* organization.getJobsForRound(scheduled.id)).filter(
      (job) => job.type === "send" && job.status === "pending",
    );
    for (const job of sendJobs) {
      yield* organization.runScheduleJob(job.id, now);
    }

    return yield* HttpServerResponse.json({ roundId: scheduled.id });
  }).pipe(Effect.orDie);
