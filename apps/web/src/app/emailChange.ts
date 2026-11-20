import { Policy } from "@surveybeat/domain";
import type { Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/locale.ts";
import type { Failure } from "./api.ts";
import {
  appButton,
  buttonClass,
  panel,
  problemView,
  secondaryButtonClass,
  subSectionTitle,
  textField,
} from "./components.ts";
import type { Child } from "./components.ts";

export type EmailChangeStep = "closed" | "address" | "code" | "done";

export interface EmailChangeState {
  readonly step: EmailChangeStep;
  readonly email: string;
  readonly code: string;
  readonly busy: boolean;
  readonly failure: Failure | undefined;
}

export interface EmailChangeActions<Message> {
  readonly onOpen: Message;
  readonly onEmailChange: (value: string) => Message;
  readonly onSendCode: Message;
  readonly onCodeChange: (value: string) => Message;
  readonly onConfirm: Message;
  readonly onOtherAddress: Message;
  readonly onCancel: Message;
}

const buttons = <Message>(items: readonly Html[], h: HtmlBuilder<Message>): Html =>
  h.div([h.Class("flex flex-wrap gap-3")], items);

const addressStep = <Message>(
  state: EmailChangeState,
  actions: EmailChangeActions<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("mt-4 flex flex-col gap-4")],
    [
      textField(
        {
          id: "email-change-address",
          label: message("emailChange.address"),
          value: state.email,
          type: "email",
          isDisabled: state.busy,
          onInput: actions.onEmailChange,
        },
        h,
      ),
      problemView(state.failure, h),
      buttons(
        [
          appButton(
            {
              text: message("emailChange.sendCode"),
              className: buttonClass,
              isDisabled: state.busy || state.email.trim() === "",
              onClick: actions.onSendCode,
            },
            h,
          ),
          appButton(
            {
              text: message("confirm.cancel"),
              className: secondaryButtonClass,
              isDisabled: state.busy,
              onClick: actions.onCancel,
            },
            h,
          ),
        ],
        h,
      ),
    ].filter((child): child is Html => child !== null),
  );

const codeStep = <Message>(
  state: EmailChangeState,
  actions: EmailChangeActions<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("mt-4 flex flex-col gap-4")],
    [
      h.p(
        [h.Class("leading-relaxed text-muted")],
        [
          message("emailChange.sent", {
            email: state.email.trim(),
            digits: Policy.signIn.codeDigits,
            minutes: Policy.signIn.codeMinutes,
          }),
        ],
      ),
      textField(
        {
          id: "email-change-code",
          label: message("emailChange.code"),
          value: state.code,
          isDisabled: state.busy,
          onInput: actions.onCodeChange,
        },
        h,
      ),
      problemView(state.failure, h),
      buttons(
        [
          appButton(
            {
              text: message("emailChange.confirm"),
              className: buttonClass,
              isDisabled: state.busy || state.code.trim() === "",
              onClick: actions.onConfirm,
            },
            h,
          ),
          appButton(
            {
              text: message("emailChange.otherAddress"),
              className: secondaryButtonClass,
              isDisabled: state.busy,
              onClick: actions.onOtherAddress,
            },
            h,
          ),
          appButton(
            {
              text: message("confirm.cancel"),
              className: secondaryButtonClass,
              isDisabled: state.busy,
              onClick: actions.onCancel,
            },
            h,
          ),
        ],
        h,
      ),
    ].filter((child): child is Html => child !== null),
  );

export const emailChangeView = <Message>(
  state: EmailChangeState,
  actions: EmailChangeActions<Message>,
  h: HtmlBuilder<Message>,
): Child =>
  panel(
    [
      subSectionTitle(message("emailChange.title"), h, 2),
      h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("emailChange.body")]),
      state.step === "address" ? addressStep(state, actions, h) : null,
      state.step === "code" ? codeStep(state, actions, h) : null,
      state.step === "done"
        ? h.p(
            [h.Role("status"), h.Class("mt-4 font-semibold")],
            [message("emailChange.done", { email: state.email.trim() })],
          )
        : null,
      state.step === "closed" || state.step === "done"
        ? h.div(
            [h.Class("mt-4")],
            [
              appButton(
                {
                  text: message("emailChange.start"),
                  className: secondaryButtonClass,
                  onClick: actions.onOpen,
                },
                h,
              ),
            ],
          )
        : null,
    ].filter((child): child is Html => child !== null),
    h,
    "mt-6",
  );

export interface CorrectEmailState {
  readonly pending: { readonly personId: string; readonly email: string } | undefined;
  readonly value: string;
  readonly busy: boolean;
  readonly failure: Failure | undefined;
}

export interface CorrectEmailActions<Message> {
  readonly onChange: (value: string) => Message;
  readonly onSubmit: Message;
  readonly onCancel: Message;
}

export const adminCorrectEmailView = <Message>(
  pending: { readonly email: string },
  state: CorrectEmailState,
  actions: CorrectEmailActions<Message>,
  h: HtmlBuilder<Message>,
): Child =>
  panel(
    [
      subSectionTitle(message("correctEmail.title", { email: pending.email }), h, 3),
      h.p(
        [h.Class("mt-1 leading-relaxed text-muted")],
        [message("correctEmail.body", { email: pending.email })],
      ),
      h.div(
        [h.Class("mt-4 flex flex-col gap-4")],
        [
          textField(
            {
              id: "correct-email-address",
              label: message("correctEmail.label"),
              value: state.value,
              type: "email",
              isDisabled: state.busy,
              onInput: actions.onChange,
            },
            h,
          ),
          problemView(state.failure, h),
          buttons(
            [
              appButton(
                {
                  text: message("correctEmail.save"),
                  className: buttonClass,
                  isDisabled: state.busy || state.value.trim() === "",
                  onClick: actions.onSubmit,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  className: secondaryButtonClass,
                  isDisabled: state.busy,
                  onClick: actions.onCancel,
                },
                h,
              ),
            ],
            h,
          ),
        ].filter((child): child is Html => child !== null),
      ),
    ],
    h,
    "mt-6",
  );
