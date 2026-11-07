import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { assert } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import MainWorker from "./MainWorker.ts";

// The real Main Worker, Organization Durable Object, Email queue, and D1 on local workerd.
// A test stage records email in D1 instead of sending it, so this checks what would have gone out.
const { test, beforeAll, deploy } = Test.make({ providers: Cloudflare.providers(), dev: true });

const Stack = Alchemy.Stack(
  "SurveybeatEmailTest",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const main = yield* MainWorker;
    return { url: main.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 240_000 });

interface Probe {
  readonly state: ({ readonly _tag: string } & Readonly<Record<string, unknown>>) | null;
  readonly captured: ReadonlyArray<{
    readonly recipient: string;
    readonly subject: string;
    readonly text: string;
  }>;
  readonly indexed: ReadonlyArray<{ readonly organization_id: string; readonly send_id: string }>;
}

const call = (method: "GET" | "POST", query: string) =>
  Effect.gen(function* () {
    const { url } = yield* stack;
    const response = yield* Effect.promise(() => fetch(`${url}/__test/email?${query}`, { method }));
    assert.strictEqual(response.status, 200);
    return yield* Effect.promise(() => response.json() as Promise<Probe>);
  });

test(
  "renders and records a queued email once, even when it is queued twice",
  Effect.gen(function* () {
    const organization = crypto.randomUUID().replaceAll("-", "");
    const query = `organization=${organization}&send=added-1`;

    const first = yield* call("POST", query);
    assert.deepStrictEqual(first.state, { _tag: "Pending", attempts: 0, lastCode: null });
    // Queued again before the consumer ran: two queue messages for the same send.
    yield* call("POST", query);

    const done = yield* call("GET", query).pipe(
      Effect.repeat({
        until: (probe) => probe.state?._tag === "Sent",
        schedule: Schedule.spaced("250 millis"),
        times: 80,
      }),
    );
    assert.strictEqual(done.state?._tag, "Sent");
    assert.deepStrictEqual(
      done.captured.map(({ recipient, subject }) => ({ recipient, subject })),
      [{ recipient: "ada@example.com", subject: "You've been added to Platform" }],
    );
    assert.include(done.captured[0]?.text ?? "", "Open SurveyBeat: https://app.surveybeat.app/");
    assert.deepStrictEqual(done.indexed, [{ organization_id: organization, send_id: "added-1" }]);

    // A later delivery of the same send changes nothing.
    yield* call("POST", query);
    yield* Effect.sleep("2 seconds");
    const after = yield* call("GET", query);
    assert.strictEqual(after.state?._tag, "Sent");
    assert.strictEqual(after.captured.length, 1);
  }),
  { timeout: 120_000 },
);
