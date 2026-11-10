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
const CANARY_ANSWER = "CANARY-ANSWER";

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
  const organizationFor = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== "string") return undefined;
          calls.push(method);
          return () => Effect.succeed(result);
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
  Effect.gen(function* () {
    const { d1, queryDb } = setupD1();
    const editKeyHash = yield* Effect.promise(() => hashToken(EDIT_KEY));
    d1.prepare(
      "INSERT INTO submission_index (edit_key_hash, organization_id, round_id) VALUES (?, ?, ?)",
    ).run(editKeyHash, "org-1", "round-1");
    const { organizations, calls } = recordingOrganizations();
    const response = yield* submissionRoutes(organizations, queryDb).pipe(
      Effect.provideService(HttpServerRequest, testCase.build(path, editKeyHash)),
      // The Organization methods read the alchemy runtime; the fake needs only an empty one.
      Effect.provideService(RuntimeContext, {} as RuntimeContext["Service"]),
    );
    return { response, text: bodyText(response), calls };
  });

describe("Submission Worker never returns answers for an Edit key (ADR 0005, issue #122)", () => {
  for (const testCase of cases) {
    it.effect(`POST /my-answers with ${testCase.name} is not found and reaches no Organization`, () =>
      Effect.gen(function* () {
        const { response, text, calls } = yield* runRoute("/my-answers", testCase);
        assert.strictEqual(response.status, 404);
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
