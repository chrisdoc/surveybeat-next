import { Button, Checkbox, Input, Select, Textarea } from "@foldkit/ui";
import { legalPages, legalUrl, Policy } from "@surveybeat/domain";
import { Option } from "effect";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
import { message } from "../messages/locale.ts";
import { failureMessage } from "./api.ts";
import type { Failure } from "./api.ts";
import { privacyHref, teamsHref } from "./routes.ts";

export type Child = Html | string;

const pressClass =
  "transition-[background-color,border-color,color,transform,box-shadow] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

export const buttonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 py-2 text-[15px] font-semibold text-on-primary shadow-card hover:bg-primary-hover ${pressClass}`;

export const secondaryButtonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2 text-[15px] font-semibold text-ink shadow-card hover:border-primary/40 hover:bg-subtle ${pressClass}`;

export const mintButtonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-mint px-4 py-2 text-[15px] font-semibold text-evergreen hover:bg-mint-text ${pressClass}`;

export const darkOutlineButtonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-mint-text/60 px-4 py-2 text-[15px] font-semibold text-white hover:bg-evergreen-raised ${pressClass}`;

export const dangerButtonClass = `inline-flex min-h-11 items-center justify-center rounded-control bg-danger px-4 py-2 text-sm font-semibold text-on-primary hover:opacity-90 ${pressClass}`;

export const dangerLinkButton =
  "inline-flex min-h-11 items-center px-1 text-sm font-semibold text-danger underline decoration-danger/30 underline-offset-4 transition-colors hover:decoration-danger disabled:opacity-50";

export const linkButton =
  "inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-primary disabled:opacity-50";

export const linkClass =
  "font-semibold text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:text-primary-hover hover:decoration-primary";

export const labelClass = "block text-sm font-semibold text-ink";

export const inputClass =
  "mt-1.5 min-h-11 w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink shadow-card transition-colors placeholder:text-muted/70 hover:border-muted/50 focus:border-primary focus:ring-3 focus:ring-primary/15 disabled:bg-subtle disabled:opacity-70";

export const cardLinkClass =
  "group flex min-h-11 rounded-panel border border-line bg-surface shadow-card transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised";

export const eyebrowClass = "text-xs font-semibold tracking-[0.06em] text-muted uppercase";

export const brandMark = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("28"), h.Height("28"), h.ViewBox("0 0 28 28"), h.AriaHidden(true)],
    [
      h.rect([h.Width("28"), h.Height("28"), h.Rx("7"), h.Fill("#06525C")]),
      h.path([
        h.D("M6 14h4l2-5 4 10 2-5h4"),
        h.Fill("none"),
        h.Stroke("#A8DCD9"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
        h.StrokeLinejoin("round"),
      ]),
    ],
  );

export const legalLinks = <Message>(
  h: HtmlBuilder<Message>,
  className = "inline-flex min-h-11 items-center font-medium text-muted hover:text-ink",
): readonly Html[] =>
  legalPages.map((page) =>
    h.a([h.Href(legalUrl(page)), h.Class(className)], [message(`legal.link.${page}`)]),
  );

export const pageShell = <Message>(
  config: {
    readonly header?: readonly Child[] | undefined;
    readonly wide?: boolean | undefined;
    readonly privacyCurrent?: boolean | undefined;
  },
  children: readonly Child[],
  h: HtmlBuilder<Message>,
): Html => {
  const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
  const readingWidth = config.wide === true ? "" : "max-w-[760px]";
  const privacyCurrent = config.privacyCurrent === true;

  return h.div(
    [h.Class("flex min-h-screen flex-col bg-stone text-ink")],
    [
      h.a(
        [
          h.Href("#main"),
          h.Class(
            "sr-only z-50 min-h-11 items-center rounded-control bg-primary px-4 py-3 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:inline-flex focus:top-3 focus:left-3",
          ),
        ],
        [message("nav.skip")],
      ),
      h.header(
        [h.Class("sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md")],
        [
          h.div(
            [h.Class(`flex min-h-14 min-w-0 items-center gap-x-6 ${container}`)],
            [
              h.a(
                [h.Href(teamsHref()), h.Class("flex min-h-11 shrink-0 items-center gap-2.5")],
                [
                  brandMark(h),
                  h.span(
                    [h.Class("font-display text-[17px] font-semibold tracking-[-0.01em]")],
                    [message("app.title")],
                  ),
                ],
              ),
              ...(config.header ?? []),
            ],
          ),
        ],
      ),
      h.main(
        [h.Id("main"), h.Tabindex(-1), h.Class(`flex-1 pt-6 pb-20 sm:pt-10 ${container}`)],
        [h.div([h.Class(`w-full min-w-0 ${readingWidth}`)], children)],
      ),
      h.footer(
        [h.Class("border-t border-line bg-surface")],
        [
          h.div(
            [h.Class(`flex flex-wrap items-center gap-x-6 py-2 text-sm ${container}`)],
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
              ...legalLinks(h),
            ],
          ),
        ],
      ),
    ],
  );
};

export const screenView = <Message>(
  title: string,
  children: readonly Child[],
  h: HtmlBuilder<Message>,
): Html => pageShell({}, [pageTitle(title, h), ...children], h);

export const pageTitle = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.h1(
    [
      h.Class(
        "font-display text-[28px] leading-[1.15] font-medium tracking-[-0.025em] text-ink sm:text-[34px]",
      ),
    ],
    [text],
  );

export const backLink = <Message>(href: string, text: string, h: HtmlBuilder<Message>): Html =>
  h.a(
    [
      h.Href(href),
      h.Class(
        "inline-flex min-h-11 items-center text-sm font-medium text-muted transition-colors hover:text-primary",
      ),
    ],
    [h.span([h.AriaHidden(true), h.Class("mr-1")], ["‹"]), text],
  );

export interface Crumb {
  readonly label: string;
  readonly href?: string | undefined;
}

export const breadcrumbs = <Message>(crumbs: readonly Crumb[], h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role("navigation"), h.AriaLabel(message("breadcrumb.label"))],
    [
      h.ul(
        [h.Class("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted")],
        crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          const label =
            isLast || crumb.href === undefined
              ? h.span(isLast ? [h.AriaCurrent("page"), h.Class("font-semibold text-ink")] : [], [
                  crumb.label,
                ])
              : h.a(
                  [
                    h.Href(crumb.href),
                    h.Class(
                      "inline-flex min-h-11 items-center font-medium text-muted transition-colors hover:text-primary",
                    ),
                  ],
                  [crumb.label],
                );

          return h.li(
            [h.Class("flex items-center gap-x-1.5")],
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

export const sectionTitle = <Message>(
  text: string,
  h: HtmlBuilder<Message>,
  tone: "default" | "onDark" = "default",
): Html =>
  h.h2(
    [
      h.Class(
        `font-display text-[21px] leading-tight font-medium tracking-[-0.015em] ${tone === "onDark" ? "text-white" : "text-ink"}`,
      ),
    ],
    [text],
  );

export const subSectionTitle = <Message>(
  text: string,
  h: HtmlBuilder<Message>,
  level: 2 | 3 | 4 = 3,
): Html => {
  const attrs = [h.Class("text-base leading-snug font-semibold text-ink")];

  return level === 2 ? h.h2(attrs, [text]) : level === 3 ? h.h3(attrs, [text]) : h.h4(attrs, [text]);
};

export const panel = <Message>(children: readonly Child[], h: HtmlBuilder<Message>, className = ""): Html =>
  h.div(
    [h.Class(`rounded-panel border border-line bg-surface p-5 shadow-card sm:p-6 ${className}`.trim())],
    children,
  );

export const darkPanel = <Message>(
  children: readonly Child[],
  h: HtmlBuilder<Message>,
  className = "",
): Html =>
  h.div(
    [
      h.Class(
        `rounded-panel bg-evergreen p-5 text-white shadow-card sm:p-6 [&_:focus-visible]:outline-mint ${className}`.trim(),
      ),
    ],
    children,
  );

export const alertView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p(
    [
      h.Role("alert"),
      h.Class(
        "mt-2 rounded-control border border-danger/25 bg-danger-soft px-4 py-3 text-sm font-medium text-danger",
      ),
    ],
    [text],
  );

export const emptyState = <Message>(
  config: {
    readonly title: string;
    readonly body: string;
    readonly action?: { readonly text: string; readonly href: string } | undefined;
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class(
        "mt-3 flex flex-col items-start gap-1.5 rounded-panel border border-dashed border-line bg-surface/60 p-6",
      ),
    ],
    [
      h.p([h.Class("font-semibold")], [config.title]),
      h.p([h.Class("max-w-[60ch] text-sm text-muted")], [config.body]),
      ...(config.action === undefined
        ? []
        : [
            h.a(
              [h.Href(config.action.href), h.Class(`inline-flex min-h-11 items-center ${linkClass}`)],
              [config.action.text],
            ),
          ]),
    ],
  );

export type BadgeVariant = "neutral" | "primary" | "brass" | "success" | "danger";

const badgeClasses: Record<BadgeVariant, string> = {
  neutral: "bg-subtle text-muted ring-line",
  primary: "bg-primary-soft text-primary-hover ring-primary/20",
  brass: "bg-brass-soft text-brass ring-brass/20",
  success: "bg-primary-soft text-primary ring-primary/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
};

export const badge = <Message>(
  variant: BadgeVariant,
  children: readonly Child[],
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [
      h.Class(
        `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${badgeClasses[variant]}`,
      ),
    ],
    children,
  );

export const emailAddress = <Message>(
  config: { readonly email: string; readonly className?: string | undefined },
  h: HtmlBuilder<Message>,
): Html => {
  const at = config.email.indexOf("@");

  const [local, domain] =
    at === -1 ? [config.email, ""] : [config.email.slice(0, at), config.email.slice(at)];

  return h.span(
    [h.Class(`min-w-0 wrap-break-word ${config.className ?? ""}`.trim())],
    [local, h.wbr([]), domain],
  );
};

export const rowActionsMenu = <Message>(
  config: { readonly label: string; readonly items: readonly (Html | null)[] },
  h: HtmlBuilder<Message>,
): Html =>
  h.details(
    [h.Class("relative")],
    [
      h.summary(
        [
          h.Class(
            "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-card transition-colors hover:border-primary/40 hover:bg-subtle",
          ),
        ],
        [config.label, h.span([h.AriaHidden(true)], [" \u203A"])],
      ),
      h.div(
        [
          h.Class(
            "absolute left-0 z-20 mt-2 flex w-[min(20rem,calc(100vw-4rem))] flex-col items-start gap-2 rounded-panel border border-line bg-surface p-3 shadow-raised sm:left-auto sm:right-0",
          ),
        ],
        config.items.filter((item): item is Html => item !== null),
      ),
    ],
  );

export const dataTable = <Message>(
  headers: readonly string[],
  rows: readonly (readonly Child[])[],
  h: HtmlBuilder<Message>,
  options: { readonly stackOnPhone?: boolean | undefined } = {},
): Html => {
  const stacked = options.stackOnPhone === true;
  const role = (name: string): readonly Attribute<Message>[] => (stacked ? [h.Role(name)] : []);

  return h.table(
    [
      h.Class(stacked ? "mt-2 block w-full text-left text-sm sm:table" : "mt-2 w-full text-left text-sm"),
      ...role("table"),
    ],
    [
      h.thead(stacked ? [h.Class("sr-only sm:not-sr-only sm:table-header-group"), ...role("rowgroup")] : [], [
        h.tr(
          [h.Class("border-b border-line-soft"), ...role("row")],
          headers.map((header) =>
            h.th(
              [
                h.Class("py-2.5 pr-4 text-xs font-semibold tracking-[0.04em] text-muted uppercase"),
                ...role("columnheader"),
              ],
              [header],
            ),
          ),
        ),
      ]),
      h.tbody(
        stacked ? [h.Class("block sm:table-row-group"), ...role("rowgroup")] : [],
        rows.map((row) =>
          h.tr(
            [
              h.Class(
                stacked
                  ? "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft py-3 last:border-b-0 sm:table-row sm:py-0"
                  : "border-b border-line-soft last:border-b-0",
              ),
              ...role("row"),
            ],
            row.map((cell) =>
              h.td(
                [
                  h.Class(stacked ? "w-full py-2 pr-4 tabular-nums sm:w-auto" : "py-2 pr-4 tabular-nums"),
                  ...role("cell"),
                ],
                [cell],
              ),
            ),
          ),
        ),
      ),
    ],
  );
};

export const statList = <Message>(
  items: readonly (readonly [label: string, value: string])[],
  h: HtmlBuilder<Message>,
): Html =>
  h.dl(
    [h.Class("grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm")],
    items.flatMap(([label, value]) => [
      h.dt([h.Class("text-muted")], [label]),
      h.dd([h.Class("m-0 text-right font-semibold tabular-nums")], [value]),
    ]),
  );

export const loadingView = <Message>(
  h: HtmlBuilder<Message>,
  shape: "page" | "list" | "results" = "page",
): Html => {
  const block = (className: string): Html => h.div([h.AriaHidden(true), h.Class(`skeleton ${className}`)]);

  const blocks =
    shape === "list"
      ? [block("h-20 w-full"), block("h-20 w-full"), block("h-20 w-full")]
      : shape === "results"
        ? [
            block("h-24 w-full"),
            h.div(
              [h.Class("grid gap-3 sm:grid-cols-2 lg:grid-cols-4")],
              [block("h-40"), block("h-40"), block("h-40"), block("h-40")],
            ),
            block("h-72 w-full"),
            block("h-72 w-full"),
          ]
        : [block("h-9 w-2/3"), block("h-5 w-1/2"), block("h-40 w-full"), block("h-40 w-full")];

  return h.div(
    [h.Role("status"), h.Class("mt-6 flex flex-col gap-3")],
    [h.span([h.Class("sr-only")], [message("app.loading")]), ...blocks],
  );
};

export const problemView = <Message>(failure: Failure | undefined, h: HtmlBuilder<Message>): Html | null => {
  if (failure === undefined) {
    return null;
  }

  return alertView(failureMessage(failure), h);
};

export const appButton = <Message>(
  config: {
    readonly text: string;

    readonly icon?: string | undefined;
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
          [
            ...(config.icon === undefined
              ? []
              : [h.span([h.AriaHidden(true), h.Class("mr-1.5")], [config.icon])]),
            config.text,
          ],
        ),
      type: config.type ?? "button",
      ...(config.onClick !== undefined ? { onClick: config.onClick } : {}),
      ...(config.isDisabled !== undefined ? { isDisabled: config.isDisabled } : {}),
    },
    h,
  );

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
      h.Class("flex flex-col gap-3 rounded-panel border border-danger/40 bg-danger-soft p-4 shadow-raised"),
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

export const timeZoneOptions = (current: string): readonly (readonly [string, string])[] => {
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
    readonly autocomplete?: string | undefined;
    readonly autofocus?: boolean | undefined;
    readonly ariaDescribedBy?: string | undefined;
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
              ...(config.autocomplete !== undefined ? [h.Autocomplete(config.autocomplete)] : []),
              ...(config.autofocus === true ? [h.Autofocus(true)] : []),
              ...(config.ariaDescribedBy !== undefined ? [h.AriaDescribedBy(config.ariaDescribedBy)] : []),
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
    readonly options: readonly (readonly [V, string])[];
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
          [...label, h.Class("flex min-h-11 cursor-pointer items-center gap-3 text-[15px]")],
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

export const downloadPersonalDataView = <Message>(h: HtmlBuilder<Message>, inMenu = false): Html =>
  h.form(
    [h.Method("get"), h.Action("/api/me/data-export"), ...(inMenu ? [] : [h.Class("mt-6")])],
    [
      Button.view(
        {
          type: "submit",
          toView: ({ button }) =>
            h.button(
              [...button, h.Class(inMenu ? `${secondaryButtonClass} w-full` : secondaryButtonClass)],
              [message("personalData.download")],
            ),
        },
        h,
      ),
    ],
  );

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

export const privacyContent = <Message>(
  h: HtmlBuilder<Message>,
  signedIn = false,
  erasure: readonly Child[] = [],
): readonly Child[] => [
  pageTitle(message("privacy.title"), h),
  h.p([h.Class("mt-4")], [h.a([h.Href(teamsHref()), h.Class(linkClass)], [message("privacy.back")])]),
  h.p([h.Class("mt-4 leading-relaxed text-muted")], [message("legal.intro")]),
  h.ul(
    [h.Class("mt-2 flex flex-wrap gap-x-6")],
    legalLinks(h, linkClass).map((link) => h.li([], [link])),
  ),
  panel(
    [
      h.div(
        [h.Class("flex flex-col gap-6 leading-relaxed text-muted")],
        (
          [
            [
              message("privacy.groupSize.title"),
              message("privacy.groupSize.body", {
                groupSize: Policy.groupSize.defaultValue,
                minimum: Policy.groupSize.minimum,
              }),
            ],
            [message("privacy.aiProcessing.title"), message("privacy.aiProcessing.body")],
            [message("privacy.anonymity.title"), message("privacy.anonymity.body")],
            [message("privacy.comments.title"), message("privacy.comments.body")],
            [
              message("privacy.restore.title", { days: Policy.backupRetentionDays }),
              message("privacy.restore.body", { days: Policy.backupRetentionDays }),
            ],
            [message("privacy.editKey.title"), message("privacy.editKey.body")],
            [message("privacy.restoreTrigger.title"), message("privacy.restoreTrigger.body")],
          ] as const
        ).map(([title, body]) => h.div([], [subSectionTitle(title, h, 2), h.p([h.Class("mt-1")], [body])])),
      ),
    ],
    h,
    "mt-6",
  ),
  ...(signedIn
    ? [
        panel(
          [
            subSectionTitle(message("personalData.title"), h, 2),
            h.p([h.Class("mt-1 leading-relaxed text-muted")], [message("personalData.body")]),
            downloadPersonalDataView(h),
          ],
          h,
          "mt-6",
        ),
        ...erasure,
      ]
    : []),
];

export const privacyView = <Message>(h: HtmlBuilder<Message>): Html =>
  pageShell({ privacyCurrent: true }, privacyContent(h), h);
