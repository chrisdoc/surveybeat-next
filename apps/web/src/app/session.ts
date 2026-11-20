import { Locale, OrganizationSummary } from "@surveybeat/domain";
import type { SessionState as DomainSessionState, OrganizationId } from "@surveybeat/domain";
import { Effect, Match, Predicate, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { message } from "../messages/locale.ts";
import { clientEffect } from "./api.ts";
import type { ApiClient } from "./api.ts";
import { privacyHref } from "./routes.ts";
import {
  alertView,
  appButton,
  buttonClass,
  linkClass,
  pageShell,
  pageTitle,
  screenView,
  secondaryButtonClass,
  signOutView,
  textField,
} from "./components.ts";

export const SessionModel = defineTaggedUnion({
  Loading: {},
  SignedOut: {
    failed: Schema.Boolean,
    stage: Schema.Literals(["email", "code"]),
    email: Schema.String,
    code: Schema.String,
    busy: Schema.Boolean,
    notice: Schema.NullOr(Schema.String),
  },
  Failed: {},
  CreateOrganization: { name: Schema.String, busy: Schema.Boolean },
  NotInOrganization: {},
  ChooseOrganization: { organizations: Schema.Array(OrganizationSummary), busy: Schema.Boolean },
  SignedIn: {
    organization: OrganizationSummary,
    organizationAdmin: Schema.Boolean,
    locale: Schema.NullOr(Locale),
    detectedLocale: Schema.NullOr(Locale),
    organizationLocale: Locale,
  },
});

export type SessionModel = typeof SessionModel.Type;

export const SessionResult = defineTaggedUnion({
  SignedIn: {
    organization: OrganizationSummary,
    organizationAdmin: Schema.Boolean,
    locale: Schema.NullOr(Locale),
    detectedLocale: Schema.NullOr(Locale),
    organizationLocale: Locale,
  },
  CreateOrganization: {},
  NotInOrganization: {},
  ChooseOrganization: { organizations: Schema.Array(OrganizationSummary) },
  SignedOut: {},
  Failed: {},
});

export type SessionResult = typeof SessionResult.Type;

const recoverSession = (failure: unknown): Effect.Effect<SessionResult> =>
  Effect.succeed<SessionResult>(
    Predicate.isTagged(failure, "Unauthenticated") ? { _tag: "SignedOut" } : { _tag: "Failed" },
  );

export const runSessionCall = <E>(
  call: (api: ApiClient) => Effect.Effect<DomainSessionState, E>,
): Effect.Effect<SessionResult> =>
  clientEffect.pipe(
    Effect.flatMap(call),
    Effect.map((state) =>
      Match.valueTags(state, {
        SignedIn: (signedIn): SessionResult => ({
          _tag: "SignedIn",
          organization: signedIn.organization,
          organizationAdmin: signedIn.organizationAdmin,
          locale: signedIn.locale,
          detectedLocale: signedIn.detectedLocale,
          organizationLocale: signedIn.organizationLocale,
        }),
        CreateOrganization: (): SessionResult => ({ _tag: "CreateOrganization" }),
        NotInOrganization: (): SessionResult => ({ _tag: "NotInOrganization" }),
        ChooseOrganization: (chooser): SessionResult => ({
          _tag: "ChooseOrganization",
          organizations: chooser.organizations,
        }),
      }),
    ),
    Effect.catch(recoverSession),
    Effect.provide(FetchHttpClient.layer),
  );

export interface SignInState {
  readonly failed: boolean;
  readonly stage: "email" | "code";
  readonly email: string;
  readonly code: string;
  readonly busy: boolean;
  readonly notice: string | null;
}

export interface SignInActions<Message> {
  readonly onEmail: (email: string) => Message;
  readonly onCode: (code: string) => Message;
  readonly onSubmitEmail: Message;
  readonly onSubmitCode: Message;
}

export const signInView = <Message>(
  state: SignInState,
  actions: SignInActions<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  pageShell(
    {},
    [
      h.main(
        [h.Class("mx-auto flex min-h-[70vh] w-full max-w-[440px] flex-col justify-center py-12")],
        [
          h.div(
            [h.Class("rounded-panel border border-line bg-surface p-8 text-center")],
            [
              pageTitle(message("signIn.title"), h),
              h.p([h.Class("mt-3 text-lg text-ink")], [message("signIn.framing")]),
              h.p([h.Class("mt-2 text-sm text-muted")], [message("signIn.intro")]),
              state.failed ? alertView(message("signIn.failed"), h) : null,
              state.notice === null ? null : h.p([h.Class("mt-4 text-sm text-ink")], [state.notice]),
              h.form(
                [h.Class("mt-6 text-left"), h.OnSubmit(actions.onSubmitEmail)],
                [
                  textField(
                    {
                      id: "sign-in-email",
                      label: message("signIn.email"),
                      type: "email",
                      value: state.email,
                      maxLength: 254,
                      isDisabled: state.busy || state.stage === "code",
                      onInput: actions.onEmail,
                    },
                    h,
                  ),
                  state.stage === "email"
                    ? appButton(
                        {
                          text: message("signIn.emailAction"),
                          type: "submit",
                          isDisabled: state.busy || state.email.trim() === "",
                          className: `mt-4 w-full ${buttonClass}`,
                        },
                        h,
                      )
                    : null,
                ],
              ),
              state.stage === "code"
                ? h.form(
                    [h.Class("mt-4 text-left"), h.OnSubmit(actions.onSubmitCode)],
                    [
                      textField(
                        {
                          id: "sign-in-code",
                          label: message("signIn.code"),
                          value: state.code,
                          maxLength: 12,
                          isDisabled: state.busy,
                          onInput: actions.onCode,
                        },
                        h,
                      ),
                      appButton(
                        {
                          text: message("signIn.codeAction"),
                          type: "submit",
                          isDisabled: state.busy || state.code.trim() === "",
                          className: `mt-4 w-full ${buttonClass}`,
                        },
                        h,
                      ),
                    ],
                  )
                : null,
              h.p(
                [h.Class("mt-6 text-sm text-muted")],
                [
                  message("signIn.privacy"),
                  " ",
                  h.a([h.Href(privacyHref()), h.Class(linkClass)], [message("signIn.privacyLink")]),
                ],
              ),
            ].filter(Predicate.isNotNull),
          ),
        ],
      ),
    ],
    h,
  );

export const failedView = <Message>(onRetry: Message, h: HtmlBuilder<Message>): Html =>
  screenView(
    message("app.error"),
    [
      appButton(
        {
          text: message("app.retry"),
          onClick: onRetry,
          className: `mt-6 ${buttonClass}`,
        },
        h,
      ),
    ],
    h,
  );

export const createOrganizationView = <Message>(
  name: string,
  busy: boolean,
  onNameChange: (name: string) => Message,
  onSubmit: Message,
  h: HtmlBuilder<Message>,
): Html =>
  screenView(
    message("createOrganization.title"),
    [
      h.p([h.Class("mt-4 text-lg text-muted")], [message("createOrganization.intro")]),
      h.form(
        [
          h.Class("mt-6 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:p-8"),
          h.OnSubmit(onSubmit),
        ],
        [
          textField(
            {
              id: "org-name",
              label: message("createOrganization.name"),
              value: name,
              maxLength: 100,
              isDisabled: busy,
              onInput: onNameChange,
            },
            h,
          ),
          appButton(
            {
              text: message("createOrganization.action"),
              type: "submit",
              isDisabled: busy || name.trim() === "",
            },
            h,
          ),
        ],
      ),
      signOutView(h),
    ],
    h,
  );

export const notInOrganizationView = <Message>(h: HtmlBuilder<Message>): Html =>
  screenView(
    message("notInOrganization.title"),
    [h.p([h.Class("mt-4 text-lg text-muted")], [message("notInOrganization.intro")]), signOutView(h)],
    h,
  );

export const chooseOrganizationView = <Message>(
  organizations: readonly OrganizationSummary[],
  busy: boolean,
  onChoose: (id: OrganizationId) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  screenView(
    message("chooseOrganization.title"),
    [
      h.p([h.Class("mt-4 text-lg text-muted")], [message("chooseOrganization.intro")]),
      h.ul(
        [h.Class("mt-6 flex flex-col gap-3")],
        organizations.map((org) =>
          h.keyed("li")(
            org.id,
            [],
            [
              appButton(
                {
                  text: org.name,
                  isDisabled: busy,
                  onClick: onChoose(org.id),
                  className: `w-full justify-start text-left ${secondaryButtonClass}`,
                },
                h,
              ),
            ],
          ),
        ),
      ),
      signOutView(h),
    ],
    h,
  );
