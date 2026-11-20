import { SurveyBeatApi } from "@surveybeat/api";
import {
  confirmEmailChange,
  eraseAccount,
  PERSONAL_DATA_EXPORT_FILENAME,
  PersonalDataSource,
  requestEmailChange,
  runDirectoryCommand,
} from "@surveybeat/domain";
import type { OrganizationDirectory, EmailRectification } from "@surveybeat/domain";
import type * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import {
  authenticated,
  currentMember,
  requireSameOrigin,
  setSessionCookie,
  signedInWithCookie,
} from "./auth/AuthHandlers.ts";
import type { AuthServices } from "./auth/AuthHandlers.ts";

export type MeServices = AuthServices | PersonalDataSource | OrganizationDirectory | EmailRectification;

const downloadHeaders = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeaders(response, {
      "content-disposition": `attachment; filename="${PERSONAL_DATA_EXPORT_FILENAME}"`,
      "cache-control": "no-store",
    }),
  ),
);

export const meHandlers = <R>(services: Effect.Effect<Context.Context<MeServices>, never, R>) => {
  const provide = <A, E, R2>(effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(services, (context) => Effect.provideContext(effect, context));

  return HttpApiBuilder.group(SurveyBeatApi, "me", (handlers) =>
    handlers
      .handle("exportData", () =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const checked = yield* authenticated;
            const source = yield* PersonalDataSource;
            const now = yield* Clock.currentTimeMillis;
            yield* downloadHeaders;

            return yield* source.gather(checked.session.identity.userId, now);
          }),
        ),
      )
      .handle("erasePerson", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const member = yield* currentMember;

            yield* runDirectoryCommand(member, {
              _tag: "ErasePerson",
              authority: "self",
              personId: member.personId,
              confirmation: payload.confirmation,
            });
          }),
        ),
      )
      .handle("requestEmailChange", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const { cookie, session } = yield* signedInWithCookie;

            yield* requestEmailChange(cookie, session, payload.email);
          }),
        ),
      )
      .handle("confirmEmailChange", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const { cookie, session } = yield* signedInWithCookie;
            const token = yield* confirmEmailChange(cookie, session, payload.email, payload.otp);

            if (Option.isSome(token)) {
              yield* setSessionCookie(Redacted.make(token.value));
            }
          }),
        ),
      )
      .handle("eraseAccount", ({ payload }) =>
        provide(
          Effect.gen(function* () {
            yield* requireSameOrigin;
            const checked = yield* authenticated;

            yield* eraseAccount(checked.session, payload.confirmation);
          }),
        ),
      ),
  );
};
