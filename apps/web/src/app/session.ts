import {
  type OrganizationId,
  OrganizationSummary,
  SessionState as DomainSessionState,
} from "@surveybeat/domain";
import { Effect, Predicate, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { message } from "../messages/index.ts";
import { type ApiClient, clientEffect } from "./api.ts";
import {
  alertView,
  appButton,
  buttonClass,
  linkClass,
  screenView,
  secondaryButtonClass,
  signOutView,
  textField,
} from "./components.ts";
import { privacyHref } from "./routes.ts";

export const SessionModel = defineTaggedUnion({
  Loading: {},
  SignedOut: { failed: Schema.Boolean },
  Failed: {},
  CreateOrganization: { name: Schema.String, busy: Schema.Boolean },
  NotInOrganization: {},
  ChooseOrganization: { organizations: Schema.Array(OrganizationSummary), busy: Schema.Boolean },
  SignedIn: { organization: OrganizationSummary, organizationAdmin: Schema.Boolean },
});
export type SessionModel = typeof SessionModel.Type;

export const SessionResult = defineTaggedUnion({
  SignedIn: { organization: OrganizationSummary, organizationAdmin: Schema.Boolean },
  CreateOrganization: {},
  NotInOrganization: {},
  ChooseOrganization: { organizations: Schema.Array(OrganizationSummary) },
  SignedOut: {},
  Failed: {},
});
export type SessionResult = typeof SessionResult.Type;

export const runSessionCall = <E>(
  call: (api: ApiClient) => Effect.Effect<DomainSessionState, E>,
): Effect.Effect<SessionResult> =>
  clientEffect.pipe(
    Effect.flatMap(call),
    Effect.map((state): SessionResult => {
      switch (state._tag) {
        case "SignedIn":
          return {
            _tag: "SignedIn",
            organization: state.organization,
            organizationAdmin: state.organizationAdmin,
          };
        case "CreateOrganization":
          return { _tag: "CreateOrganization" };
        case "NotInOrganization":
          return { _tag: "NotInOrganization" };
        case "ChooseOrganization":
          return { _tag: "ChooseOrganization", organizations: state.organizations };
      }
    }),
    Effect.catch((error: unknown) =>
      Effect.succeed<SessionResult>(
        Predicate.isTagged(error, "Unauthenticated") ? { _tag: "SignedOut" } : { _tag: "Failed" },
      ),
    ),
    Effect.provide(FetchHttpClient.layer),
  );

export const signInView = <Message>(failed: boolean, h: HtmlBuilder<Message>): Html =>
  screenView(
    message("signIn.title"),
    [
      h.p([h.Class("mt-4 text-lg text-muted")], [message("signIn.intro")]),
      failed ? alertView(message("signIn.failed"), h) : null,
      h.form(
        [h.Method("get"), h.Action("/auth/login"), h.Class("mt-4")],
        [
          appButton(
            {
              text: message("signIn.action"),
              type: "submit",
            },
            h,
          ),
        ],
      ),
      h.p(
        [h.Class("mt-10 border-t border-line pt-4 text-sm")],
        [h.a([h.Href(privacyHref()), h.Class(linkClass)], [message("nav.privacy")])],
      ),
    ].filter(Predicate.isNotNull),
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
  organizations: ReadonlyArray<OrganizationSummary>,
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
          h.li(
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
