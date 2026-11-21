import * as DateTime from "effect/DateTime";
import type { EmailSendProgress, FailedEmail, PersonId, SendId } from "@surveybeat/domain";
import { Policy } from "@surveybeat/domain";
import { Option, Predicate } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { formatDate, message } from "../messages/locale.ts";
import { failureMessage } from "./api.ts";
import type { Failure } from "./api.ts";
import {
  appButton,
  badge,
  confirmDialog,
  dataTable,
  dangerButtonClass,
  dangerLinkButton,
  emailAddress,
  emptyState,
  linkButton,
  pageTitle,
  panel,
  problemView,
  rowActionsMenu,
  secondaryButtonClass,
  checkboxField,
  subSectionTitle,
  textField,
} from "./components.ts";
import type { Child } from "./components.ts";
import { adminCorrectEmailView } from "./emailChange.ts";
import type { CorrectEmailState } from "./emailChange.ts";
import { adminErasureView } from "./erasure.ts";
import { failureReasonText } from "./pulses.ts";
import { decodePerson, formPanelClass } from "./directoryModel.ts";
import type {
  FailedEmailResend,
  LoadedFailedEmails,
  LoadedSettings,
  OffboardingForm,
} from "./directoryModel.ts";

const failedEmailReasonText = (reason: FailedEmail["reason"], code: string | null): string =>
  code === null
    ? failureReasonText(reason)
    : message("email.reasonCode", { reason: failureReasonText(reason), code });

const failedEmailStatusText = (state: EmailSendProgress): string => {
  switch (state._tag) {
    case "Queued": {
      return message("settings.failedEmails.status.queued");
    }

    case "Sending": {
      return message("settings.failedEmails.status.sending");
    }

    case "Sent": {
      return message("settings.failedEmails.status.sent");
    }

    case "Failed": {
      return message("settings.failedEmails.status.failed", {
        reason: failedEmailReasonText(state.reason, state.code),
      });
    }
  }
};

const failedEmailActionView = <Message>(
  email: FailedEmail,
  resend: FailedEmailResend | undefined,
  onResend: (sendId: SendId) => Message,
  h: HtmlBuilder<Message>,
): Child => {
  const resendButton = (isDisabled: boolean, text: string): Child =>
    appButton({ text, isDisabled, className: linkButton, onClick: onResend(email.sendId) }, h);

  const children: Child[] = [];

  if (resend === undefined) {
    if (email.resendable) {
      children.push(resendButton(false, message("settings.failedEmails.resend")));
    }
  } else {
    switch (resend._tag) {
      case "Resending": {
        children.push(resendButton(true, message("settings.failedEmails.resending")));
        break;
      }

      case "Resent": {
        children.push(h.p([h.Role("status")], [failedEmailStatusText(resend.state)]));

        if (resend.statusUnavailable) {
          children.push(h.p([], [message("settings.failedEmails.statusUnavailable")]));
        }

        if (resend.state._tag === "Failed") {
          children.push(resendButton(false, message("settings.failedEmails.resend")));
        }

        break;
      }

      case "Failed": {
        if (resend.failure === "EmailNotResendable") {
          children.push(h.p([h.Role("status")], [failureMessage(resend.failure)]));
        } else {
          children.push(
            h.p([h.Role("status")], [message("settings.failedEmails.resendFailed")]),
            resendButton(false, message("settings.failedEmails.resend")),
          );
        }

        break;
      }
    }
  }

  return children.length === 0 ? "" : h.div([h.Class("flex flex-col items-start gap-1 text-sm")], children);
};

const failedEmailsView = <Message>(
  state: {
    readonly failedEmails: LoadedFailedEmails;
    readonly failedEmailResends: Readonly<Record<string, FailedEmailResend>>;
  },
  onResend: (sendId: SendId) => Message,
  h: HtmlBuilder<Message>,
): Html => {
  const { failedEmails } = state;
  const children: Child[] = [subSectionTitle(message("settings.failedEmails.title"), h, 2)];

  if (failedEmails._tag === "Failed") {
    children.push(problemView(failedEmails.failure, h));
  } else if (failedEmails._tag === "Loaded") {
    const { emails } = failedEmails.list;

    if (emails.length === 0) {
      children.push(
        emptyState(
          {
            title: message("settings.failedEmails.empty.title"),
            body: message("settings.failedEmails.empty"),
          },
          h,
        ),
      );
    } else {
      children.push(
        h.div(
          [h.Class("mt-3 overflow-x-auto rounded-panel border border-line bg-surface px-6")],
          [
            dataTable(
              [
                message("settings.failedEmails.kind"),
                message("settings.failedEmails.recipient"),
                message("settings.failedEmails.reason"),
                message("settings.failedEmails.time"),
                message("settings.failedEmails.action"),
              ],
              emails.map((email) => [
                message(`email.kind.${email.kind}`),
                email.recipient,
                failedEmailReasonText(email.reason, email.code),
                formatDate(DateTime.makeUnsafe(email.failedAt), { dateStyle: "medium", timeStyle: "short" }),
                failedEmailActionView(email, state.failedEmailResends[email.sendId], onResend, h),
              ]),
              h,
            ),
          ],
        ),
      );
    }
  }

  return h.div([h.Class("mt-8")], children);
};

const offboardingExportHref = "/api/organization/offboarding-export";

const dangerZoneView = <Message>(
  state: { readonly downloaded: boolean; readonly form: OffboardingForm },
  actions: {
    readonly onDownloaded: Message;
    readonly onOpen: Message;
    readonly onConfirmationChange: (value: string) => Message;
    readonly onSubmit: Message;
    readonly onCancel: Message;
  },
  h: HtmlBuilder<Message>,
): Child => {
  const { form } = state;

  return panel(
    [
      subSectionTitle(message("offboarding.title"), h, 2),
      h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("offboarding.body")]),
      h.p([h.Class("mt-3 leading-relaxed text-muted")], [message("offboarding.download.body")]),
      h.div(
        [h.Class("mt-4 flex flex-wrap gap-3")],
        [
          h.a(
            [
              h.Href(offboardingExportHref),
              h.Download("surveybeat-organization.json"),
              h.OnClick(actions.onDownloaded),
              h.Class(secondaryButtonClass),
            ],
            [message("offboarding.download")],
          ),
        ],
      ),
      state.downloaded && !form.open
        ? h.div(
            [h.Class("mt-4")],
            [
              appButton(
                {
                  text: message("offboarding.start"),
                  className: secondaryButtonClass,
                  onClick: actions.onOpen,
                },
                h,
              ),
            ],
          )
        : null,
      state.downloaded && form.open
        ? h.div(
            [h.Class("mt-4 flex flex-col gap-4")],
            [
              h.p(
                [h.Class("leading-relaxed text-muted")],
                [message("offboarding.confirm.body", { days: Policy.backupRetentionDays })],
              ),
              textField(
                {
                  id: "delete-organization-confirmation",
                  label: message("offboarding.confirm.label"),
                  value: form.confirmation,
                  type: "text",
                  isDisabled: form.busy,
                  onInput: actions.onConfirmationChange,
                },
                h,
              ),
              problemView(form.failure, h),
              h.div(
                [h.Class("flex flex-wrap gap-3")],
                [
                  appButton(
                    {
                      text: message("offboarding.confirm.action"),
                      className: dangerButtonClass,
                      isDisabled: form.busy || form.confirmation.trim() === "",
                      onClick: actions.onSubmit,
                    },
                    h,
                  ),
                  appButton(
                    {
                      text: message("confirm.cancel"),
                      className: secondaryButtonClass,
                      isDisabled: form.busy,
                      onClick: actions.onCancel,
                    },
                    h,
                  ),
                ],
              ),
            ],
          )
        : null,
    ].filter(Predicate.isNotNull),
    h,
    "mt-8",
  );
};

export const settingsScreenView = <Message>(
  state: {
    readonly settings: LoadedSettings;
    readonly failedEmails: LoadedFailedEmails;
    readonly failedEmailResends: Readonly<Record<string, FailedEmailResend>>;
    readonly size: string;
    readonly sizeSaved: boolean;
    readonly sizeBusy: boolean;
    readonly sizeFailure?: Failure | undefined;
    readonly sizeOpen: boolean;
    readonly aiBusy: boolean;
    readonly aiFailure?: Failure | undefined;
    readonly peopleBusy: boolean;
    readonly peopleFailure?: Failure | undefined;
    readonly pendingRemovePerson: { readonly personId: PersonId; readonly email: string } | undefined;
    readonly pendingErasePerson: { readonly personId: PersonId; readonly email: string } | undefined;
    readonly erasePersonConfirmation: string;
    readonly correctEmail: CorrectEmailState;
    readonly offboardingDownloaded: boolean;
    readonly offboarding: OffboardingForm;
  },
  actions: {
    readonly onOffboardingDownloaded: Message;
    readonly onOffboardingOpen: Message;
    readonly onOffboardingConfirmationChange: (value: string) => Message;
    readonly onOffboardingSubmit: Message;
    readonly onOffboardingCancel: Message;
    readonly onSizeChange: (size: string) => Message;
    readonly onToggleSize: Message;
    readonly onSubmitSize: Message;
    readonly onAiProcessingToggle: (isOn: boolean) => Message;
    readonly onGrantAdmin: (personId: PersonId) => Message;
    readonly onRevokeAdmin: (personId: PersonId) => Message;
    readonly onRemovePerson: (personId: PersonId) => Message;
    readonly onConfirmRemovePerson: Message;
    readonly onCancelRemovePerson: Message;
    readonly onErasePerson: (personId: PersonId) => Message;
    readonly onErasePersonConfirmationChange: (value: string) => Message;
    readonly onConfirmErasePerson: Message;
    readonly onCancelErasePerson: Message;
    readonly onCorrectEmail: (personId: PersonId) => Message;
    readonly onCorrectEmailChange: (value: string) => Message;
    readonly onSubmitCorrectEmail: Message;
    readonly onCancelCorrectEmail: Message;
    readonly onResendFailedEmail: (sendId: SendId) => Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Child[] = [pageTitle(message("settings.title"), h)];

  if (state.settings._tag === "Failed") {
    children.push(problemView(state.settings.failure, h));

    return h.section([], children);
  }

  if (state.settings._tag !== "Loaded") {
    return h.section([], children);
  }

  const { settings } = state.settings;

  if (!state.sizeOpen) {
    children.push(
      h.div(
        [h.Class("mt-6")],
        [
          appButton(
            {
              text: message("settings.minimumGroupSize.open"),
              onClick: actions.onToggleSize,
              className: secondaryButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  }

  if (state.sizeOpen) {
    children.push(
      h.form(
        [h.Class(formPanelClass), h.OnSubmit(actions.onSubmitSize)],
        [
          textField(
            {
              id: "min-group-size",
              label: message("settings.minimumGroupSize"),
              value: state.size,
              type: "number",
              isDisabled: state.sizeBusy,
              onInput: actions.onSizeChange,
            },
            h,
          ),
          h.p(
            [h.Class("text-sm text-muted")],
            [message("settings.minimumGroupSize.help", { minimum: Policy.groupSize.minimum })],
          ),
          problemView(state.sizeFailure, h),
          state.sizeSaved
            ? h.p(
                [h.Role("status"), h.Class("text-sm font-medium text-primary")],
                [message("settings.saved")],
              )
            : null,
          h.div(
            [h.Class("flex flex-wrap gap-3")],
            [
              appButton(
                {
                  text: message("settings.save"),
                  type: "submit",
                  isDisabled: state.sizeBusy,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  onClick: actions.onToggleSize,
                  className: secondaryButtonClass,
                },
                h,
              ),
            ],
          ),
        ].filter(Predicate.isNotNull),
      ),
    );
  }

  children.push(
    h.div(
      [h.Class(formPanelClass)],
      [
        subSectionTitle(message("settings.aiProcessing.title"), h, 2),
        checkboxField(
          {
            id: "ai-processing",
            label: message("settings.aiProcessing.label"),
            isChecked: settings.aiProcessing,
            isDisabled: state.aiBusy,
            onToggle: actions.onAiProcessingToggle,
          },
          h,
        ),
        h.p([h.Class("text-sm text-muted")], [message("settings.aiProcessing.help")]),
        problemView(state.aiFailure, h),
      ].filter(Predicate.isNotNull),
    ),
    h.div([h.Class("mt-8")], [subSectionTitle(message("settings.people"), h, 2)]),
    dataTable(
      [message("settings.people.email"), message("settings.people.role"), message("settings.people.actions")],
      settings.people.map((person) => {
        const personId = decodePerson(person.personId);

        return [
          h.div(
            [h.Class("flex flex-wrap items-center gap-2")],
            [
              emailAddress({ email: person.email }, h),
              person.linked ? null : badge("neutral", [message("settings.notSignedInYet")], h),
            ].filter(Predicate.isNotNull),
          ),
          badge(
            person.organizationAdmin ? "primary" : "neutral",
            [message(person.organizationAdmin ? "settings.admin" : "settings.member")],
            h,
          ),
          rowActionsMenu(
            {
              label: message("settings.people.actions"),
              items: [
                appButton(
                  {
                    text: message(person.organizationAdmin ? "settings.revokeAdmin" : "settings.makeAdmin"),
                    isDisabled: state.peopleBusy,
                    className: linkButton,
                    onClick: person.organizationAdmin
                      ? actions.onRevokeAdmin(person.personId)
                      : actions.onGrantAdmin(person.personId),
                  },
                  h,
                ),
                person.linked
                  ? null
                  : appButton(
                      {
                        text: message("settings.correctEmail"),
                        isDisabled: state.peopleBusy,
                        className: linkButton,
                        onClick: actions.onCorrectEmail(person.personId),
                      },
                      h,
                    ),
                Option.isSome(personId) && state.pendingRemovePerson?.personId !== person.personId
                  ? appButton(
                      {
                        text: message("settings.removePerson"),
                        isDisabled: state.peopleBusy,
                        className: dangerLinkButton,
                        onClick: actions.onRemovePerson(person.personId),
                      },
                      h,
                    )
                  : null,
                appButton(
                  {
                    text: message("settings.erasePerson"),
                    isDisabled: state.peopleBusy,
                    className: dangerLinkButton,
                    onClick: actions.onErasePerson(person.personId),
                  },
                  h,
                ),
                Option.isSome(personId) && state.pendingRemovePerson?.personId === person.personId
                  ? confirmDialog(
                      {
                        title: message("confirm.removeTitle"),
                        body: message("confirm.removePersonBody", {
                          email: state.pendingRemovePerson.email,
                        }),
                        confirmText: message("settings.removePerson"),
                        cancelText: message("confirm.cancel"),
                        isBusy: state.peopleBusy,
                        onConfirm: actions.onConfirmRemovePerson,
                        onCancel: actions.onCancelRemovePerson,
                      },
                      h,
                    )
                  : null,
              ],
            },
            h,
          ),
        ];
      }),
      h,
      { stackOnPhone: true },
    ),
  );

  if (settings.removedPeople.length > 0) {
    children.push(
      h.div([h.Class("mt-8")], [subSectionTitle(message("settings.removedPeople.title"), h, 2)]),
      h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("settings.removedPeople.body")]),
      dataTable(
        [message("settings.people.email"), message("settings.people.actions")],
        settings.removedPeople.map((person) => [
          emailAddress({ email: person.email }, h),
          h.div(
            [h.Class("flex flex-wrap items-center gap-x-4")],
            [
              person.linked
                ? null
                : appButton(
                    {
                      text: message("settings.correctEmail"),
                      isDisabled: state.peopleBusy,
                      className: linkButton,
                      onClick: actions.onCorrectEmail(person.personId),
                    },
                    h,
                  ),
              appButton(
                {
                  text: message("settings.erasePerson"),
                  isDisabled: state.peopleBusy,
                  className: dangerLinkButton,
                  onClick: actions.onErasePerson(person.personId),
                },
                h,
              ),
            ].filter(Predicate.isNotNull),
          ),
        ]),
        h,
        { stackOnPhone: true },
      ),
    );
  }

  if (state.pendingErasePerson === undefined) {
    if (state.peopleFailure) {
      children.push(problemView(state.peopleFailure, h));
    }
  } else {
    children.push(
      adminErasureView(
        state.pendingErasePerson,
        {
          confirmation: state.erasePersonConfirmation,
          busy: state.peopleBusy,
          failure: state.peopleFailure,
        },
        {
          onConfirmationChange: actions.onErasePersonConfirmationChange,
          onSubmit: actions.onConfirmErasePerson,
          onCancel: actions.onCancelErasePerson,
        },
        h,
      ),
    );
  }

  if (state.correctEmail.pending !== undefined) {
    children.push(
      adminCorrectEmailView(
        state.correctEmail.pending,
        state.correctEmail,
        {
          onChange: actions.onCorrectEmailChange,
          onSubmit: actions.onSubmitCorrectEmail,
          onCancel: actions.onCancelCorrectEmail,
        },
        h,
      ),
    );
  }

  children.push(
    failedEmailsView(state, actions.onResendFailedEmail, h),
    dangerZoneView(
      { downloaded: state.offboardingDownloaded, form: state.offboarding },
      {
        onDownloaded: actions.onOffboardingDownloaded,
        onOpen: actions.onOffboardingOpen,
        onConfirmationChange: actions.onOffboardingConfirmationChange,
        onSubmit: actions.onOffboardingSubmit,
        onCancel: actions.onOffboardingCancel,
      },
      h,
    ),
  );

  return h.section([], children);
};
