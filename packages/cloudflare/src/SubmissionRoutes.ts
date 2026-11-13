import type * as Cloudflare from "@alchemy.run/cloudflare";
import { QuestionVersionId, type SubmissionAnswer, hashToken } from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Organizations } from "./EmailDelivery.ts";

const RawAnswer = Schema.Struct({
  questionVersionId: Schema.String,
  value: Schema.optional(Schema.NullOr(Schema.Int)),
  comment: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawBody = Schema.Struct({
  token: Schema.optional(Schema.String),
  editKey: Schema.optional(Schema.String),
  editKeyHash: Schema.optional(Schema.String),
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

/** Credential-bearing query parameters. Accepted only in the POST body (ADR 0005, issue #130). */
const credentialQueryParams = ["token", "t", "editKey", "edit_key", "editKeyHash", "edit_key_hash"] as const;

/** Credential-bearing headers. Accepted only in the POST body (ADR 0005, issue #130). */
const credentialHeaders = ["x-invitation-token", "x-edit-key"] as const;

const EDIT_KEY_HASH = /^[0-9a-f]{64}$/;

/** A test Invitation's token or a test Edit key, unexpired (ADR 0021): where it belongs. */
type TestIndexRow = {
  readonly organization_id: string;
  readonly pulse_id: string;
  readonly expires_at: number;
};

const findTestInvitation = (database: Cloudflare.D1.QueryDatabaseClient, tokenHash: string, now: number) =>
  database
    .prepare(
      "SELECT organization_id, pulse_id, expires_at FROM test_invitation_index WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(tokenHash, now)
    .first<TestIndexRow>()
    .pipe(Effect.orDie);

const findTestSubmission = (database: Cloudflare.D1.QueryDatabaseClient, editKeyHash: string, now: number) =>
  database
    .prepare(
      "SELECT organization_id, pulse_id, expires_at FROM test_submission_index WHERE edit_key_hash = ? AND expires_at > ?",
    )
    .bind(editKeyHash, now)
    .first<TestIndexRow>()
    .pipe(Effect.orDie);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

/**
 * Routes for the Submission Worker (ADR 0005). Kept apart from the Worker class so the routing can
 * be tested with a fake Organization and an in-memory D1.
 */
export const submissionRoutes = (organizations: Organizations, database: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const path = request.url.split("?")[0];

    if (request.method === "OPTIONS") {
      return HttpServerResponse.empty({ status: 204, headers: corsHeaders });
    }

    if (path === "/submit" && request.method === "POST") {
      // Deliberately logs nothing and never reads the body.
      return yield* HttpServerResponse.json({ ok: true }, { status: 202 });
    }

    // Credentials in the query string or headers are refused before the body is parsed or any
    // D1 or Organization is touched.
    const url = new URL(request.url, "https://submit.surveybeat.app");
    const credentialInUrl = credentialQueryParams.some((name) => url.searchParams.has(name));
    const credentialInHeader = credentialHeaders.some((name) => request.headers[name] !== undefined);
    if (credentialInUrl || credentialInHeader) {
      return yield* HttpServerResponse.json(
        { error: "Credentials are accepted only in the request body" },
        { status: 400 },
      );
    }

    const body = yield* parseBody(request);
    const token = body.token;
    const editKey = body.editKey;

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
      if (body.editKeyHash !== undefined) {
        return yield* HttpServerResponse.json(
          { error: "Edit key hash is not accepted here" },
          { status: 400 },
        );
      }
      const tokenHash = yield* Effect.promise(() => hashToken(token));
      const row = yield* database
        .prepare("SELECT organization_id, round_id, person_id FROM invitation_index WHERE token_hash = ?")
        .bind(tokenHash)
        .first<{ organization_id: string; round_id: string; person_id: string }>()
        .pipe(Effect.orDie);
      if (row === null) {
        // A test Invitation has no Round: its context is built from the Pulse (ADR 0021).
        const now = yield* Clock.currentTimeMillis;
        const testRow = yield* findTestInvitation(database, tokenHash, now);
        if (testRow === null) {
          return yield* HttpServerResponse.json({ error: "Invitation not found" }, { status: 404 });
        }
        const testContext = yield* organizations
          .getByName(testRow.organization_id)
          .getTestSubmissionContext(testRow.pulse_id, testRow.expires_at)
          .pipe(Effect.orDie);
        if (testContext === null) {
          return yield* HttpServerResponse.json({ error: "Round not found" }, { status: 404 });
        }
        return yield* HttpServerResponse.json(testContext);
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

    if (path === "/first-answer" && request.method === "POST") {
      if (token === undefined) {
        return yield* HttpServerResponse.json({ error: "Missing invitation token" }, { status: 400 });
      }
      // The browser sends only the hash with the first Answer (ADR 0005).
      const editKeyHash = body.editKeyHash;
      if (editKeyHash === undefined) {
        return yield* HttpServerResponse.json({ error: "Missing edit key hash" }, { status: 400 });
      }
      if (!EDIT_KEY_HASH.test(editKeyHash)) {
        return yield* HttpServerResponse.json({ error: "Malformed edit key hash" }, { status: 400 });
      }

      const tokenHash = yield* Effect.promise(() => hashToken(token));
      const row = yield* database
        .prepare("SELECT organization_id, round_id, person_id FROM invitation_index WHERE token_hash = ?")
        .bind(tokenHash)
        .first<{ organization_id: string; round_id: string; person_id: string }>()
        .pipe(Effect.orDie);
      if (row === null) {
        // A test saves nothing: the comment is only redacted for the preview; the Edit key hash is indexed (ADR 0021).
        const now = yield* Clock.currentTimeMillis;
        const testRow = yield* findTestInvitation(database, tokenHash, now);
        if (testRow === null) {
          return yield* HttpServerResponse.json({ error: "Invitation not found" }, { status: 404 });
        }
        const preview = yield* organizations
          .getByName(testRow.organization_id)
          .previewTestAnswers(extractAnswers(body))
          .pipe(Effect.orDie);
        yield* database
          .prepare(
            "INSERT INTO test_submission_index (edit_key_hash, organization_id, pulse_id, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (edit_key_hash) DO NOTHING",
          )
          .bind(editKeyHash, testRow.organization_id, testRow.pulse_id, testRow.expires_at)
          .run()
          .pipe(Effect.orDie);
        return yield* HttpServerResponse.json({ saved: true, shownToLead: preview.shownToLead });
      }

      const answers = extractAnswers(body);
      const result = yield* organizations
        .getByName(row.organization_id)
        .recordFirstAnswer(row.round_id, row.person_id, editKeyHash, answers)
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
        .bind(editKeyHash, row.organization_id, row.round_id)
        .run()
        .pipe(Effect.orDie);

      return yield* HttpServerResponse.json({ saved: true, shownToLead: result.shownToLead });
    }

    if (path === "/answer" && request.method === "POST") {
      // Later Answers carry the raw Edit key; the server derives the hash itself.
      if (token !== undefined) {
        return yield* HttpServerResponse.json(
          { error: "Invitation token is not accepted here" },
          { status: 400 },
        );
      }
      if (body.editKeyHash !== undefined) {
        return yield* HttpServerResponse.json(
          { error: "Edit key hash is not accepted here" },
          { status: 400 },
        );
      }
      if (editKey === undefined) {
        return yield* HttpServerResponse.json({ error: "Missing edit key" }, { status: 400 });
      }
      const editKeyHash = yield* Effect.promise(() => hashToken(editKey));

      const row = yield* database
        .prepare("SELECT organization_id, round_id FROM submission_index WHERE edit_key_hash = ?")
        .bind(editKeyHash)
        .first<{ organization_id: string; round_id: string }>()
        .pipe(Effect.orDie);
      if (row === null) {
        // A test answer is redacted and discarded, as its first answer was (ADR 0021).
        const now = yield* Clock.currentTimeMillis;
        const testRow = yield* findTestSubmission(database, editKeyHash, now);
        if (testRow === null) {
          return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
        }
        const preview = yield* organizations
          .getByName(testRow.organization_id)
          .previewTestAnswers(extractAnswers(body))
          .pipe(Effect.orDie);
        return yield* HttpServerResponse.json({ saved: true, shownToLead: preview.shownToLead });
      }

      const answers = extractAnswers(body);
      const result = yield* organizations
        .getByName(row.organization_id)
        .saveAnswer(editKeyHash, answers)
        .pipe(Effect.orDie);

      if (result._tag === "SubmissionNotFound") {
        return yield* HttpServerResponse.json({ error: "Submission not found" }, { status: 404 });
      }
      if (result._tag === "RoundNotOpen") {
        return yield* HttpServerResponse.json({ error: "round not open" }, { status: 400 });
      }

      return yield* HttpServerResponse.json({ saved: true, shownToLead: result.shownToLead });
    }

    return yield* HttpServerResponse.json({ error: "not found" }, { status: 404 });
  }).pipe(
    Effect.map((res) => HttpServerResponse.setHeaders(res, corsHeaders)),
    Effect.orDie,
  );
