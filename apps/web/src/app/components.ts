import { Button, Checkbox, Input, Select, Textarea } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/index.ts";
import { type Failure, failureMessage } from "./api.ts";
import { teamsHref } from "./routes.ts";

export type Child = Html | string;

export const buttonClass = "rounded bg-black px-4 py-2 text-white disabled:opacity-50";
export const inputClass = "mt-1 w-full rounded border px-3 py-2";
export const linkButton = "text-sm underline disabled:opacity-50";

export const screenView = <Message>(
  title: string,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Class("mx-auto max-w-xl p-6")],
    [h.h1([h.Class("text-2xl font-semibold")], [title]), ...children],
  );

export const problemView = <Message>(failure: Failure | undefined, h: HtmlBuilder<Message>): Html | null => {
  if (failure === undefined) return null;
  const errorText = failureMessage(failure);
  return h.p([h.Role("alert"), h.Class("mt-2 text-red-700")], [errorText]);
};

export const appButton = <Message>(
  config: {
    readonly text: string;
    readonly onClick?: Message | undefined;
    readonly isDisabled?: boolean | undefined;
    readonly type?: "button" | "submit" | "reset" | undefined;
    readonly className?: string | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Button.view(
    {
      toView: ({ button }) =>
        h.button(
          [
            ...button,
            ...(config.isDisabled ? [h.Disabled(true)] : []),
            h.Class(config.className ?? buttonClass),
          ],
          [config.text],
        ),
      type: config.type ?? "button",
      ...(config.onClick !== undefined ? { onClick: config.onClick } : {}),
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

export const textField = <Message>(
  config: {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly onInput: (value: string) => Message;
    readonly type?: "text" | "email" | "number" | "time" | undefined;
    readonly isDisabled?: boolean | undefined;
    readonly maxLength?: number | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: config.id,
      value: config.value,
      type: config.type ?? "text",
      toView: ({ input, label }) =>
        h.div(
          [h.Class("flex flex-col")],
          [
            h.label([...label, h.Class("block text-sm font-medium")], [config.label]),
            h.input([
              ...input,
              ...(config.maxLength !== undefined ? [h.Maxlength(config.maxLength)] : []),
              h.Class(inputClass),
            ]),
          ],
        ),
      onInput: config.onInput,
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

export const selectField = <Message, V extends string | number>(
  config: {
    readonly id: string;
    readonly label: string;
    readonly value: V;
    readonly options: ReadonlyArray<readonly [V, string]>;
    readonly onChange: (value: string) => Message;
    readonly isDisabled?: boolean | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Select.view(
    {
      id: config.id,
      value: String(config.value),
      toView: ({ select, label }) =>
        h.div(
          [h.Class("flex flex-col")],
          [
            h.label([...label, h.Class("block text-sm font-medium")], [config.label]),
            h.select(
              [...select, h.Class(inputClass)],
              config.options.map(([opt, name]) => h.option([h.Value(String(opt))], [name])),
            ),
          ],
        ),
      onChange: config.onChange,
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

export const textareaField = <Message>(
  config: {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly onInput: (value: string) => Message;
    readonly rows?: number | undefined;
    readonly isDisabled?: boolean | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Textarea.view(
    {
      id: config.id,
      value: config.value,
      rows: config.rows ?? 4,
      toView: ({ textarea, label }) =>
        h.div(
          [h.Class("flex flex-col")],
          [
            h.label([...label, h.Class("block text-sm font-medium")], [config.label]),
            h.textarea([...textarea, h.Class(inputClass)]),
          ],
        ),
      onInput: config.onInput,
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

export const checkboxField = <Message>(
  config: {
    readonly id: string;
    readonly label: string;
    readonly isChecked: boolean;
    readonly onToggle: (isChecked: boolean) => Message;
    readonly isDisabled?: boolean | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Checkbox.view(
    {
      id: config.id,
      isChecked: config.isChecked,
      toView: ({ checkbox, label }) =>
        h.label(
          [...label, h.Class("flex items-center gap-2 text-sm")],
          [h.input([...checkbox, h.Type("checkbox"), h.Checked(config.isChecked)]), config.label],
        ),
      onToggle: config.onToggle,
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

export const signOutView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Method("post"), h.Action("/auth/logout"), h.Class("mt-6")],
    [
      Button.view(
        {
          type: "submit",
          toView: ({ button }) =>
            h.button([...button, h.Class("text-sm text-gray-600 underline")], [message("signOut.action")]),
        },
        h,
      ),
    ],
  );

export const privacyView = <Message>(h: HtmlBuilder<Message>): Html =>
  screenView(
    message("privacy.title"),
    [
      h.div(
        [h.Class("mt-4 mb-6")],
        [h.a([h.Href(teamsHref()), h.Class("text-sm text-blue-600 underline")], [message("privacy.back")])],
      ),
      h.div(
        [h.Class("mt-6 flex flex-col gap-6 text-sm text-gray-700 leading-relaxed")],
        [
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-base font-semibold text-gray-900 mb-1")],
                [message("privacy.anonymity.title")],
              ),
              h.p([], [message("privacy.anonymity.body")]),
            ],
          ),
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-base font-semibold text-gray-900 mb-1")],
                [message("privacy.comments.title")],
              ),
              h.p([], [message("privacy.comments.body")]),
            ],
          ),
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-base font-semibold text-gray-900 mb-1")],
                [message("privacy.restore.title")],
              ),
              h.p([], [message("privacy.restore.body")]),
            ],
          ),
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-base font-semibold text-gray-900 mb-1")],
                [message("privacy.editKey.title")],
              ),
              h.p([], [message("privacy.editKey.body")]),
            ],
          ),
          h.div(
            [],
            [
              h.h2(
                [h.Class("text-base font-semibold text-gray-900 mb-1")],
                [message("privacy.restoreTrigger.title")],
              ),
              h.p([], [message("privacy.restoreTrigger.body")]),
            ],
          ),
        ],
      ),
    ],
    h,
  );
