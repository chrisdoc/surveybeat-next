import { assert, describe, it } from "@effect/vitest";
import { PersonalDataExport } from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Browser, SignInWorld } from "./testing.ts";

const setup = () => {
  const world = new SignInWorld();
  const acme = world.addOrganization("Acme");
  world.addPerson(acme.id, "admin@example.com", true);

  const as = (email: string) =>
    Effect.gen(function* () {
      const browser = new Browser(world.handler());
      browser.signIn(world.sessions.login(email));
      yield* Effect.promise(() => browser.session());

      return browser;
    });

  return { world, as };
};

describe("personal data export endpoint (GDPR 306)", () => {
  it.effect("refuses a caller who is not signed in", () =>
    Effect.gen(function* () {
      const { world } = setup();
      const response = yield* Effect.promise(() => new Browser(world.handler()).get("/api/me/data-export"));

      assert.strictEqual(response.status, 401);
    }),
  );

  it.effect("downloads a versioned JSON attachment for a signed-in Organization admin", () =>
    Effect.gen(function* () {
      const { as } = setup();
      const browser = yield* as("admin@example.com");
      const response = yield* Effect.promise(() => browser.get("/api/me/data-export"));

      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PersonalDataExport)),
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get("content-disposition"),
        'attachment; filename="surveybeat-personal-data.json"',
      );
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.include(response.headers.get("content-type"), "application/json");
      assert.strictEqual(body.schemaVersion, 1);
      assert.strictEqual(body.account.user?.email, "admin@example.com");
      assert.deepStrictEqual(
        body.organizations.map((each) => each.person.organizationAdmin),
        [true],
      );
    }),
  );

  it.effect("downloads for a signed-in human who belongs to no Organization", () =>
    Effect.gen(function* () {
      const { as } = setup();
      const browser = yield* as("stranger@example.com");
      const response = yield* Effect.promise(() => browser.get("/api/me/data-export"));

      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PersonalDataExport)),
      );

      assert.strictEqual(response.status, 200);
      assert.strictEqual(body.account.user?.email, "stranger@example.com");
      assert.deepStrictEqual(body.organizations, []);
    }),
  );

  it.effect("refuses a request from another origin", () =>
    Effect.gen(function* () {
      const { as } = setup();
      const browser = yield* as("admin@example.com");

      const response = yield* Effect.promise(() =>
        browser.fetch("/api/me/data-export", { headers: { origin: "https://evil.example" } }),
      );

      assert.strictEqual(response.status, 403);
    }),
  );
});
