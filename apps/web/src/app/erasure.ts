import type { Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/locale.ts";
import type { Failure } from "./api.ts";
import {
  appButton,
  dangerButtonClass,
  panel,
  problemView,
  secondaryButtonClass,
  subSectionTitle,
  textField,
} from "./components.ts";
import type { Child } from "./components.ts";

export interface ErasureForm {
  readonly confirmation: string;
  readonly busy: boolean;
  readonly failure: Failure | undefined;
}

export interface SelfErasureState extends ErasureForm {
  readonly open: boolean;
}

export interface ErasureActions<Message> {
  readonly onConfirmationChange: (value: string) => Message;
  readonly onSubmit: Message;
  readonly onCancel: Message;
}

const confirmationForm = <Message>(
  config: {
    readonly id: string;
    readonly label: string;
    readonly form: ErasureForm;
  },
  actions: ErasureActions<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("mt-4 flex flex-col gap-4")],
    [
      textField(
        {
          id: config.id,
          label: config.label,
          value: config.form.confirmation,
          type: "email",
          isDisabled: config.form.busy,
          onInput: actions.onConfirmationChange,
        },
        h,
      ),
      problemView(config.form.failure, h),
      h.div(
        [h.Class("flex flex-wrap gap-3")],
        [
          appButton(
            {
              text: message("erasure.confirm.action"),
              className: dangerButtonClass,
              isDisabled: config.form.busy || config.form.confirmation.trim() === "",
              onClick: actions.onSubmit,
            },
            h,
          ),
          appButton(
            {
              text: message("confirm.cancel"),
              className: secondaryButtonClass,
              isDisabled: config.form.busy,
              onClick: actions.onCancel,
            },
            h,
          ),
        ].filter((child): child is Html => child !== null),
      ),
    ].filter((child): child is Html => child !== null),
  );

export const selfErasureView = <Message>(
  state: SelfErasureState,
  kind: "person" | "account",
  actions: ErasureActions<Message> & { readonly onOpen: Message },
  h: HtmlBuilder<Message>,
): Html =>
  panel(
    [
      subSectionTitle(message("erasure.self.title"), h, 2),
      h.p(
        [h.Class("mt-1 leading-relaxed text-muted")],
        [message(kind === "person" ? "erasure.self.bodyPerson" : "erasure.self.bodyAccount")],
      ),
      state.open
        ? confirmationForm(
            { id: "erase-self-confirmation", label: message("erasure.confirm.label"), form: state },
            actions,
            h,
          )
        : h.div(
            [h.Class("mt-4")],
            [
              appButton(
                {
                  text: message("erasure.self.start"),
                  className: secondaryButtonClass,
                  onClick: actions.onOpen,
                },
                h,
              ),
            ],
          ),
    ],
    h,
    "mt-6",
  );

export const adminErasureView = <Message>(
  pending: { readonly email: string },
  form: ErasureForm,
  actions: ErasureActions<Message>,
  h: HtmlBuilder<Message>,
): Child =>
  panel(
    [
      subSectionTitle(message("erasure.admin.title", { email: pending.email }), h, 3),
      h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("erasure.admin.body")]),
      confirmationForm(
        {
          id: "erase-person-confirmation",
          label: message("erasure.admin.confirmLabel", { email: pending.email }),
          form,
        },
        actions,
        h,
      ),
    ],
    h,
    "mt-6",
  );
