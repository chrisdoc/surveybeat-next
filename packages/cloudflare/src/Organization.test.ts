import "./auth/localTestSecrets.ts";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { SurveyBeatApi } from "@surveybeat/api";
import { OrganizationId } from "@surveybeat/domain";
import * as Alchemy from "alchemy";
import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import MainWorker from "./MainWorker.ts";

// The adapter on local workerd (`dev: true`): the real Main Worker and Organization Durable Object.
const { test, beforeAll, deploy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const Stack = Alchemy.Stack(
  "SurveybeatOrganizationTest",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const main = yield* MainWorker;
    return { url: main.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 240_000 });

const makeClient = Effect.gen(function* () {
  const { url } = yield* stack;
  return yield* HttpApiClient.make(SurveyBeatApi, { baseUrl: url });
});

test(
  "creates an Organization and reads it back",
  Effect.gen(function* () {
    const client = yield* makeClient;
    const created = yield* client.organizations.create({ payload: { name: "Acme" } });
    assert.strictEqual(created.name, "Acme");
    const fetched = yield* client.organizations.getById({ params: { id: created.id } });
    assert.deepStrictEqual(fetched, created);
  }),
);

test(
  "answers OrganizationNotFound for an unknown or malformed id",
  Effect.gen(function* () {
    const client = yield* makeClient;
    for (const id of ["0".repeat(32), "not-an-id"]) {
      const error = yield* client.organizations
        .getById({ params: { id: OrganizationId.make(id) } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "OrganizationNotFound");
    }
  }),
);

test(
  "keeps the creator active, links People added by email at sign-in, and denies a removed one",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/people?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body: unknown = yield* Effect.promise(() => response.json());
    const none = { _id: "Option", _tag: "None" };
    const some = (value: unknown) => ({ _id: "Option", _tag: "Some", value });
    const eve = `added-1-${run}`;
    const ada = `added-2-${run}`;
    const acme = { id: `people-${run}`, name: "Acme" };
    assert.deepStrictEqual(body, {
      adminActive: some({ personId: `admin-${run}`, organizationAdmin: true }),
      eveActiveBeforeAdded: none,
      relinkSameUser: true,
      takeOverByOtherUser: false,
      linkMissingPerson: false,
      // Added by email: the D1 index offers the Person to that email until it is linked.
      unlinked: [{ organization: acme, personId: eve, linked: false }],
      eveSignIn: { _tag: "SignedIn", organization: acme, personId: eve, organizationAdmin: false },
      adaSignIn: { _tag: "SignedIn", organization: acme, personId: ada, organizationAdmin: false },
      linked: {
        eveActive: some({ personId: eve, organizationAdmin: false }),
        eveIndexed: [{ organization: acme, personId: eve, linked: true }],
        eveUnlinkedAfter: [],
      },
      removed: { adaActive: none, adaIndexed: [], adaSignInAgain: { _tag: "NotInOrganization" } },
      // Ada's Membership ended with her removal; Eve, the Lead, stays.
      roster: [{ personId: eve, email: "eve@example.com", role: "lead" }],
      // WorkOS memberships only once each signs in, and Ada's deactivated on removal (ADR 0010).
      workosCalls: [
        `ensure user_eve_${run} member`,
        `ensure user_ada_${run} member`,
        `deactivate user_ada_${run}`,
      ],
      queued: [`added-membership-1-${run}`, `added-membership-2-${run}`],
    });
  }),
);

test(
  "reads its sign-in bindings: a request without a session is unauthenticated, and login goes to AuthKit",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const session = yield* Effect.promise(() => fetch(`${url}/auth/session`));
    assert.strictEqual(session.status, 401);
    const login = yield* Effect.promise(() => fetch(`${url}/auth/login`, { redirect: "manual" }));
    assert.strictEqual(login.status, 302);
    const location = new URL(login.headers.get("location") ?? "");
    assert.strictEqual(location.searchParams.get("client_id"), "client_local_adapter_tests");
    assert.strictEqual(location.searchParams.get("redirect_uri"), `${url}/auth/callback`);
  }),
);

test(
  "stores the question library and Pulses: create from the Template, edit, and read back in order",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/pulses?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      results: unknown;
      view: { _tag: string; value: Record<string, unknown> & { questions: Array<Record<string, unknown>> } };
      list: unknown;
      first: string;
      rest: Array<string>;
    };
    assert.deepStrictEqual(body.results, {
      created: "Accepted",
      createdAgain: "Accepted",
      removed: "Accepted",
      reordered: "Accepted",
      addedBack: "Accepted",
      addedWritten: "Accepted",
      edited: "Accepted",
      settings: "Accepted",
      reorderMismatch: "OrderMismatch",
    });
    const pulseId = `pulse-${run}`;
    const { view } = body;
    assert.strictEqual(view._tag, "Viewed");
    assert.deepStrictEqual(view.value["settings"], {
      name: "Friday check-in",
      cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
      answerWindowDays: 6,
      reminders: 0,
      anonymityMode: "anonymous",
      distribution: "invitation",
    });
    const written = `written-${run}`;
    assert.deepStrictEqual(
      view.value.questions.map((question) => question["questionId"]),
      [...[...body.rest].reverse(), `again-${run}`, written],
    );
    assert.strictEqual(body.first, `${pulseId}.workload-manageable`);
    assert.deepStrictEqual(view.value.questions.at(-2)?.["templateKey"], "workload-manageable");
    // The edit rewrote the written Question's first and only version.
    assert.deepStrictEqual(view.value.questions.at(-1), {
      questionId: written,
      versionId: `${written}.1`,
      templateKey: null,
      text: "How was the offsite?",
      dimension: "recognition",
      type: { _tag: "Rating", lowLabel: "Poor", highLabel: "Great", comment: true },
      hasAnswers: false,
      estimatedSeconds: 6,
    });
    assert.deepStrictEqual(view.value["warnings"], [
      { _tag: "NoOneTap" },
      { _tag: "TeamBelowMinimumGroupSize", members: 1, minimumGroupSize: 4 },
    ]);
    assert.deepStrictEqual(body.list, {
      _tag: "Viewed",
      value: {
        team: { id: `team-${run}`, name: "Platform", timeZone: "Europe/Berlin", yourRole: null },
        pulses: [
          {
            id: pulseId,
            name: "Friday check-in",
            cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
            questionCount: 7,
            estimatedSeconds: 70,
          },
        ],
      },
    });
  }),
);

test(
  "Round lifecycle engine: alarm points at earliest due job, next Round is never duplicated, and jobs are idempotent",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const run = crypto.randomUUID();
    const response = yield* Effect.promise(() => fetch(`${url}/__test/rounds?run=${run}`));
    assert.strictEqual(response.status, 200);
    const body = (yield* Effect.promise(() => response.json())) as {
      initialAlarm: unknown;
      earliestDue1: unknown;
      alarmPointsToEarliest1: boolean;
      notDuplicated: boolean;
      openIdempotent: boolean;
      closeIdempotent: boolean;
      alarmPointsToEarliest2: boolean;
    };
    assert.strictEqual(body.alarmPointsToEarliest1, true);
    assert.strictEqual(body.notDuplicated, true);
    assert.strictEqual(body.openIdempotent, true);
    assert.strictEqual(body.closeIdempotent, true);
    assert.strictEqual(body.alarmPointsToEarliest2, true);
  }),
);
