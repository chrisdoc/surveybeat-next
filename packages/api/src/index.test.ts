import { assert, layer } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import { HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiTest } from "effect/http-api";
import { Organization, OrganizationId, OrganizationNotFound } from "@surveybeat/domain";
import { SurveyBeatApi } from "./index.ts";

// In-memory handlers: no database and no HTTP server.
const OrganizationsHandlers = HttpApiBuilder.group(
  SurveyBeatApi,
  "organizations",
  Effect.fn(function* (handlers) {
    const store = yield* Ref.make(new Map<string, Organization>());
    return handlers
      .handle("create", ({ payload }) =>
        Ref.modify(store, (organizations) => {
          const organization = new Organization({
            id: OrganizationId.make(`org-${organizations.size + 1}`),
            name: payload.name,
          });
          return [organization, new Map(organizations).set(organization.id, organization)];
        }),
      )
      .handle("getById", ({ params }) =>
        Ref.get(store).pipe(
          Effect.flatMap((organizations) => {
            const organization = organizations.get(params.id);
            return organization === undefined
              ? Effect.fail(new OrganizationNotFound())
              : Effect.succeed(organization);
          }),
        ),
      );
  }),
);

const makeClient = HttpApiTest.groups(SurveyBeatApi, ["organizations"]);

layer(Layer.mergeAll(OrganizationsHandlers, HttpServer.layerServices))("OrganizationsApi", (it) => {
  it.effect("creates and fetches an Organization", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const created = yield* client.organizations.create({ payload: { name: "Acme" } });
      const fetched = yield* client.organizations.getById({ params: { id: created.id } });
      assert.deepStrictEqual(fetched, created);
    }),
  );

  it.effect("fails with OrganizationNotFound for an unknown id", () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const error = yield* client.organizations
        .getById({ params: { id: OrganizationId.make("missing") } })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "OrganizationNotFound");
    }),
  );
});
