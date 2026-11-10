import type * as Cloudflare from "@alchemy.run/cloudflare";
import { assert, describe, it } from "@effect/vitest";
import { hashToken } from "@surveybeat/domain";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Organizations } from "./EmailDelivery.ts";
import { submissionRoutes } from "./SubmissionRoutes.ts";

const d1MigrationsDir = new URL("../d1-migrations/", import.meta.url);

const EDIT_KEY = "CANARY-EDIT-KEY-raw-value";
const TOKEN = "CANARY-INVITATION-TOKEN-raw-value";
const FRESH_EDIT_KEY = "fresh-edit-key-for-first-answer";
const CANARY_ANSWER = "CANARY-ANSWER";
const TEST_TOKEN = "CANARY-TEST-INVITATION-TOKEN-raw-value";
const TEST_EDIT_KEY = "CANARY-TEST-EDIT-KEY-raw-value";
const TEST_PREVIEW = "preview the Lead would see";

const setupD1 = (): { readonly d1: DatabaseSync; readonly queryDb: Cloudflare.D1.QueryDatabaseClient } => {
  const d1 = new DatabaseSync(":memory:");
  for (const file of readdirSync(d1MigrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    d1.exec(readFileSync(new URL(file, d1MigrationsDir), "utf8"));
  }

  const statement = (sql: string, binds: ReadonlyArray<unknown>) => ({
    bind: (...values: ReadonlyArray<unknown>) => statement(sql, values),
    first: <T>() =>
      Effect.sync(
        () => (d1.prepare(sql).get(...(binds as Array<null | string | number>)) ?? null) as T | null,
      ),
    all: <T>() =>
      Effect.sync(() => ({
        results: d1.prepare(sql).all(...(binds as Array<null | string | number>)) as Array<T>,
      })),
    run: () =>
      Effect.sync(() => {
        d1.prepare(sql).run(...(binds as Array<null | string | number>));
        return { results: [] };
      }),
  });

  const queryDb = {
    prepare: (sql: string) => statement(sql, []),
  } as unknown as Cloudflare.D1.QueryDatabaseClient;

  return { d1, queryDb };
};

/**
 * Fake Organizations that answers every method with the same Submission answers and records each
 * call. Any call, including `getByName` itself, lands in `calls`.
 */
const recordingOrganizations = () => {
  const calls: Array<string> = [];
  const result = {
    _tag: "Success",
    answers: [{ questionVersionId: "qv-1", value: 5, comment: CANARY_ANSWER }],
    shownToLead: false,
  };
  // What the test methods return: a test context, and the preview of a test answer.
  const testResults: Record<string, unknown> = {
    getTestSubmissionContext: {
      roundId: "test-pulse-1",
      pulseName: "Pulse",
      minimumGroupSize: 4,
      questions: [],
      actions: [],
      closeTime: 0,
      state: "open",
      hasAnswered: false,
      aiProcessing: false,
      test: true,
    },
    previewTestAnswers: { shownToLead: TEST_PREVIEW },
  };
  const organizationFor = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== "string") return undefined;
          calls.push(method);
          return () => Effect.succeed(method in testResults ? testResults[method] : result);
        },
      },
    );
  const organizations = new Proxy(
    {},
    {
      get: (_target, method) => {
        if (typeof method !== "string") return undefined;
        calls.push(method);
        return () => organizationFor();
      },
    },
  ) as unknown as Organizations;
  return { organizations, calls };
};

const makeRequest = (
  method: string,
  urlPath: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): HttpServerRequest => {
  const bodyText = body ? JSON.stringify(body) : "";
  return {
    method,
    // HttpServerRequest.url is the path plus query, not an absolute URL.
    url: urlPath,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    text: Effect.succeed(bodyText),
    json: Effect.sync(() => (body ? body : {})),
  } as unknown as HttpServerRequest;
};

const bodyText = (response: HttpServerResponse.HttpServerResponse): string => {
  const body = response.body;
  switch (body._tag) {
    case "Empty":
      return "";
    case "Uint8Array":
      return new TextDecoder().decode(body.body);
    case "Raw":
      return JSON.stringify(body.body);
    default:
      throw new Error(`unexpected response body ${body._tag}`);
  }
};

type Hashes = { readonly editKeyHash: string; readonly freshHash: string };

/** Test rows to seed on top of the real ones: an unexpired (or expired) test token and test Edit key. */
type TestSeed = { readonly testInvitationExpiresAt?: number; readonly testSubmissionExpiresAt?: number };

/**
 * Seeds D1 with a Submission for EDIT_KEY and an Invitation for TOKEN, runs the request built from
 * the seeded hashes through the routes, and returns what came back.
 */
const runWith = (build: (hashes: Hashes) => HttpServerRequest, testSeed: TestSeed = {}) =>
  Effect.gen(function* () {
    const { d1, queryDb } = setupD1();
    const editKeyHash = yield* Effect.promise(() => hashToken(EDIT_KEY));
    const freshHash = yield* Effect.promise(() => hashToken(FRESH_EDIT_KEY));
    const tokenHash = yield* Effect.promise(() => hashToken(TOKEN));
    d1.prepare(
      "INSERT INTO submission_index (edit_key_hash, organization_id, round_id) VALUES (?, ?, ?)",
    ).run(editKeyHash, "org-1", "round-1");
    d1.prepare(
      "INSERT INTO invitation_index (token_hash, organization_id, round_id, person_id, pulse_id) VALUES (?, ?, ?, ?, ?)",
    ).run(tokenHash, "org-1", "round-1", "person-1", "pulse-1");
    if (testSeed.testInvitationExpiresAt !== undefined) {
      const testTokenHash = yield* Effect.promise(() => hashToken(TEST_TOKEN));
      d1.prepare(
        "INSERT INTO test_invitation_index (token_hash, organization_id, pulse_id, expires_at) VALUES (?, ?, ?, ?)",
      ).run(testTokenHash, "org-1", "pulse-1", testSeed.testInvitationExpiresAt);
    }
    if (testSeed.testSubmissionExpiresAt !== undefined) {
      const testEditKeyHash = yield* Effect.promise(() => hashToken(TEST_EDIT_KEY));
      d1.prepare(
        "INSERT INTO test_submission_index (edit_key_hash, organization_id, pulse_id, expires_at) VALUES (?, ?, ?, ?)",
      ).run(testEditKeyHash, "org-1", "pulse-1", testSeed.testSubmissionExpiresAt);
    }
    const { organizations, calls } = recordingOrganizations();
    const response = yield* submissionRoutes(organizations, queryDb).pipe(
      Effect.provideService(HttpServerRequest, build({ editKeyHash, freshHash })),
      // The Organization methods read the alchemy runtime; the fake needs only an empty one.
      Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]),
    );
    return { response, text: bodyText(response), calls, d1, freshHash };
  });

const cases: ReadonlyArray<{
  readonly name: string;
  readonly build: (path: string, editKeyHash: string) => HttpServerRequest;
}> = [
  {
    name: "body editKeyHash",
    build: (path, hash) => makeRequest("POST", path, { editKeyHash: hash }),
  },
  {
    name: "body edit_key_hash",
    build: (path, hash) => makeRequest("POST", path, { edit_key_hash: hash }),
  },
  {
    name: "query editKeyHash",
    build: (path, hash) => makeRequest("POST", `${path}?editKeyHash=${hash}`),
  },
  {
    name: "query edit_key_hash",
    build: (path, hash) => makeRequest("POST", `${path}?edit_key_hash=${hash}`),
  },
  {
    name: "query editKey (raw Edit key)",
    build: (path) => makeRequest("POST", `${path}?editKey=${EDIT_KEY}`),
  },
  {
    name: "body editKey (raw Edit key)",
    build: (path) => makeRequest("POST", path, { editKey: EDIT_KEY }),
  },
  {
    name: "header x-edit-key (raw Edit key)",
    build: (path) => makeRequest("POST", path, undefined, { "x-edit-key": EDIT_KEY }),
  },
];

const runRoute = (path: string, testCase: (typeof cases)[number]) =>
  runWith((hashes) => testCase.build(path, hashes.editKeyHash));

describe("Submission Worker never returns answers for an Edit key (ADR 0005, issue #122)", () => {
  for (const testCase of cases) {
    it.effect(`POST /my-answers with ${testCase.name} is rejected and reaches no Organization`, () =>
      Effect.gen(function* () {
        const { response, text, calls } = yield* runRoute("/my-answers", testCase);
        // Query and header credentials are refused with 400 before routing; body credentials find no route (404).
        assert.isTrue(
          response.status >= 400 && response.status < 500,
          `expected a 4xx, got ${response.status}`,
        );
        assert.notInclude(text, CANARY_ANSWER);
        assert.deepStrictEqual(calls, [], "no Organization method may be called");
      }),
    );
  }

  // Every route the Worker serves, even when the Organization would hand answers back.
  for (const path of ["/exchange", "/first-answer", "/answer", "/submit", "/my-answers"]) {
    for (const testCase of cases) {
      it.effect(`POST ${path} with ${testCase.name} returns no answers`, () =>
        Effect.gen(function* () {
          const { text } = yield* runRoute(path, testCase);
          assert.notInclude(text, CANARY_ANSWER);
          assert.notInclude(text, "answers");
        }),
      );
    }
  }
});

const validBody = (path: string, hashes: Hashes): Record<string, unknown> => {
  switch (path) {
    case "/exchange":
      return { token: TOKEN };
    case "/first-answer":
      return { token: TOKEN, editKeyHash: hashes.freshHash, questionVersionId: "qv-1", value: 4 };
    case "/answer":
      return { editKey: EDIT_KEY, questionVersionId: "qv-1", value: 4 };
    default:
      throw new Error(`no valid body for ${path}`);
  }
};

const credentialRoutes = ["/exchange", "/first-answer", "/answer"] as const;

const queryRefusals: ReadonlyArray<{ readonly name: string; readonly query: (hashes: Hashes) => string }> = [
  { name: "query token", query: () => `token=${TOKEN}` },
  { name: "query t", query: () => `t=${TOKEN}` },
  { name: "query editKey", query: () => `editKey=${EDIT_KEY}` },
  { name: "query edit_key", query: () => `edit_key=${EDIT_KEY}` },
  { name: "query editKeyHash", query: (hashes) => `editKeyHash=${hashes.editKeyHash}` },
  { name: "query edit_key_hash", query: (hashes) => `edit_key_hash=${hashes.editKeyHash}` },
  { name: "query token with a test token", query: () => `token=${TEST_TOKEN}` },
  { name: "query t with a test token", query: () => `t=${TEST_TOKEN}` },
];

const headerRefusals: ReadonlyArray<{ readonly name: string; readonly headers: Record<string, string> }> = [
  { name: "header x-invitation-token", headers: { "x-invitation-token": TOKEN } },
  { name: "header x-edit-key", headers: { "x-edit-key": EDIT_KEY } },
  { name: "header x-invitation-token with a test token", headers: { "x-invitation-token": TEST_TOKEN } },
];

const bodyRefusals: ReadonlyArray<{
  readonly path: (typeof credentialRoutes)[number];
  readonly name: string;
  readonly body: (hashes: Hashes) => Record<string, unknown>;
}> = [
  {
    path: "/answer",
    name: "body editKeyHash of the Edit key alongside a valid editKey",
    body: (hashes) => ({
      editKey: EDIT_KEY,
      editKeyHash: hashes.editKeyHash,
      questionVersionId: "qv-1",
      value: 4,
    }),
  },
  {
    path: "/answer",
    name: "body edit_key_hash",
    body: (hashes) => ({ edit_key_hash: hashes.editKeyHash, questionVersionId: "qv-1", value: 4 }),
  },
  {
    path: "/exchange",
    name: "body token with editKeyHash",
    body: (hashes) => ({ token: TOKEN, editKeyHash: hashes.freshHash }),
  },
  {
    path: "/first-answer",
    name: "body token with edit_key_hash (no editKeyHash)",
    body: (hashes) => ({
      token: TOKEN,
      edit_key_hash: hashes.freshHash,
      questionVersionId: "qv-1",
      value: 4,
    }),
  },
  {
    path: "/first-answer",
    name: "body token with a malformed editKeyHash",
    body: () => ({ token: TOKEN, editKeyHash: "not-a-hash", questionVersionId: "qv-1", value: 4 }),
  },
  {
    path: "/first-answer",
    name: "body token with an uppercase-hex editKeyHash",
    body: () => ({ token: TOKEN, editKeyHash: "A".repeat(64), questionVersionId: "qv-1", value: 4 }),
  },
  ...(["/exchange", "/first-answer", "/answer"] as const).map((path) => ({
    path,
    name: "body token and editKey together (A5)",
    body: (hashes: Hashes) => ({
      token: TOKEN,
      editKey: EDIT_KEY,
      editKeyHash: hashes.freshHash,
      questionVersionId: "qv-1",
      value: 4,
    }),
  })),
  {
    path: "/answer",
    name: "body token",
    body: () => ({ token: TOKEN, questionVersionId: "qv-1", value: 4 }),
  },
  {
    path: "/answer",
    name: "body test token",
    body: () => ({ token: TEST_TOKEN, questionVersionId: "qv-1", value: 4 }),
  },
  {
    path: "/exchange",
    name: "body test token with editKeyHash",
    body: (hashes) => ({ token: TEST_TOKEN, editKeyHash: hashes.freshHash }),
  },
  {
    path: "/first-answer",
    name: "body test token with a malformed editKeyHash",
    body: () => ({ token: TEST_TOKEN, editKeyHash: "not-a-hash", questionVersionId: "qv-1", value: 4 }),
  },
];

describe("Submission Worker takes credentials only from the POST body (ADR 0005, issue #130)", () => {
  for (const path of credentialRoutes) {
    for (const refusal of queryRefusals) {
      it.effect(`POST ${path} with ${refusal.name} and a valid body is refused before any Organization`, () =>
        Effect.gen(function* () {
          const { response, calls } = yield* runWith((hashes) =>
            makeRequest("POST", `${path}?${refusal.query(hashes)}`, validBody(path, hashes)),
          );
          assert.strictEqual(response.status, 400);
          assert.deepStrictEqual(calls, [], "no Organization method may be called");
        }),
      );
    }

    for (const refusal of headerRefusals) {
      it.effect(`POST ${path} with ${refusal.name} and a valid body is refused before any Organization`, () =>
        Effect.gen(function* () {
          const { response, calls } = yield* runWith((hashes) =>
            makeRequest("POST", path, validBody(path, hashes), refusal.headers),
          );
          assert.strictEqual(response.status, 400);
          assert.deepStrictEqual(calls, [], "no Organization method may be called");
        }),
      );
    }
  }

  for (const refusal of bodyRefusals) {
    it.effect(`POST ${refusal.path} with ${refusal.name} is refused before any Organization`, () =>
      Effect.gen(function* () {
        const { response, calls } = yield* runWith((hashes) =>
          makeRequest("POST", refusal.path, refusal.body(hashes)),
        );
        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(calls, [], "no Organization method may be called");
      }),
    );
  }

  it.effect("POST /exchange with a valid token body resolves the round context", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* runWith((hashes) =>
        makeRequest("POST", "/exchange", validBody("/exchange", hashes)),
      );
      assert.strictEqual(response.status, 200);
      assert.include(calls, "getSubmissionRoundContext");
    }),
  );

  it.effect(
    "POST /first-answer with a valid token and editKeyHash records the first Answer and the hash",
    () =>
      Effect.gen(function* () {
        const { response, calls, d1, freshHash } = yield* runWith((hashes) =>
          makeRequest("POST", "/first-answer", validBody("/first-answer", hashes)),
        );
        assert.strictEqual(response.status, 200);
        assert.include(calls, "recordFirstAnswer");
        const rows = d1
          .prepare("SELECT edit_key_hash FROM submission_index WHERE edit_key_hash = ?")
          .all(freshHash);
        assert.strictEqual(rows.length, 1);
      }),
  );

  it.effect("POST /answer with a valid editKey body saves the Answer", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* runWith((hashes) =>
        makeRequest("POST", "/answer", validBody("/answer", hashes)),
      );
      assert.strictEqual(response.status, 200);
      assert.include(calls, "saveAnswer");
    }),
  );
});

const countRows = (d1: DatabaseSync, table: string, where = "1 = 1", ...binds: Array<string>): number =>
  (d1.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...binds) as { n: number }).n;

// Fixed expiries hold under Effect's TestClock (which starts at 0), which `it.effect` runs under, and
// under the real clock: the largest JavaScript time is always in the future, and 0 is always past.
const NEVER_EXPIRES = 8_640_000_000_000_000;
const ALREADY_EXPIRED = 0;

describe("A test Invitation never saves an answer (ADR 0021, issue #136)", () => {
  it.effect("POST /exchange with a test token resolves the test context through the Pulse only", () =>
    Effect.gen(function* () {
      const { response, text, calls } = yield* runWith(
        () => makeRequest("POST", "/exchange", { token: TEST_TOKEN }),
        { testInvitationExpiresAt: NEVER_EXPIRES },
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(calls, ["getByName", "getTestSubmissionContext"]);
      assert.include(text, '"test":true');
    }),
  );

  it.effect(
    "POST /first-answer with a test token saves nothing and indexes only the test Edit key hash",
    () =>
      Effect.gen(function* () {
        const { response, text, calls, d1, freshHash } = yield* runWith(
          (hashes) =>
            makeRequest("POST", "/first-answer", {
              token: TEST_TOKEN,
              editKeyHash: hashes.freshHash,
              questionVersionId: "qv-1",
              value: 4,
              comment: "Grace, it was fine",
            }),
          { testInvitationExpiresAt: NEVER_EXPIRES },
        );
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(calls, ["getByName", "previewTestAnswers"]);
        assert.include(text, `"shownToLead":"${TEST_PREVIEW}"`);
        assert.include(text, '"saved":true');
        // Only the seeded real rows exist in the real indexes.
        assert.strictEqual(countRows(d1, "submission_index"), 1);
        assert.strictEqual(countRows(d1, "invitation_index"), 1);
        assert.strictEqual(countRows(d1, "test_submission_index", "edit_key_hash = ?", freshHash), 1);
      }),
  );

  it.effect("POST /answer with a test Edit key returns the preview and writes no Submission", () =>
    Effect.gen(function* () {
      const { response, text, calls, d1 } = yield* runWith(
        () =>
          makeRequest("POST", "/answer", {
            editKey: TEST_EDIT_KEY,
            questionVersionId: "qv-1",
            value: 4,
            comment: "Grace, still fine",
          }),
        { testSubmissionExpiresAt: NEVER_EXPIRES },
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(calls, ["getByName", "previewTestAnswers"]);
      assert.include(text, `"shownToLead":"${TEST_PREVIEW}"`);
      assert.strictEqual(countRows(d1, "submission_index"), 1);
    }),
  );

  it.effect(
    "an expired test token is not found: /exchange and /first-answer answer 404 and reach no Organization",
    () =>
      Effect.gen(function* () {
        const exchange = yield* runWith(() => makeRequest("POST", "/exchange", { token: TEST_TOKEN }), {
          testInvitationExpiresAt: ALREADY_EXPIRED,
        });
        assert.strictEqual(exchange.response.status, 404);
        assert.deepStrictEqual(exchange.calls, []);

        const firstAnswer = yield* runWith(
          (hashes) =>
            makeRequest("POST", "/first-answer", {
              token: TEST_TOKEN,
              editKeyHash: hashes.freshHash,
              questionVersionId: "qv-1",
              value: 4,
            }),
          { testInvitationExpiresAt: ALREADY_EXPIRED },
        );
        assert.strictEqual(firstAnswer.response.status, 404);
        assert.deepStrictEqual(firstAnswer.calls, []);
        assert.strictEqual(countRows(firstAnswer.d1, "test_submission_index"), 0);
      }),
  );

  it.effect("an expired test Edit key is not found: /answer answers 404 and reaches no Organization", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* runWith(
        () => makeRequest("POST", "/answer", { editKey: TEST_EDIT_KEY, questionVersionId: "qv-1", value: 4 }),
        { testSubmissionExpiresAt: ALREADY_EXPIRED },
      );
      assert.strictEqual(response.status, 404);
      assert.deepStrictEqual(calls, []);
    }),
  );

  for (const path of ["/exchange", "/first-answer", "/answer"]) {
    it.effect(`POST ${path} with a test token and an Edit key together is refused (A5)`, () =>
      Effect.gen(function* () {
        const { response, calls } = yield* runWith(
          (hashes) =>
            makeRequest("POST", path, {
              token: TEST_TOKEN,
              editKey: TEST_EDIT_KEY,
              editKeyHash: hashes.freshHash,
              questionVersionId: "qv-1",
              value: 4,
            }),
          { testInvitationExpiresAt: NEVER_EXPIRES, testSubmissionExpiresAt: NEVER_EXPIRES },
        );
        assert.strictEqual(response.status, 400);
        assert.deepStrictEqual(calls, [], "no Organization method may be called");
      }),
    );
  }

  it.effect("a real token still records the first Answer, and never previews a test", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* runWith((hashes) =>
        makeRequest("POST", "/first-answer", validBody("/first-answer", hashes)),
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(calls, ["getByName", "recordFirstAnswer"]);
    }),
  );

  it.effect("a real token still resolves the real Round context, and never the test one", () =>
    Effect.gen(function* () {
      const { response, calls } = yield* runWith((hashes) =>
        makeRequest("POST", "/exchange", validBody("/exchange", hashes)),
      );
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(calls, ["getByName", "getSubmissionRoundContext"]);
    }),
  );
});
