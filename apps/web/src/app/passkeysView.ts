import * as DateTime from "effect/DateTime";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { formatDate, message } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import {
  appButton,
  badge,
  buttonClass,
  confirmDialog,
  dangerLinkButton,
  linkButton,
  panel,
  problemView,
  secondaryButtonClass,
  subSectionTitle,
  textField,
} from "./components.ts";
import type { Child } from "./components.ts";
import { aaguidProviderName, PasskeyItem } from "./passkeyClient.ts";

export const LoadedPasskeys = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Loading", {}),
  Schema.TaggedStruct("Loaded", { passkeys: Schema.Array(PasskeyItem) }),
  Schema.TaggedStruct("Failed", { failure: Failure }),
]);

export type LoadedPasskeys = typeof LoadedPasskeys.Type;

export interface PasskeysViewState {
  readonly list: LoadedPasskeys;
  readonly supported: boolean;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly failure: Failure | undefined;
  readonly editingId: string | undefined;
  readonly editingName: string;
  readonly pendingDeleteId: string | undefined;
}

export interface PasskeysViewActions<Message> {
  readonly onAdd: Message;
  readonly onStartRename: (id: string, currentName: string) => Message;
  readonly onRenameChange: (value: string) => Message;
  readonly onSaveRename: Message;
  readonly onCancelRename: Message;
  readonly onAskDelete: (id: string) => Message;
  readonly onConfirmDelete: Message;
  readonly onCancelDelete: Message;
}

export const passkeyDisplayName = (passkey: PasskeyItem): string => {
  const custom = passkey.name?.trim();

  if (custom !== undefined && custom !== "") {
    return custom;
  }

  return aaguidProviderName(passkey.aaguid) ?? message("passkeys.defaultName");
};

const passkeyMeta = (passkey: PasskeyItem): string | null => {
  if (passkey.createdAt === null) {
    return null;
  }

  return Option.match(DateTime.make(passkey.createdAt), {
    onNone: () => null,
    onSome: (instant) => message("passkeys.createdAt", { date: formatDate(instant) }),
  });
};

const passkeyRow = <Message>(
  passkey: PasskeyItem,
  state: PasskeysViewState,
  actions: PasskeysViewActions<Message>,
  h: HtmlBuilder<Message>,
): Html => {
  const displayName = passkeyDisplayName(passkey);
  const meta = passkeyMeta(passkey);
  const isEditing = state.editingId === passkey.id;
  const isDeleting = state.pendingDeleteId === passkey.id;

  return h.keyed("li")(
    passkey.id,
    [h.Class("rounded-control border border-line-soft bg-subtle/40 p-4")],
    [
      isEditing
        ? h.form(
            [h.Class("flex flex-col gap-3"), h.OnSubmit(actions.onSaveRename)],
            [
              textField(
                {
                  id: `passkey-name-${passkey.id}`,
                  label: message("passkeys.renameLabel"),
                  value: state.editingName,
                  maxLength: 64,
                  isDisabled: state.busy,
                  onInput: actions.onRenameChange,
                },
                h,
              ),
              h.div(
                [h.Class("flex flex-wrap gap-3")],
                [
                  appButton(
                    {
                      text: message("passkeys.save"),
                      type: "submit",
                      className: buttonClass,
                      isDisabled: state.busy || state.editingName.trim() === "",
                    },
                    h,
                  ),
                  appButton(
                    {
                      text: message("confirm.cancel"),
                      className: secondaryButtonClass,
                      isDisabled: state.busy,
                      onClick: actions.onCancelRename,
                    },
                    h,
                  ),
                ],
              ),
            ],
          )
        : h.div(
            [h.Class("flex flex-wrap items-center justify-between gap-3")],
            [
              h.div(
                [h.Class("min-w-0")],
                [
                  h.div(
                    [h.Class("flex flex-wrap items-center gap-2")],
                    [
                      h.span([h.Class("font-semibold text-ink")], [displayName]),
                      badge(
                        passkey.backedUp ? "primary" : "neutral",
                        [message(passkey.backedUp ? "passkeys.synced" : "passkeys.deviceBound")],
                        h,
                      ),
                    ],
                  ),
                  meta === null ? null : h.p([h.Class("mt-1 text-sm text-muted")], [meta]),
                ].filter(Predicate.isNotNull),
              ),
              h.div(
                [h.Class("flex flex-wrap items-center gap-3")],
                [
                  appButton(
                    {
                      text: message("passkeys.rename"),
                      className: linkButton,
                      isDisabled: state.busy,
                      onClick: actions.onStartRename(passkey.id, displayName),
                    },
                    h,
                  ),
                  isDeleting
                    ? null
                    : appButton(
                        {
                          text: message("passkeys.remove"),
                          className: dangerLinkButton,
                          isDisabled: state.busy,
                          onClick: actions.onAskDelete(passkey.id),
                        },
                        h,
                      ),
                ].filter(Predicate.isNotNull),
              ),
            ],
          ),
      isDeleting
        ? confirmDialog(
            {
              title: message("passkeys.confirmRemove"),
              body: message("passkeys.confirmRemoveBody", { name: displayName }),
              confirmText: message("passkeys.remove"),
              cancelText: message("confirm.cancel"),
              isBusy: state.busy,
              onConfirm: actions.onConfirmDelete,
              onCancel: actions.onCancelDelete,
            },
            h,
          )
        : null,
    ].filter(Predicate.isNotNull),
  );
};

export const passkeysView = <Message>(
  state: PasskeysViewState,
  actions: PasskeysViewActions<Message>,
  h: HtmlBuilder<Message>,
): Child => {
  const listContent: Child | null = (() => {
    switch (state.list._tag) {
      case "Idle": {
        return null;
      }

      case "Loading": {
        return h.p([h.Class("mt-4 text-sm text-muted")], [message("passkeys.loading")]);
      }

      case "Failed": {
        return problemView(state.list.failure, h);
      }

      case "Loaded": {
        if (state.list.passkeys.length === 0) {
          return h.p([h.Class("mt-4 text-sm text-muted")], [message("passkeys.empty")]);
        }

        return h.ul(
          [h.Class("mt-4 flex flex-col gap-3")],
          state.list.passkeys.map((passkey) => passkeyRow(passkey, state, actions, h)),
        );
      }
    }
  })();

  return panel(
    [
      subSectionTitle(message("passkeys.title"), h, 2),
      h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("passkeys.body")]),
      listContent,
      problemView(state.failure, h),
      state.notice === null
        ? null
        : h.p([h.Role("status"), h.Class("mt-3 text-sm font-medium text-primary")], [state.notice]),
      state.supported
        ? h.div(
            [h.Class("mt-4")],
            [
              appButton(
                {
                  text: message(state.busy ? "passkeys.adding" : "passkeys.add"),
                  className: secondaryButtonClass,
                  isDisabled: state.busy,
                  onClick: actions.onAdd,
                },
                h,
              ),
            ],
          )
        : h.p([h.Class("mt-4 text-sm text-muted")], [message("passkeys.unsupported")]),
    ].filter(Predicate.isNotNull),
    h,
    "mt-6",
  );
};
