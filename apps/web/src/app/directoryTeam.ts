import * as DateTime from "effect/DateTime";
import type { PersonId } from "@surveybeat/domain";
import { Predicate } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { formatDate, formatRoundDate, message, pluralMessage } from "../messages/locale.ts";
import type { Failure } from "./api.ts";
import {
  appButton,
  badge,
  confirmDialog,
  dangerLinkButton,
  emailAddress,
  emptyState,
  linkClass,
  pageTitle,
  problemView,
  rowActionsMenu,
  secondaryButtonClass,
  selectField,
  timeZoneOptions,
  subSectionTitle,
  textField,
} from "./components.ts";
import type { Child } from "./components.ts";
import { historyHref, pulsesHref, teamHref, teamsHref } from "./routes.ts";
import { formPanelClass, roleName } from "./directoryModel.ts";
import type { AttentionItem, ChecklistStep, LoadedTeam, LoadedTeams } from "./directoryModel.ts";

const attentionView = <Message>(items: readonly AttentionItem[], h: HtmlBuilder<Message>): Html =>
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
    readonly attention: readonly AttentionItem[];
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
  const children: Child[] = [
    pageTitle(message("home.attention.title"), h),
    attentionView(state.attention, h),
  ];

  if (state.teams._tag === "Loaded" && state.teams.teams.length > 0) {
    children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("home.teams.title"), h, 2)]));
  }

  if (state.teams._tag === "Failed") {
    children.push(problemView(state.teams.failure, h));
  } else if (state.teams._tag === "Loaded") {
    if (state.teams.teams.length === 0) {
      children.push(emptyState({ title: message("teams.empty.title"), body: message("teams.empty") }, h));
    } else {
      children.push(
        h.ul(
          [h.Class("mt-6 flex flex-col gap-3")],
          state.teams.teams.map((team) =>
            h.keyed("li")(
              team.id,
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

const firstRunChecklistView = <Message>(steps: readonly ChecklistStep[], h: HtmlBuilder<Message>): Html =>
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
    readonly checklist: readonly ChecklistStep[] | null;
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
  const children: Child[] = [h.a([h.Href(teamsHref()), h.Class(linkClass)], [message("team.back")])];

  if (state.team._tag === "Failed") {
    children.push(problemView(state.team.failure, h));

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

  children.push(
    h.div([h.Class("mt-8")], [subSectionTitle(message("team.roster"), h, 2)]),
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
              [h.Class("flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 sm:basis-auto")],
              [
                emailAddress({ email: entry.email, className: "font-medium" }, h),
                badge("neutral", [roleName(entry.role)], h),
                h.span(
                  [h.Class("text-sm text-muted")],
                  [message("team.since", { date: formatDate(DateTime.makeUnsafe(entry.since)) })],
                ),
              ],
            ),
            mayRemove
              ? rowActionsMenu(
                  {
                    label: message("team.roster.actions"),
                    items: [
                      state.pendingRemove?.personId !== entry.personId
                        ? appButton(
                            {
                              text: message(isLead ? "team.removeLead" : "team.removeMember"),
                              isDisabled: state.rosterBusy,
                              className: dangerLinkButton,
                              onClick: isLead
                                ? actions.onRemoveLead(entry.personId)
                                : actions.onRemoveMember(entry.personId),
                            },
                            h,
                          )
                        : null,
                      state.pendingRemove?.personId === entry.personId
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
                    ],
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
    children.push(problemView(state.rosterFailure, h));
  }

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
