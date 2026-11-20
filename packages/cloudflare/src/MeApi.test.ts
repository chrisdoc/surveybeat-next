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

describe("erasing your own personal data (GDPR 307)", () => {
  const withAda = () => {
    const { world, as } = setup();
    const acme = [...world.durable.organizations.keys()][0]!;
    const ada = world.addPerson(acme, "ada@example.com", false);

    return { world, as, acme, ada };
  };

  it.effect("refuses a caller who is not signed in", () =>
    Effect.gen(function* () {
      const { world } = setup();

      const response = yield* Effect.promise(() =>
        new Browser(world.handler()).call("POST", "/api/me/erasure", { confirmation: "ada@example.com" }),
      );

      assert.strictEqual(response.status, 401);
    }),
  );

  it.effect("scrubs the caller's own Person and ends their access", () =>
    Effect.gen(function* () {
      const { world, as, acme, ada } = withAda();
      const browser = yield* as("ada@example.com");

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/erasure", { confirmation: "ada@example.com" }),
      );

      assert.strictEqual(response.status, 204);
      assert.strictEqual(world.durable.person(acme, ada)?.email, `erased-${ada}@erased.invalid`);
      assert.strictEqual(world.index.persons.has(`${acme}/${ada}`), false);
      assert.strictEqual(world.index.erasedAccounts.size, 1);

      const after = yield* Effect.promise(() => browser.session());

      assert.deepStrictEqual(after.body, { _tag: "NotInOrganization" });
    }),
  );

  it.effect("takes the Person from the session, never from the request", () =>
    Effect.gen(function* () {
      const { world, as, acme, ada } = withAda();
      const browser = yield* as("ada@example.com");

      const other = [...(world.durable.organizations.get(acme)?.state.people ?? [])].find(
        (each) => each.email === "admin@example.com",
      );

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/erasure", { confirmation: "ada@example.com", personId: other?.id }),
      );

      assert.strictEqual(response.status, 204);
      assert.strictEqual(world.durable.person(acme, other!.id)?.erasedAt, null);
      assert.notStrictEqual(world.durable.person(acme, ada)?.erasedAt, null);
    }),
  );

  it.effect("refuses a wrong address and changes nothing", () =>
    Effect.gen(function* () {
      const { world, as, acme, ada } = withAda();
      const browser = yield* as("ada@example.com");

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/erasure", { confirmation: "other@example.com" }),
      );

      assert.strictEqual(response.status, 422);
      assert.deepStrictEqual(response.body, {
        _tag: "ErasureNotConfirmed",
      });
      assert.strictEqual(world.durable.person(acme, ada)?.erasedAt, null);
    }),
  );

  it.effect("refuses the only Organization admin until the role is handed over", () =>
    Effect.gen(function* () {
      const { world, as, acme } = withAda();
      const browser = yield* as("admin@example.com");

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/erasure", { confirmation: "admin@example.com" }),
      );

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(response.body, { _tag: "LastAdmin" });
      assert.strictEqual(world.index.erasedAccounts.size, 0);
      assert.isTrue(
        [...(world.durable.organizations.get(acme)?.state.people ?? [])].every(
          (each) => each.erasedAt === null,
        ),
      );
    }),
  );

  it.effect("refuses a request from another origin", () =>
    Effect.gen(function* () {
      const { as } = withAda();
      const browser = yield* as("ada@example.com");

      const response = yield* Effect.promise(() =>
        browser.fetch("/api/me/erasure", {
          method: "POST",
          headers: { origin: "https://evil.example", "content-type": "application/json" },
          body: JSON.stringify({ confirmation: "ada@example.com" }),
        }),
      );

      assert.strictEqual(response.status, 403);
    }),
  );

  it.effect("erases the sign-in account of a human who belongs to no Organization", () =>
    Effect.gen(function* () {
      const { world, as } = withAda();
      const browser = yield* as("stranger@example.com");

      const wrong = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/account-erasure", { confirmation: "other@example.com" }),
      );

      assert.strictEqual(wrong.status, 422);
      assert.strictEqual(world.index.erasedAccounts.size, 0);

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/account-erasure", { confirmation: "stranger@example.com" }),
      );

      assert.strictEqual(response.status, 204);
      assert.strictEqual(world.index.erasedAccounts.size, 1);
    }),
  );

  it.effect("refuses to erase the sign-in account while a Person is left in an Organization", () =>
    Effect.gen(function* () {
      const { world, as } = withAda();
      const browser = yield* as("ada@example.com");

      const response = yield* Effect.promise(() =>
        browser.call("POST", "/api/me/account-erasure", { confirmation: "ada@example.com" }),
      );

      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(response.body, { _tag: "AccountStillInUse" });
      assert.strictEqual(world.index.erasedAccounts.size, 0);
    }),
  );
});
