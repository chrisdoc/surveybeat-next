import {
  EmailAddress,
  EmailSendProgress,
  FailedEmail,
  FailedEmails,
  Locale,
  MinimumGroupSize,
  OrganizationSettings,
  PersonId,
  SendId,
  TeamDetail,
  TeamName,
  TeamSummary,
  TimeZone,
} from "@surveybeat/domain";
import { Nav, Popover } from "@foldkit/ui";
import { Option, Predicate, Schema } from "effect";
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, formatRoundDate, message, pluralMessage } from "../messages/locale.ts";
import { Failure, failureMessage } from "./api.ts";
import {
  type Child,
  appButton,
  badge,
  confirmDialog,
  dangerButtonClass,
  dataTable,
  dangerLinkButton,
  emptyState,
  linkButton,
  linkClass,
  pageShell,
  pageTitle,
  problemView,
  secondaryButtonClass,
  selectField,
  timeZoneOptions,
  signOutView,
  checkboxField,
  subSectionTitle,
  textField,
} from "./components.ts";
import { historyHref, pulsesHref, settingsHref, teamHref, teamsHref } from "./routes.ts";
import { failureReasonText } from "./pulses.ts";

export const LoadedTeams = defineTaggedUnion({
  Loading: {},
  Loaded: { teams: Schema.Array(TeamSummary) },
  Failed: { failure: Failure },
});
export type LoadedTeams = typeof LoadedTeams.Type;

export const LoadedTeam = defineTaggedUnion({
  Loading: {},
  Loaded: { detail: TeamDetail },
  Failed: { failure: Failure },
});
export type LoadedTeam = typeof LoadedTeam.Type;

export const LoadedSettings = defineTaggedUnion({
  Loading: {},
  Loaded: { settings: OrganizationSettings },
  Failed: { failure: Failure },
});
export type LoadedSettings = typeof LoadedSettings.Type;

export const LoadedFailedEmails = defineTaggedUnion({
  Loading: {},
  Loaded: { list: FailedEmails },
  Failed: { failure: Failure },
});
export type LoadedFailedEmails = typeof LoadedFailedEmails.Type;

/**
 * An admin's Resend of one failed send, as its row shows it. `Resending` while the Resend is in flight; `Resent`
 * holds the send's state as last read and how many reads it took; `Failed` says why the Resend did not go through.
 */
export const FailedEmailResend = Schema.Union([
  Schema.TaggedStruct("Resending", {}),
  Schema.TaggedStruct("Resent", {
    state: EmailSendProgress,
    polls: Schema.Int,
    statusUnavailable: Schema.Boolean,
  }),
  Schema.TaggedStruct("Failed", { failure: Failure }),
]);
export type FailedEmailResend = typeof FailedEmailResend.Type;

/** A resent send is checked this often, and the row stops checking after `FAILED_EMAIL_MAX_POLLS` reads (fifteen minutes). */
export const FAILED_EMAIL_POLL_INTERVAL = "3 seconds";
export const FAILED_EMAIL_MAX_POLLS = 300;

/** Whether a row should read its resent send again: it is still queued or sending, and the row has not given up. */
export const failedEmailKeepsPolling = (state: EmailSendProgress, polls: number): boolean =>
  (state._tag === "Queued" || state._tag === "Sending") && polls < FAILED_EMAIL_MAX_POLLS;

const formPanelClass = "mt-8 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:p-8";

export const roleName = (role: TeamSummary["yourRole"]): string =>
  role === null ? "" : message(`role.${role}`);

export const decodeName = Schema.decodeUnknownOption(TeamName);
export const decodeZone = Schema.decodeUnknownOption(TimeZone);
export const decodeEmail = Schema.decodeUnknownOption(EmailAddress);
export const decodeSize = Schema.decodeUnknownOption(MinimumGroupSize);
export const decodePerson = Schema.decodeUnknownOption(PersonId);

/** The Person's language choice: `value` is `null` to follow the browser (ADR 0018). */
export interface LanguageChoice<Message> {
  readonly value: Locale | null;
  readonly busy: boolean;
  readonly failure?: Failure | undefined;
  readonly onChange: (value: string) => Message;
}

/** A top-level section of the signed-in app, as the navigation lists them. Team screens belong to `teams`. */
export type NavSection = "teams" | "history" | "settings";

/** What the header shows: the Organization, the section on screen, and the two header menus (phone navigation and account). */
export interface ShellHeader<Message> {
  readonly organizationName: string;
  readonly organizationAdmin: boolean;
  readonly section: NavSection | null;
  /** The Privacy page, whose footer link is marked current. */
  readonly privacyCurrent: boolean;
  readonly navMenu: Popover.Model;
  readonly accountMenu: Popover.Model;
  readonly onNavMenu: (message: Popover.Message) => Message;
  readonly onAccountMenu: (message: Popover.Message) => Message;
}

const sectionHref = (section: NavSection): string => {
  switch (section) {
    case "teams":
      return teamsHref();
    case "history":
      return historyHref();
    case "settings":
      return settingsHref();
  }
};

const sectionNav = <Message>(
  config: {
    readonly sections: ReadonlyArray<NavSection>;
    readonly current: NavSection | null;
    readonly className: string;
    readonly linkClass: (isCurrent: boolean) => string;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Nav.view<NavSection>({
    items: config.sections,
    ariaLabel: message("nav.label"),
    toHref: (section) => sectionHref(section),
    isItemCurrent: (section) => section === config.current,
    toView: ({ nav, items }) =>
      h.nav(
        [...nav, h.Class(config.className)],
        items.map((item) =>
          h.a([...item.link, h.Class(config.linkClass(item.isCurrent))], [message(`nav.${item.value}`)]),
        ),
      ),
  });

const desktopLinkClass = (isCurrent: boolean): string =>
  `inline-flex min-h-11 items-center border-b-2 ${
    isCurrent
      ? "border-primary font-semibold text-ink"
      : "border-transparent font-medium text-muted hover:text-ink"
  }`;

const phoneLinkClass = (isCurrent: boolean): string =>
  `flex min-h-11 items-center rounded-control px-3 ${
    isCurrent ? "bg-primary-soft font-semibold text-primary" : "font-medium text-ink hover:bg-subtle"
  }`;

const menuPanelClass =
  "z-50 w-[min(20rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-4 shadow-lg";

const chevronIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("16"), h.Height("16"), h.ViewBox("0 0 16 16"), h.AriaHidden(true), h.Class("shrink-0")],
    [
      h.path([
        h.D("M4 6l4 4 4-4"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
        h.StrokeLinejoin("round"),
      ]),
    ],
  );

const hamburgerIcon = <Message>(h: HtmlBuilder<Message>): Html =>
  h.svg(
    [h.Width("18"), h.Height("18"), h.ViewBox("0 0 18 18"), h.AriaHidden(true), h.Class("shrink-0")],
    [
      h.path([
        h.D("M3 5h12M3 9h12M3 13h12"),
        h.Fill("none"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.8"),
        h.StrokeLinecap("round"),
      ]),
    ],
  );

/** A header menu: a trigger button and a panel that is rendered only while the menu is open. */
const headerMenu = <Message>(
  model: Popover.Model,
  toParentMessage: (message: Popover.Message) => Message,
  parts: {
    readonly button: (attributes: ReadonlyArray<ChildAttribute>) => Html;
    readonly panel: (attributes: ReadonlyArray<ChildAttribute>) => Html;
  },
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.id,
    model,
    view: Popover.view,
    viewInputs: {
      anchor: { placement: "bottom-end", gap: 8 },
      toView: ({ button, panel, isVisible }) =>
        h.div(
          [h.Class("relative")],
          [parts.button(button), isVisible ? parts.panel(panel) : null].filter(Predicate.isNotNull),
        ),
    },
    toParentMessage,
  });

export const shellView = <Message>(
  header: ShellHeader<Message>,
  children: ReadonlyArray<Child>,
  language: LanguageChoice<Message>,
  h: HtmlBuilder<Message>,
  wide = false,
): Html => {
  const sections: ReadonlyArray<NavSection> = header.organizationAdmin
    ? ["teams", "history", "settings"]
    : ["teams", "history"];

  // The Language select sits in each open menu under its own id; the menus render only while open.
  const languageField = (id: string): Html =>
    selectField(
      {
        id,
        label: message("language.label"),
        value: language.value ?? "",
        options: [
          ["", message("language.followBrowser")],
          ["en", message("language.en")],
          ["de", message("language.de")],
        ],
        isDisabled: language.busy,
        onChange: language.onChange,
      },
      h,
    );
  const languageProblem = (): Html | null => problemView(language.failure, h);

  const accountButton = (attributes: ReadonlyArray<ChildAttribute>): Html =>
    h.button(
      [
        ...attributes,
        h.Class(
          "inline-flex min-h-11 max-w-[16rem] items-center gap-2 rounded-control px-3 font-semibold text-ink hover:bg-subtle",
        ),
      ],
      [
        h.span([h.Class("min-w-0 truncate")], [header.organizationName]),
        // A text space so the accessible name reads "Acme Account menu", not "AcmeAccount menu".
        " ",
        h.span([h.Class("sr-only")], [message("account.menu")]),
        chevronIcon(h),
      ],
    );

  const accountPanel = (attributes: ReadonlyArray<ChildAttribute>): Html =>
    h.div(
      [...attributes, h.Class(menuPanelClass)],
      [
        h.div(
          [h.Class("flex flex-col gap-3")],
          [languageField("language"), languageProblem(), signOutView(h, true)].filter(Predicate.isNotNull),
        ),
      ],
    );

  const menuButton = (attributes: ReadonlyArray<ChildAttribute>): Html =>
    h.button(
      [
        ...attributes,
        h.Class(
          "inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 font-semibold text-ink hover:bg-subtle",
        ),
      ],
      [hamburgerIcon(h), message("nav.menu")],
    );

  const navPanel = (attributes: ReadonlyArray<ChildAttribute>): Html =>
    h.div(
      [...attributes, h.Class(`${menuPanelClass} max-h-[calc(100vh-6rem)] overflow-y-auto`)],
      [
        sectionNav(
          { sections, current: header.section, className: "flex flex-col gap-1", linkClass: phoneLinkClass },
          h,
        ),
        h.div(
          [h.Class("mt-4 flex flex-col gap-3 border-t border-line-soft pt-4")],
          [
            h.p([h.Class("break-words text-sm font-semibold text-muted")], [header.organizationName]),
            languageField("language-menu"),
            languageProblem(),
            signOutView(h, true),
          ].filter(Predicate.isNotNull),
        ),
      ],
    );

  return pageShell(
    {
      wide,
      privacyCurrent: header.privacyCurrent,
      header: [
        sectionNav(
          {
            sections,
            current: header.section,
            className: "hidden min-w-0 items-center gap-x-6 text-[15px] lg:ml-auto lg:flex",
            linkClass: desktopLinkClass,
          },
          h,
        ),
        h.div(
          [h.Class("hidden lg:block")],
          [
            headerMenu(
              header.accountMenu,
              header.onAccountMenu,
              { button: accountButton, panel: accountPanel },
              h,
            ),
          ],
        ),
        h.div(
          [h.Class("ml-auto lg:hidden")],
          [headerMenu(header.navMenu, header.onNavMenu, { button: menuButton, panel: navPanel }, h)],
        ),
      ],
    },
    children,
    h,
  );
};

/** One thing on the home page that needs the person's attention, with the link that acts on it. */
export interface AttentionItem {
  readonly label: string;
  readonly text: string;
  readonly detail: string;
  readonly href: string;
}

/** The home page's attention list: what is waiting, or one sentence and a link when nothing is. */
const attentionView = <Message>(items: ReadonlyArray<AttentionItem>, h: HtmlBuilder<Message>): Html =>
  items.length === 0
    ? emptyState(
        {
          title: message("home.attention.empty.title"),
          body: message("home.attention.empty.body"),
          action: { text: message("home.attention.empty.action"), href: historyHref() },
        },
        h,
      )
    : h.ul(
        [h.Class("mt-3 flex flex-col gap-2")],
        items.map((item) =>
          h.li(
            [h.Class("flex flex-wrap items-baseline gap-x-3 gap-y-1")],
            [
              h.span([h.Class("text-sm font-semibold text-muted")], [item.label]),
              h.a([h.Href(item.href), h.Class(`break-words ${linkClass}`)], [item.text]),
              h.span([h.Class("text-sm text-muted")], [item.detail]),
            ],
          ),
        ),
      );

export const teamsScreenView = <Message>(
  state: {
    readonly teams: LoadedTeams;
    readonly attention: ReadonlyArray<AttentionItem>;
    readonly organizationAdmin: boolean;
    readonly createName: string;
    readonly createTimeZone: string;
    readonly createLeadEmail: string;
    readonly createBusy: boolean;
    readonly createFailure?: Failure | undefined;
    readonly createOpen: boolean;
  },
  actions: {
    readonly onNameChange: (name: string) => Message;
    readonly onTimeZoneChange: (tz: string) => Message;
    readonly onLeadEmailChange: (email: string) => Message;
    readonly onSubmitCreate: Message;
    readonly onToggleCreate: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [
    pageTitle(message("home.attention.title"), h),
    attentionView(state.attention, h),
  ];

  if (state.teams._tag === "Loaded" && state.teams.teams.length > 0) {
    children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("home.teams.title"), h, 2)]));
  }

  if (state.teams._tag === "Failed") {
    children.push(problemView(state.teams.failure, h)!);
  } else if (state.teams._tag === "Loaded") {
    if (state.teams.teams.length === 0) {
      children.push(emptyState({ title: message("teams.empty.title"), body: message("teams.empty") }, h));
    } else {
      children.push(
        h.ul(
          [h.Class("mt-6 flex flex-col gap-3")],
          state.teams.teams.map((team) =>
            h.li(
              [],
              [
                h.a(
                  [
                    h.Href(teamHref(team.id)),
                    h.Class(
                      "flex min-h-11 items-center justify-between gap-4 rounded-panel border border-line bg-surface px-6 py-4 hover:border-primary",
                    ),
                  ],
                  [
                    h.span(
                      [h.Class("flex min-w-0 flex-col gap-1")],
                      [
                        h.span(
                          [h.Class("flex flex-wrap items-center gap-2 text-lg font-semibold")],
                          [
                            h.span([h.Class("min-w-0 break-words")], [team.name]),
                            team.yourRole === "lead"
                              ? badge("primary", [roleName(team.yourRole)], h)
                              : team.yourRole === "member"
                                ? badge("neutral", [message("settings.member")], h)
                                : null,
                          ].filter(Predicate.isNotNull),
                        ),
                        h.span(
                          [h.Class("text-sm text-muted")],
                          [
                            [
                              team.memberCount === undefined
                                ? null
                                : pluralMessage("teams.members", team.memberCount),
                              team.nextRoundDate === undefined
                                ? null
                                : team.nextRoundDate === null
                                  ? message("teams.noRound")
                                  : message("teams.nextRound", {
                                      date: formatRoundDate(team.nextRoundDate),
                                    }),
                            ]
                              .filter(Predicate.isNotNull)
                              .join(" · "),
                          ],
                        ),
                      ],
                    ),
                    h.span([h.AriaHidden(true), h.Class("text-xl text-muted")], ["›"]),
                  ],
                ),
              ],
            ),
          ),
        ),
      );
    }
  }

  if (state.organizationAdmin && !state.createOpen) {
    children.push(
      h.div(
        [h.Class("mt-6")],
        [
          appButton(
            {
              text: message("teams.create.open"),
              onClick: actions.onToggleCreate,
              className: secondaryButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  }

  if (state.organizationAdmin && state.createOpen) {
    children.push(
      h.form(
        [h.Class(formPanelClass), h.OnSubmit(actions.onSubmitCreate)],
        [
          subSectionTitle(message("teams.create.title"), h, 2),
          textField(
            {
              id: "create-team-name",
              label: message("teams.create.name"),
              value: state.createName,
              isDisabled: state.createBusy,
              onInput: actions.onNameChange,
            },
            h,
          ),
          selectField(
            {
              id: "create-team-tz",
              label: message("teams.create.timeZone"),
              value: state.createTimeZone,
              options: timeZoneOptions(state.createTimeZone),
              isDisabled: state.createBusy,
              onChange: actions.onTimeZoneChange,
            },
            h,
          ),
          textField(
            {
              id: "create-team-lead",
              label: message("teams.create.leadEmail"),
              value: state.createLeadEmail,
              type: "email",
              isDisabled: state.createBusy,
              onInput: actions.onLeadEmailChange,
            },
            h,
          ),
          problemView(state.createFailure, h),
          h.div(
            [h.Class("flex flex-wrap gap-3")],
            [
              appButton(
                {
                  text: message("teams.create.action"),
                  type: "submit",
                  isDisabled: state.createBusy,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  onClick: actions.onToggleCreate,
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

  return h.section([], children);
};

/** One step of the first-run checklist: what to do, where it happens, and whether it is done. */
export interface ChecklistStep {
  readonly text: string;
  readonly detail?: string | undefined;
  readonly href: string;
  readonly done: boolean;
}

/** The first-run checklist a Team shows until its first Round is shared: numbered steps, each a link. */
const firstRunChecklistView = <Message>(steps: ReadonlyArray<ChecklistStep>, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class("mt-8 rounded-panel border border-line bg-surface p-6")],
    [
      subSectionTitle(message("team.checklist.title"), h, 2),
      h.ol(
        [h.Class("mt-3 flex flex-col gap-3")],
        steps.map((step, index) =>
          h.li(
            [h.Class("flex flex-wrap items-baseline gap-x-3 gap-y-1")],
            [
              h.span([h.Class("text-sm font-semibold text-muted")], [`${index + 1}.`]),
              h.a([h.Href(step.href), h.Class(`break-words ${linkClass}`)], [step.text]),
              ...(step.detail === undefined ? [] : [h.span([h.Class("text-sm text-muted")], [step.detail])]),
              badge(
                step.done ? "primary" : "neutral",
                [message(step.done ? "team.checklist.done" : "team.checklist.todo")],
                h,
              ),
            ],
          ),
        ),
      ),
    ],
  );

export const teamScreenView = <Message>(
  state: {
    readonly team: LoadedTeam;
    readonly checklist: ReadonlyArray<ChecklistStep> | null;
    readonly renameName: string;
    readonly renameTimeZone: string;
    readonly renameBusy: boolean;
    readonly renameFailure?: Failure | undefined;
    readonly addMemberEmail: string;
    readonly addMemberBusy: boolean;
    readonly addMemberAdded: boolean;
    readonly addMemberFailure?: Failure | undefined;
    readonly assignLeadEmail: string;
    readonly assignLeadBusy: boolean;
    readonly assignLeadAdded: boolean;
    readonly assignLeadFailure?: Failure | undefined;
    readonly rosterBusy: boolean;
    readonly rosterFailure?: Failure | undefined;
    readonly renameOpen: boolean;
    readonly addMemberOpen: boolean;
    readonly assignLeadOpen: boolean;
    readonly pendingRemove:
      | { readonly kind: "member" | "lead"; readonly personId: PersonId; readonly email: string }
      | undefined;
  },
  actions: {
    readonly onRenameNameChange: (name: string) => Message;
    readonly onRenameTimeZoneChange: (tz: string) => Message;
    readonly onSubmitRename: Message;
    readonly onAddMemberEmailChange: (email: string) => Message;
    readonly onSubmitAddMember: Message;
    readonly onAssignLeadEmailChange: (email: string) => Message;
    readonly onSubmitAssignLead: Message;
    readonly onRemoveMember: (personId: PersonId) => Message;
    readonly onRemoveLead: (personId: PersonId) => Message;
    readonly onToggleRename: Message;
    readonly onToggleAddMember: Message;
    readonly onToggleAssignLead: Message;
    readonly onConfirmRemove: Message;
    readonly onCancelRemove: Message;
  },
  overview: Html,
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [h.a([h.Href(teamsHref()), h.Class(linkClass)], [message("team.back")])];

  if (state.team._tag === "Failed") {
    children.push(problemView(state.team.failure, h)!);
    return h.section([], children);
  }

  if (state.team._tag !== "Loaded") {
    return h.section([], children);
  }

  const { detail } = state.team;
  children.push(h.div([h.Class("mt-4")], [pageTitle(detail.team.name, h)]));
  if (state.checklist !== null) {
    children.push(firstRunChecklistView(state.checklist, h));
  }
  children.push(
    h.p([h.Class("mt-2 text-muted")], [message("team.timeZone", { timeZone: detail.team.timeZone })]),
  );

  if (detail.team.yourRole === null) {
    children.push(h.p([h.Class("mt-2 text-muted")], [message("team.noResultsAccess")]));
  }

  if (detail.may.managePulses) {
    children.push(
      h.a(
        [h.Href(pulsesHref(detail.team.id)), h.Class(`mt-4 inline-block ${linkClass}`)],
        [message("team.pulses")],
      ),
    );
  }

  // The Team health overview is Results, so it follows the same right as the Results screen.
  if (detail.may.viewResults) {
    children.push(h.div([h.Class("mt-8")], [overview]));
  }

  if (detail.may.update && !state.renameOpen) {
    children.push(
      h.div(
        [h.Class("mt-6")],
        [
          appButton(
            {
              text: message("team.rename.open"),
              onClick: actions.onToggleRename,
              className: secondaryButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  }

  if (detail.may.update && state.renameOpen) {
    children.push(
      h.form(
        [h.Class(formPanelClass), h.OnSubmit(actions.onSubmitRename)],
        [
          subSectionTitle(message("team.rename.title"), h, 2),
          textField(
            {
              id: "rename-team-name",
              label: message("teams.create.name"),
              value: state.renameName,
              isDisabled: state.renameBusy,
              onInput: actions.onRenameNameChange,
            },
            h,
          ),
          selectField(
            {
              id: "rename-team-tz",
              label: message("teams.create.timeZone"),
              value: state.renameTimeZone,
              options: timeZoneOptions(state.renameTimeZone),
              isDisabled: state.renameBusy,
              onChange: actions.onRenameTimeZoneChange,
            },
            h,
          ),
          problemView(state.renameFailure, h),
          h.div(
            [h.Class("flex flex-wrap gap-3")],
            [
              appButton(
                {
                  text: message("team.rename.action"),
                  type: "submit",
                  isDisabled: state.renameBusy,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  onClick: actions.onToggleRename,
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

  // Roster
  children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("team.roster"), h, 2)]));
  children.push(
    h.ul(
      [h.Class("mt-3 rounded-panel border border-line bg-surface px-6")],
      detail.roster.map((entry) => {
        const isLead = entry.role === "lead";
        const mayRemove = isLead ? detail.may.manageLeads : detail.may.manageMembers;
        return h.li(
          [
            h.Class(
              "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft py-3 last:border-b-0",
            ),
          ],
          [
            h.span(
              [h.Class("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1")],
              [
                h.span([h.Class("break-all font-medium")], [entry.email]),
                badge("neutral", [roleName(entry.role)], h),
                h.span(
                  [h.Class("text-sm text-muted")],
                  [message("team.since", { date: formatDate(new Date(entry.since)) })],
                ),
              ],
            ),
            mayRemove && state.pendingRemove?.personId !== entry.personId
              ? appButton(
                  {
                    text: message(isLead ? "team.removeLead" : "team.removeMember"),
                    isDisabled: state.rosterBusy,
                    className: dangerButtonClass,
                    onClick: isLead
                      ? actions.onRemoveLead(entry.personId)
                      : actions.onRemoveMember(entry.personId),
                  },
                  h,
                )
              : null,
            mayRemove && state.pendingRemove?.personId === entry.personId
              ? confirmDialog(
                  {
                    title: message("confirm.removeTitle"),
                    body: message("confirm.removeMemberBody", {
                      email: state.pendingRemove.email,
                    }),
                    confirmText: message("team.removeMember"),
                    cancelText: message("confirm.cancel"),
                    isBusy: state.rosterBusy,
                    onConfirm: actions.onConfirmRemove,
                    onCancel: actions.onCancelRemove,
                  },
                  h,
                )
              : null,
          ].filter(Predicate.isNotNull),
        );
      }),
    ),
  );
  if (state.rosterFailure) {
    children.push(problemView(state.rosterFailure, h)!);
  }

  // Add Member
  if (detail.may.manageMembers && !state.addMemberOpen) {
    children.push(
      h.div(
        [h.Class("mt-6")],
        [
          appButton(
            {
              text: message("team.addMember.open"),
              onClick: actions.onToggleAddMember,
              className: secondaryButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  }

  if (detail.may.manageMembers && state.addMemberOpen) {
    children.push(
      h.form(
        [h.Class(formPanelClass), h.OnSubmit(actions.onSubmitAddMember)],
        [
          textField(
            {
              id: "add-member-email",
              label: message("team.addMember.label"),
              value: state.addMemberEmail,
              type: "email",
              isDisabled: state.addMemberBusy,
              onInput: actions.onAddMemberEmailChange,
            },
            h,
          ),
          problemView(state.addMemberFailure, h),
          state.addMemberAdded
            ? h.p([h.Role("status"), h.Class("text-sm font-medium text-primary")], [message("team.added")])
            : null,
          h.div(
            [h.Class("flex flex-wrap gap-3")],
            [
              appButton(
                {
                  text: message("team.addMember.action"),
                  type: "submit",
                  isDisabled: state.addMemberBusy,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  onClick: actions.onToggleAddMember,
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

  // Assign Lead
  if (detail.may.manageLeads && !state.assignLeadOpen) {
    children.push(
      h.div(
        [h.Class("mt-6")],
        [
          appButton(
            {
              text: message("team.assignLead.open"),
              onClick: actions.onToggleAssignLead,
              className: secondaryButtonClass,
            },
            h,
          ),
        ],
      ),
    );
  }

  if (detail.may.manageLeads && state.assignLeadOpen) {
    children.push(
      h.form(
        [h.Class(formPanelClass), h.OnSubmit(actions.onSubmitAssignLead)],
        [
          textField(
            {
              id: "assign-lead-email",
              label: message("team.assignLead.label"),
              value: state.assignLeadEmail,
              type: "email",
              isDisabled: state.assignLeadBusy,
              onInput: actions.onAssignLeadEmailChange,
            },
            h,
          ),
          problemView(state.assignLeadFailure, h),
          state.assignLeadAdded
            ? h.p([h.Role("status"), h.Class("text-sm font-medium text-primary")], [message("team.added")])
            : null,
          h.div(
            [h.Class("flex flex-wrap gap-3")],
            [
              appButton(
                {
                  text: message("team.assignLead.action"),
                  type: "submit",
                  isDisabled: state.assignLeadBusy,
                },
                h,
              ),
              appButton(
                {
                  text: message("confirm.cancel"),
                  onClick: actions.onToggleAssignLead,
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

  return h.section([], children);
};

/** A send's failure reason, with its provider code when it has one. */
const failedEmailReasonText = (reason: FailedEmail["reason"], code: string | null): string =>
  code === null
    ? failureReasonText(reason)
    : message("email.reasonCode", { reason: failureReasonText(reason), code });

/** A resent send's state, as the row says it: queued, sending, sent, or not sent with its reason. */
const failedEmailStatusText = (state: EmailSendProgress): string => {
  switch (state._tag) {
    case "Queued":
      return message("settings.failedEmails.status.queued");
    case "Sending":
      return message("settings.failedEmails.status.sending");
    case "Sent":
      return message("settings.failedEmails.status.sent");
    case "Failed":
      return message("settings.failedEmails.status.failed", {
        reason: failedEmailReasonText(state.reason, state.code),
      });
  }
};

/** The Action cell of one failed send: the Resend button, and what the last Resend said about the send. */
const failedEmailActionView = <Message>(
  email: FailedEmail,
  resend: FailedEmailResend | undefined,
  onResend: (sendId: SendId) => Message,
  h: HtmlBuilder<Message>,
): Child => {
  const resendButton = (isDisabled: boolean, text: string): Child =>
    appButton({ text, isDisabled, className: linkButton, onClick: onResend(email.sendId) }, h);
  const children: Array<Child> = [];
  if (resend === undefined) {
    if (email.resendable) children.push(resendButton(false, message("settings.failedEmails.resend")));
  } else {
    switch (resend._tag) {
      case "Resending":
        children.push(resendButton(true, message("settings.failedEmails.resending")));
        break;
      case "Resent":
        children.push(h.p([h.Role("status")], [failedEmailStatusText(resend.state)]));
        if (resend.statusUnavailable) {
          children.push(h.p([], [message("settings.failedEmails.statusUnavailable")]));
        }
        if (resend.state._tag === "Failed") {
          children.push(resendButton(false, message("settings.failedEmails.resend")));
        }
        break;
      case "Failed":
        if (resend.failure === "EmailNotResendable") {
          children.push(h.p([h.Role("status")], [failureMessage(resend.failure)]));
        } else {
          children.push(h.p([h.Role("status")], [message("settings.failedEmails.resendFailed")]));
          children.push(resendButton(false, message("settings.failedEmails.resend")));
        }
        break;
    }
  }
  return children.length === 0 ? "" : h.div([h.Class("flex flex-col items-start gap-1 text-sm")], children);
};

/** The failed sends of the Organization, for admins: what each was, who it was for, why it failed, when, and Resend. */
const failedEmailsView = <Message>(
  state: {
    readonly failedEmails: LoadedFailedEmails;
    readonly failedEmailResends: Readonly<Record<string, FailedEmailResend>>;
  },
  onResend: (sendId: SendId) => Message,
  h: HtmlBuilder<Message>,
): Html => {
  const { failedEmails } = state;
  const children: Array<Child> = [subSectionTitle(message("settings.failedEmails.title"), h, 2)];
  if (failedEmails._tag === "Failed") {
    children.push(problemView(failedEmails.failure, h)!);
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
                formatDate(new Date(email.failedAt), { dateStyle: "medium", timeStyle: "short" }),
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
    readonly defaultLanguageBusy: boolean;
    readonly defaultLanguageFailure?: Failure | undefined;
    readonly peopleBusy: boolean;
    readonly peopleFailure?: Failure | undefined;
    readonly pendingRemovePerson: { readonly personId: PersonId; readonly email: string } | undefined;
  },
  actions: {
    readonly onSizeChange: (size: string) => Message;
    readonly onToggleSize: Message;
    readonly onSubmitSize: Message;
    readonly onAiProcessingToggle: (isOn: boolean) => Message;
    readonly onDefaultLanguageChange: (value: string) => Message;
    readonly onGrantAdmin: (personId: PersonId) => Message;
    readonly onRevokeAdmin: (personId: PersonId) => Message;
    readonly onRemovePerson: (personId: PersonId) => Message;
    readonly onConfirmRemovePerson: Message;
    readonly onCancelRemovePerson: Message;
    readonly onResendFailedEmail: (sendId: SendId) => Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [pageTitle(message("settings.title"), h)];

  if (state.settings._tag === "Failed") {
    children.push(problemView(state.settings.failure, h)!);
    return h.section([], children);
  }

  if (state.settings._tag !== "Loaded") {
    return h.section([], children);
  }

  const { settings } = state.settings;

  // MinimumGroupSizeForm, opened from its button
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

  if (state.sizeOpen)
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
          h.p([h.Class("text-sm text-muted")], [message("settings.minimumGroupSize.help")]),
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

  // AiProcessing
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
  );

  // DefaultLanguage
  children.push(
    h.div(
      [h.Class(formPanelClass)],
      [
        subSectionTitle(message("settings.defaultLanguage"), h, 2),
        selectField(
          {
            id: "default-language",
            label: message("settings.defaultLanguage"),
            value: settings.defaultLocale,
            options: [
              ["en", message("language.en")],
              ["de", message("language.de")],
            ],
            isDisabled: state.defaultLanguageBusy,
            onChange: actions.onDefaultLanguageChange,
          },
          h,
        ),
        h.p([h.Class("text-sm text-muted")], [message("settings.defaultLanguage.help")]),
        problemView(state.defaultLanguageFailure, h),
      ].filter(Predicate.isNotNull),
    ),
  );

  // People
  children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("settings.people"), h, 2)]));
  children.push(
    dataTable(
      [message("settings.people.email"), message("settings.people.role"), message("settings.people.actions")],
      settings.people.map((person) => {
        const personId = decodePerson(person.personId);
        return [
          h.div(
            [h.Class("flex flex-wrap items-center gap-2")],
            [
              h.span([h.Class("min-w-0 break-all")], [person.email]),
              person.linked ? null : badge("neutral", [message("settings.notSignedInYet")], h),
            ].filter(Predicate.isNotNull),
          ),
          badge(
            person.organizationAdmin ? "primary" : "neutral",
            [message(person.organizationAdmin ? "settings.admin" : "settings.member")],
            h,
          ),
          h.details(
            [h.Class("relative")],
            [
              // A native disclosure keeps the row menu keyboard-accessible without app state.
              h.summary(
                [
                  h.Class(
                    "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-subtle",
                  ),
                ],
                [message("settings.people.actions"), h.span([h.AriaHidden(true)], [" \u203a"])],
              ),
              h.div(
                [
                  // Out of the row's flow: an open panel must not widen the table, which at a phone
                  // width is the difference between a 393 px layout and a sideways scroll.
                  h.Class(
                    "absolute right-0 z-20 mt-2 flex min-w-[12rem] flex-col items-start gap-2 rounded-panel border border-line bg-surface p-3 shadow-lg",
                  ),
                ],
                [
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
                ].filter(Predicate.isNotNull),
              ),
            ],
          ),
        ];
      }),
      h,
    ),
  );

  if (state.peopleFailure) {
    children.push(problemView(state.peopleFailure, h)!);
  }

  children.push(failedEmailsView(state, actions.onResendFailedEmail, h));

  return h.section([], children);
};
