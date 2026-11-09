import * as Cloudflare from "@alchemy.run/cloudflare";
import { QuestionVersionId, type SubmissionAnswer, hashToken } from "@surveybeat/domain";
import { Stack } from "alchemy/Stack";
import { Layer } from "effect";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Database } from "./Database.ts";
import { hostnameFor } from "./Hostnames.ts";
import Organization from "./Organization.ts";

const RawAnswer = Schema.Struct({
  questionVersionId: Schema.String,
  value: Schema.optional(Schema.NullOr(Schema.Int)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawBody = Schema.Struct({
  token: Schema.optional(Schema.String),
  editKey: Schema.optional(Schema.String),
  edit_key: Schema.optional(Schema.String),
  editKeyHash: Schema.optional(Schema.String),
  edit_key_hash: Schema.optional(Schema.String),
  questionVersionId: Schema.optional(Schema.String),
  value: Schema.optional(Schema.NullOr(Schema.Int)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
  answers: Schema.optional(Schema.Array(RawAnswer)),
});
type RawBody = typeof RawBody.Type;

const decodeBody = Schema.decodeUnknownOption(RawBody);

const parseBody = (req: HttpServerRequest): Effect.Effect<RawBody> =>
  Effect.gen(function* () {
    const text = yield* req.text.pipe(Effect.orDie);
    if (!text || text.trim().length === 0) return {};
    try {
      const parsed = JSON.parse(text);
      return Option.getOrElse(decodeBody(parsed), (): RawBody => ({}));
    } catch {
      return {};
    }
  });

const extractAnswers = (body: RawBody): ReadonlyArray<SubmissionAnswer> => {
  if (body.answers !== undefined && body.answers.length > 0) {
    return body.answers.map((item) => ({
      questionVersionId: QuestionVersionId.make(item.questionVersionId),
      value: item.value ?? null,
      comment: item.comment ?? null,
    }));
  }
  if (body.questionVersionId !== undefined && body.questionVersionId.length > 0) {
    return [
      {
        questionVersionId: QuestionVersionId.make(body.questionVersionId),
        value: body.value ?? null,
        comment: body.comment ?? null,
      },
    ];
  }
  return [];
};

/**
 * The Submission Worker (ADR 0005). Every log channel is switched off, because Alchemy turns
 * observability on when the prop is omitted. `infra/scripts/check-observability.ts` reads the
 * deployed settings back, since Alchemy has not applied `invocationLogs` and `persist` in the past.
 */
export default class SubmissionWorker extends Cloudflare.Worker<SubmissionWorker>()(
  "Submission",
  Effect.gen(function* () {
    const stack = yield* Stack;
    const hostname = hostnameFor(stack.stage, "submit");
    return {
      main: import.meta.url,
      observability: {
        enabled: false,
        logs: { enabled: false, invocationLogs: false, persist: false },
        traces: { enabled: false, persist: false },
      },
      logpush: false,
      tailConsumers: [],
      streamingTailConsumers: [],
      ...(hostname === undefined ? {} : { domain: hostname }),
    };
  }),
  Effect.gen(function* () {
    const organizations = yield* Organization;
    const database = yield* Cloudflare.D1.QueryDatabase(yield* Database);

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const path = request.url.split("?")[0];

        if (request.method === "OPTIONS") {
          return HttpServerResponse.empty({ status: 204 });
        }

        if (path === "/submit" && request.method === "POST") {
          // Deliberately logs nothing and never reads the body.
          return yield* HttpServerResponse.json({ ok: true }, { status: 202 });
        }

        const body = yield* parseBody(request);
        const url = new URL(request.url, "https://submit.surveybeat.app");
        const tokenFromQuery = url.searchParams.get("token") ?? url.searchParams.get("t") ?? undefined;
        const editKeyFromQuery =
          url.searchParams.get("editKey") ?? url.searchParams.get("edit_key") ?? undefined;
        const tokenFromHeader = request.headers["x-invitation-token"];
        const editKeyFromHeader = request.headers["x-edit-key"];

        const token = body.token ?? tokenFromQuery ?? tokenFromHeader;
        const editKey = body.editKey ?? body.edit_key ?? editKeyFromQuery ?? editKeyFromHeader;

        // Invariant A5: A request carrying both an Invitation token and an Edit key is rejected (400).
        if (token !== undefined && editKey !== undefined) {
          return yield* HttpServerResponse.json(
            { error: "A request carrying both a token and an Edit key is rejected" },
            { status: 400 },
          );
        }

        if (path === "/exchange" && request.method === "POST") {
          if (token === undefined) {
            return yield* HttpServerResponse.json({ error: "Missing invitation token" }, { status: 400 });
          }
          const tokenHash = yield* Effect.promise(() => hashToken(token));
          const row = yield* database
            .prepare("SELECT organization_id, round_id, person_id FROM invitation_index WHERE token_hash = ?")
            .bind(tokenHash)
            .first<{ organization_id: string; round_id: string; person_id: string }>()
            .pipe(Effect.orDie);
          if (row === null) {
            return yield* HttpServerResponse.json({ error: "Invitation not found" }, { status: 404 });
          }
          const context = yield* organizations
            .getByName(row.organization_id)
            .getSubmissionRoundContext(row.round_id, row.person_id)
            .pipe(Effect.orDie);
          if (context === null) {
            return yield* HttpServerResponse.json({ error: "Round not found" }, { status: 404 });
          }
          return yield* HttpServerResponse.json(context);
        }

        if (
          (path === "/first-answer" || (path === "/answer" && token !== undefined)) &&
          request.method === "POST"
        ) {
          if (token === undefined) {
            return yield* HttpServerResponse.json({ error: "Missing invitation token" }, { status: 400 });
          }
          const rawEditKeyHash =
            body.editKeyHash ??
            body.edit_key_hash ??
            url.searchParams.get("editKeyHash") ??
            url.searchParams.get("edit_key_hash") ??
            undefined;

          if (rawEditKeyHash === undefined) {
            return yield* HttpServerResponse.json({ error: "Missing edit key hash" }, { status: 400 });
          }

          const tokenHash = yield* Effect.promise(() => hashToken(token));
          const row = yield* database
            .prepare("SELECT organization_id, round_id, person_id FROM invitation_index WHERE token_hash = ?")
            .bind(tokenHash)
            .first<{ organization_id: string; round_id: string; person_id: string }>()
            .pipe(Effect.orDie);
          if (row === null) {
            return yield* HttpServerResponse.json({ error: "Invitation not found" }, { status: 404 });
          }

          const answers = extractAnswers(body);
          const result = yield* organizations
            .getByName(row.organization_id)
            .recordFirstAnswer(row.round_id, row.person_id, rawEditKeyHash, answers)
            .pipe(Effect.orDie);

          if (result._tag === "AlreadyAnswered") {
            return yield* HttpServerResponse.json({ error: "already answered" }, { status: 409 });
          }
          if (result._tag === "RoundNotOpen") {
            return yield* HttpServerResponse.json({ error: "round not open" }, { status: 400 });
          }

          yield* database
            .prepare(
              "INSERT INTO submission_index (edit_key_hash, organization_id, round_id) VALUES (?, ?, ?) ON CONFLICT (edit_key_hash) DO NOTHING",
            )
            .bind(rawEditKeyHash, row.organization_id, row.round_id)
            .run()
            .pipe(Effect.orDie);

          return yield* HttpServerResponse.json({ saved: true, shownToLead: result.shownToLead });
        }

        if (path === "/answer" && request.method === "POST") {
          const rawEditKeyHash =
            editKey !== undefined
              ? yield* Effect.promise(() => hashToken(editKey))
              : (body.editKeyHash ??
                body.edit_key_hash ??
                url.searchParams.get("editKeyHash") ??
                url.searchParams.get("edit_key_hash") ??
                undefined);

          if (rawEditKeyHash === undefined) {
            return yield* HttpServerResponse.json({ error: "Missing edit key" }, { status: 400 });
          }

          const row = yield* database
            .prepare("SELECT organization_id, round_id FROM submission_index WHERE edit_key_hash = ?")
            .bind(rawEditKeyHash)
            .first<{ organization_id: string; round_id: string }>()
            .pipe(Effect.orDie);
          if (row === null) {
            return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
          }

          const answers = extractAnswers(body);
          const result = yield* organizations
            .getByName(row.organization_id)
            .saveAnswer(rawEditKeyHash, answers)
            .pipe(Effect.orDie);

          if (result._tag === "SubmissionNotFound") {
            return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
          }
          if (result._tag === "RoundNotOpen") {
            return yield* HttpServerResponse.json({ error: "round not open" }, { status: 400 });
          }

          return yield* HttpServerResponse.json({ saved: true, shownToLead: result.shownToLead });
        }

        if (path === "/my-answers" && request.method === "POST") {
          const rawEditKeyHash =
            editKey !== undefined
              ? yield* Effect.promise(() => hashToken(editKey))
              : (body.editKeyHash ??
                body.edit_key_hash ??
                url.searchParams.get("editKeyHash") ??
                url.searchParams.get("edit_key_hash") ??
                undefined);

          if (rawEditKeyHash === undefined) {
            return yield* HttpServerResponse.json({ error: "Missing edit key" }, { status: 400 });
          }

          const row = yield* database
            .prepare("SELECT organization_id, round_id FROM submission_index WHERE edit_key_hash = ?")
            .bind(rawEditKeyHash)
            .first<{ organization_id: string; round_id: string }>()
            .pipe(Effect.orDie);
          if (row === null) {
            return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
          }

          const result = yield* organizations
            .getByName(row.organization_id)
            .getMyAnswers(rawEditKeyHash)
            .pipe(Effect.orDie);

          if (result._tag === "SubmissionNotFound") {
            return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
          }

          return yield* HttpServerResponse.json({ answers: result.answers });
        }

        return yield* HttpServerResponse.json({ error: "not found" }, { status: 404 });
      }).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Layer.mergeAll(Cloudflare.D1.QueryDatabaseBinding))),
) {}
