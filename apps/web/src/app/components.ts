import { Button, Checkbox, Input, Select, Textarea } from "@foldkit/ui";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/locale.ts";
import { type Failure, failureMessage } from "./api.ts";
import { privacyHref, teamsHref } from "./routes.ts";

export type Child = Html | string;

export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-5 py-2 font-semibold text-ink hover:bg-subtle disabled:opacity-50";
export const mintButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-control bg-mint px-5 py-2 font-semibold text-evergreen hover:bg-mint-text disabled:opacity-50";
export const darkOutlineButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-mint-text px-4 py-2 font-semibold text-white hover:bg-evergreen-raised disabled:opacity-50";
export const dangerButtonClass =
  "rounded-control bg-danger px-4 py-2 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-50";

export const linkButton =
  "inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover disabled:opacity-50";
export const linkClass = "font-semibold text-primary underline underline-offset-4 hover:text-primary-hover";
export const labelClass = "block text-[15px] font-semibold";
export const inputClass =
  "mt-1.5 min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink disabled:opacity-60";

export const brandMark = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("28"), h.Height("28"), h.ViewBox("0 0 28 28"), h.AriaHidden(true)],
    [
      h.rect([h.Width("28"), h.Height("28"), h.Rx("8"), h.Fill("#0E2A24")]),
      h.path([
        h.D("M6 14h4l2-5 4 10 2-5h4"),
        h.Fill("none"),
        h.Stroke("#9FD6CB"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
        h.StrokeLinejoin("round"),
      ]),
    ],
  );

/** The page frame: the header (brand, then `header` content), the content column, and the footer with the Privacy link. `wide` makes room for a side column; `privacyCurrent` marks the Privacy link on the Privacy page. */
export const pageShell = <Message>(
  config: {
    readonly header?: ReadonlyArray<Child> | undefined;
    readonly wide?: boolean | undefined;
    readonly privacyCurrent?: boolean | undefined;
  },
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
): Html => {
  const width = config.wide === true ? "max-w-[1120px]" : "max-w-[720px]";
  const privacyCurrent = config.privacyCurrent === true;
  return h.div(
    [h.Class("flex min-h-screen flex-col bg-stone text-ink")],
    [
      h.header(
        [h.Class("border-b border-line bg-surface")],
        [
          h.div(
            [h.Class("mx-auto flex min-w-0 max-w-[1120px] items-center gap-x-5 px-6 py-2 sm:px-8")],
            [
              h.span(
                [h.Class("flex shrink-0 items-center gap-2.5")],
                [
                  brandMark(h),
                  h.span([h.Class("text-[17px] font-bold tracking-tight")], [message("app.title")]),
                ],
              ),
              ...(config.header ?? []),
            ],
          ),
        ],
      ),
      h.main([h.Class(`mx-auto w-full flex-1 px-6 pt-8 pb-20 sm:px-8 sm:pt-12 ${width}`)], children),
      h.footer(
        [h.Class("border-t border-line bg-surface")],
        [
          h.div(
            [h.Class(`mx-auto flex w-full px-6 py-2 text-sm sm:px-8 ${width}`)],
            [
              h.a(
                [
                  h.Href(privacyHref()),
                  h.Class(
                    privacyCurrent
                      ? "inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4"
                      : "inline-flex min-h-11 items-center font-medium text-muted hover:text-ink",
                  ),
                  ...(privacyCurrent ? [h.AriaCurrent("page")] : []),
                ],
                [message("nav.privacy")],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};

export const screenView = <Message>(
  title: string,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
): Html => pageShell({}, [pageTitle(title, h), ...children], h);

export const pageTitle = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.h1(
    [h.Class("font-display text-[32px] leading-[1.15] font-normal tracking-tight text-ink sm:text-[44px]")],
    [text],
  );

export interface Crumb {
  readonly label: string;
  readonly href?: string | undefined;
}

/** The wayfinding above a title — `Team › Pulse › Round` — with the last crumb being the page itself. */
export const breadcrumbs = <Message>(crumbs: ReadonlyArray<Crumb>, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role("navigation"), h.AriaLabel(message("breadcrumb.label"))],
    [
      h.ul(
        [h.Class("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted")],
        crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const label =
            isLast || crumb.href === undefined
              ? h.span(
                  [...(isLast ? [h.AriaCurrent("page"), h.Class("font-semibold text-ink")] : [])],
                  [crumb.label],
                )
              : h.a([h.Href(crumb.href), h.Class(linkClass)], [crumb.label]);
          return h.li(
            [h.Class("flex items-center gap-x-2")],
            [
              ...(index === 0
                ? []
                : [h.span([h.AriaHidden(true), h.Class("text-line")], [message("breadcrumb.separator")])]),
              label,
            ],
          );
        }),
      ),
    ],
  );

/** `onDark` is for a heading inside a `darkPanel`, where `text-ink` would be ink on evergreen. */
export const sectionTitle = <Message>(
  text: string,
  h: HtmlBuilder<Message>,
  tone: "default" | "onDark" = "default",
): Html =>
  h.h2(
    [
      h.Class(
        `font-display text-[30px] leading-tight font-normal ${tone === "onDark" ? "text-white" : "text-ink"}`,
      ),
    ],
    [text],
  );

export const subSectionTitle = <Message>(
  text: string,
  h: HtmlBuilder<Message>,
  level: 2 | 3 | 4 = 3,
): Html => {
  const attrs = [h.Class("text-[19px] leading-snug font-semibold text-ink")];
  return level === 2 ? h.h2(attrs, [text]) : level === 3 ? h.h3(attrs, [text]) : h.h4(attrs, [text]);
};

export const panel = <Message>(
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
  className = "",
): Html =>
  h.div([h.Class(`rounded-panel border border-line bg-surface p-6 sm:p-8 ${className}`.trim())], children);

export const darkPanel = <Message>(
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
  className = "",
): Html =>
  h.div(
    [
      h.Class(
        `rounded-panel bg-evergreen p-6 text-white sm:p-8 [&_:focus-visible]:outline-mint ${className}`.trim(),
      ),
    ],
    children,
  );

export const alertView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p(
    [
      h.Role("alert"),
      h.Class("mt-2 rounded-control bg-danger-soft px-4 py-3 text-sm font-medium text-danger"),
    ],
    [text],
  );

export const emptyState = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p(
    [
      h.Class(
        "mt-3 rounded-control border border-dashed border-line bg-subtle px-4 py-6 text-center text-muted",
      ),
    ],
    [text],
  );

export type BadgeVariant = "neutral" | "primary" | "brass";

const badgeClasses: Record<BadgeVariant, string> = {
  neutral: "bg-line-soft text-muted",
  primary: "bg-primary-soft text-primary-hover",
  brass: "bg-brass-soft text-brass",
};

export const badge = <Message>(
  variant: BadgeVariant,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [
      h.Class(
        `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold ${badgeClasses[variant]}`,
      ),
    ],
    children,
  );

export const dataTable = <Message>(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<Child>>,
  h: HtmlBuilder<Message>,
): Html =>
  h.table(
    [h.Class("mt-2 w-full text-left text-sm")],
    [
      h.thead(
        [],
        [
          h.tr(
            [h.Class("border-b border-line-soft")],
            headers.map((header) =>
              h.th([h.Class("py-2 pr-4 text-[13px] font-semibold text-muted")], [header]),
            ),
          ),
        ],
      ),
      h.tbody(
        [],
        rows.map((row) =>
          h.tr(
            [h.Class("border-b border-line-soft last:border-b-0")],
            row.map((cell) => h.td([h.Class("py-2 pr-4 tabular-nums")], [cell])),
          ),
        ),
      ),
    ],
  );

export const statList = <Message>(
  items: ReadonlyArray<readonly [label: string, value: string]>,
  h: HtmlBuilder<Message>,
): Html =>
  h.dl(
    [h.Class("grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm")],
    items.flatMap(([label, value]) => [
      h.dt([h.Class("text-muted")], [label]),
      h.dd([h.Class("m-0 font-semibold tabular-nums")], [value]),
    ]),
  );

export const problemView = <Message>(failure: Failure | undefined, h: HtmlBuilder<Message>): Html | null => {
  if (failure === undefined) return null;
  return alertView(failureMessage(failure), h);
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

/** A destructive action waiting for a yes: danger styling, Escape or Cancel closes it without changing anything. */
export const confirmDialog = <Message>(
  config: {
    readonly title: string;
    readonly body: string;
    readonly confirmText: string;
    readonly cancelText: string;
    readonly onConfirm: Message;
    readonly onCancel: Message;
    readonly isBusy?: boolean | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Role("alertdialog"),
      h.AriaModal(true),
      h.AriaLabel(config.title),
      h.Class("flex flex-col gap-3 rounded-control border border-danger bg-danger-soft p-4"),
      h.OnKeyDownPreventDefault((key) => (key === "Escape" ? Option.some(config.onCancel) : Option.none())),
    ],
    [
      h.p([h.Class("font-semibold text-danger")], [config.title]),
      h.p([h.Class("text-sm text-ink")], [config.body]),
      h.div(
        [h.Class("flex flex-wrap gap-3")],
        [
          appButton(
            {
              text: config.confirmText,
              onClick: config.onConfirm,
              isDisabled: config.isBusy === true,
              className: dangerButtonClass,
            },
            h,
          ),
          appButton(
            { text: config.cancelText, onClick: config.onCancel, className: secondaryButtonClass },
            h,
          ),
        ],
      ),
    ],
  );

/** Every IANA zone the browser knows, with the current one first so an unset Team still has a choice. */
export const timeZoneOptions = (current: string): ReadonlyArray<readonly [string, string]> => {
  const known = Intl.supportedValuesOf("timeZone");
  const all = known.includes(current) ? known : [current, ...known];
  return all.map((zone): readonly [string, string] => [zone, zone]);
};

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
            h.label([...label, h.Class(labelClass)], [config.label]),
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
            h.label([...label, h.Class(labelClass)], [config.label]),
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
            h.label([...label, h.Class(labelClass)], [config.label]),
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
          [...label, h.Class("flex min-h-11 items-center gap-3 text-[15px]")],
          [
            h.input([
              ...checkbox,
              h.Type("checkbox"),
              h.Checked(config.isChecked),
              h.Class("size-5 accent-primary"),
            ]),
            config.label,
          ],
        ),
      onToggle: config.onToggle,
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

/** The Sign out form. `inMenu` is the full-width button of the account menus; elsewhere it is the link-styled button under the content. */
export const signOutView = <Message>(h: HtmlBuilder<Message>, inMenu = false): Html =>
  h.form(
    [h.Method("post"), h.Action("/auth/logout"), ...(inMenu ? [] : [h.Class("mt-10")])],
    [
      Button.view(
        {
          type: "submit",
          toView: ({ button }) =>
            h.button(
              [...button, h.Class(inMenu ? `${secondaryButtonClass} w-full` : linkButton)],
              [message("signOut.action")],
            ),
        },
        h,
      ),
    ],
  );

/** The Privacy page's content; signed in it sits in the app shell, otherwise in `privacyView`. */
export const privacyContent = <Message>(h: HtmlBuilder<Message>): ReadonlyArray<Child> => [
  pageTitle(message("privacy.title"), h),
  h.p([h.Class("mt-4")], [h.a([h.Href(teamsHref()), h.Class(linkClass)], [message("privacy.back")])]),
  panel(
    [
      h.div(
        [h.Class("flex flex-col gap-6 leading-relaxed text-muted")],
        (
          [
            ["privacy.anonymity.title", "privacy.anonymity.body"],
            ["privacy.comments.title", "privacy.comments.body"],
            ["privacy.restore.title", "privacy.restore.body"],
            ["privacy.editKey.title", "privacy.editKey.body"],
            ["privacy.restoreTrigger.title", "privacy.restoreTrigger.body"],
          ] as const
        ).map(([title, body]) =>
          h.div([], [subSectionTitle(message(title), h, 2), h.p([h.Class("mt-1")], [message(body)])]),
        ),
      ),
    ],
    h,
    "mt-6",
  ),
];

/** The Privacy page for a visitor who is not signed in. */
export const privacyView = <Message>(h: HtmlBuilder<Message>): Html =>
  pageShell({ privacyCurrent: true }, privacyContent(h), h);
