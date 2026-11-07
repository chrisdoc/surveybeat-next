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
