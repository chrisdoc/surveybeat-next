import type * as Cloudflare from "@alchemy.run/cloudflare";
import { DELIVERY_PAGE_PATH, decodePageBody, type PageBody, UNSUBSCRIBE_PAGE_PATH } from "@surveybeat/api";
import { hashToken } from "@surveybeat/domain";
import { messagesFor } from "@surveybeat/emails";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import type { Organizations } from "./EmailDelivery.ts";
import {
  pageLocale,
  renderDeliveryPage,
  renderDeliverySuccessPage,
  renderUnsubscribePage,
} from "./ServerPages.ts";

const APP_ORIGIN = "https://app.surveybeat.app";
const PLAIN_TEXT = "text/plain; charset=utf-8";

type InvitationRow = {
  readonly organization_id: string;
  readonly round_id: string;
  readonly person_id: string;
  readonly pulse_id: string;
};

type PageBodyOutcome = { readonly _tag: "Decoded"; readonly body: PageBody } | { readonly _tag: "Malformed" };

const malformed: PageBodyOutcome = { _tag: "Malformed" };

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const formFields = (text: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text).entries()) fields[key] = value;
  return fields;
};

const pageBody = (request: HttpServerRequest): Effect.Effect<PageBodyOutcome> =>
  Effect.gen(function* () {
    const text = yield* request.text.pipe(Effect.orDie);
    if (text.trim().length === 0) return malformed;

    const contentType = request.headers["content-type"] ?? "";
    const raw = contentType.includes("application/json") ? parseJson(text) : formFields(text);
    const decoded = decodePageBody(raw);
    if (Option.isNone(decoded)) return malformed;

    const outcome: PageBodyOutcome = { _tag: "Decoded", body: decoded.value };
    return outcome;
  });

const bodyLocale = (outcome: PageBodyOutcome): string | undefined =>
  outcome._tag === "Decoded" ? outcome.body.lang : undefined;

const invitationRow = (database: Cloudflare.D1.QueryDatabaseClient, tokenHash: string) =>
  database
    .prepare(
      "SELECT organization_id, round_id, person_id, pulse_id FROM invitation_index WHERE token_hash = ?",
    )
    .bind(tokenHash)
    .first<InvitationRow>()
    .pipe(Effect.orDie);

const missing = (message: string) =>
  HttpServerResponse.text(message, { status: 400, contentType: PLAIN_TEXT });
const invalid = (message: string) =>
  HttpServerResponse.text(message, { status: 404, contentType: PLAIN_TEXT });

export const pageRoutes = (organizations: Organizations, database: Cloudflare.D1.QueryDatabaseClient) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const path = request.url.split("?")[0];
    const url = new URL(request.url, APP_ORIGIN);

    if (path === DELIVERY_PAGE_PATH) {
      if (request.method === "HEAD") return HttpServerResponse.empty({ status: 200 });

      if (request.method === "GET") {
        const token = url.searchParams.get("token") ?? "";
        const locale = pageLocale(url.searchParams.get("lang"), request.headers["accept-language"]);
        return HttpServerResponse.html(renderDeliveryPage(token, locale));
      }

      if (request.method === "POST") {
        const body = yield* pageBody(request);
        const locale = pageLocale(
          url.searchParams.get("lang") ?? bodyLocale(body),
          request.headers["accept-language"],
        );
        const m = messagesFor(locale);
        if (body._tag === "Malformed") return missing(m.message("page.error.missingTokenOrTimeZone"));

        const token = body.body.token ?? "";
        const timeZone = body.body.timeZone ?? "";
        if (!token || !timeZone) return missing(m.message("page.error.missingTokenOrTimeZone"));

        const tokenHash = yield* Effect.promise(() => hashToken(token));
        const row = yield* invitationRow(database, tokenHash);
        if (row === null) return invalid(m.message("page.error.invalid"));

        yield* organizations
          .getByName(row.organization_id)
          .setPersonTimeZone(row.person_id, timeZone)
          .pipe(Effect.orDie);

        const acceptHeader = request.headers["accept"] ?? "";
        if (acceptHeader.includes("application/json")) {
          return yield* HttpServerResponse.json({ ok: true, timeZone }).pipe(Effect.orDie);
        }
        return HttpServerResponse.html(renderDeliverySuccessPage(timeZone, locale));
      }

      return HttpServerResponse.empty({ status: 405 });
    }

    if (path === UNSUBSCRIBE_PAGE_PATH) {
      if (request.method === "HEAD") return HttpServerResponse.empty({ status: 200 });

      if (request.method === "GET") {
        const token = url.searchParams.get("t") ?? "";
        const locale = pageLocale(url.searchParams.get("lang"), request.headers["accept-language"]);
        return HttpServerResponse.html(renderUnsubscribePage(token, locale));
      }

      if (request.method === "POST") {
        const body = yield* pageBody(request);
        const locale = pageLocale(
          url.searchParams.get("lang") ?? bodyLocale(body),
          request.headers["accept-language"],
        );
        const m = messagesFor(locale);
        if (body._tag === "Malformed") return missing(m.message("page.error.missingToken"));

        const token = url.searchParams.get("t") ?? body.body.t ?? body.body.token ?? null;
        if (!token) return missing(m.message("page.error.missingToken"));

        const tokenHash = yield* Effect.promise(() => hashToken(token));
        const row = yield* invitationRow(database, tokenHash);
        if (row === null) return invalid(m.message("page.error.invalid"));

        yield* organizations
          .getByName(row.organization_id)
          .optOutReminders(row.pulse_id, row.person_id)
          .pipe(Effect.orDie);

        return HttpServerResponse.text(m.message("page.unsubscribed"), { contentType: PLAIN_TEXT });
      }

      return HttpServerResponse.empty({ status: 405 });
    }

    return HttpServerResponse.empty({ status: 404 });
  });
