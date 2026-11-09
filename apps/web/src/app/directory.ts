import {
  EmailAddress,
  MinimumGroupSize,
  OrganizationSettings,
  PersonId,
  TeamDetail,
  TeamName,
  TeamSummary,
  TimeZone,
} from "@surveybeat/domain";
import { Option, Predicate, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatDate, message } from "../messages/index.ts";
import { Failure } from "./api.ts";
import {
  type Child,
  appButton,
  badge,
  emptyState,
  linkButton,
  linkClass,
  navLink,
  pageShell,
  pageTitle,
  problemView,
  signOutView,
  subSectionTitle,
  textField,
} from "./components.ts";
import { privacyHref, pulsesHref, settingsHref, teamHref, teamsHref } from "./routes.ts";

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

const formPanelClass = "mt-8 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:p-8";

export const roleName = (role: TeamSummary["yourRole"]): string =>
  role === null ? "" : message(`role.${role}`);

export const decodeName = Schema.decodeUnknownOption(TeamName);
export const decodeZone = Schema.decodeUnknownOption(TimeZone);
export const decodeEmail = Schema.decodeUnknownOption(EmailAddress);
export const decodeSize = Schema.decodeUnknownOption(MinimumGroupSize);
export const decodePerson = Schema.decodeUnknownOption(PersonId);

export const shellView = <Message>(
  title: string,
  organizationAdmin: boolean,
  children: ReadonlyArray<Child>,
  h: HtmlBuilder<Message>,
  wide = false,
): Html =>
  pageShell(
    {
      organizationName: title,
      wide,
      nav: [
        navLink(teamsHref(), message("nav.teams"), h),
        organizationAdmin ? navLink(settingsHref(), message("nav.settings"), h) : null,
        navLink(privacyHref(), message("nav.privacy"), h),
      ].filter(Predicate.isNotNull),
    },
    [...children, signOutView(h)],
    h,
  );

export const teamsScreenView = <Message>(
  state: {
    readonly teams: LoadedTeams;
    readonly organizationAdmin: boolean;
    readonly createName: string;
    readonly createTimeZone: string;
    readonly createLeadEmail: string;
    readonly createBusy: boolean;
    readonly createFailure?: Failure | undefined;
  },
  actions: {
    readonly onNameChange: (name: string) => Message;
    readonly onTimeZoneChange: (tz: string) => Message;
    readonly onLeadEmailChange: (email: string) => Message;
    readonly onSubmitCreate: Message;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Child> = [pageTitle(message("teams.title"), h)];

  if (state.teams._tag === "Failed") {
    children.push(problemView(state.teams.failure, h)!);
  } else if (state.teams._tag === "Loaded") {
    if (state.teams.teams.length === 0) {
      children.push(emptyState(message("teams.empty"), h));
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
                      "flex min-h-11 items-center justify-between gap-4 rounded-panel border border-line bg-surface px-6 py-4 text-lg font-semibold hover:border-primary",
                    ),
                  ],
                  [
                    h.span([], [team.name]),
                    team.yourRole !== null
                      ? badge("neutral", [message("teams.yourRole", { role: roleName(team.yourRole) })], h)
                      : null,
                  ].filter(Predicate.isNotNull),
                ),
              ],
            ),
          ),
        ),
      );
    }
  }

  if (state.organizationAdmin) {
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
          textField(
            {
              id: "create-team-tz",
              label: message("teams.create.timeZone"),
              value: state.createTimeZone,
              isDisabled: state.createBusy,
              onInput: actions.onTimeZoneChange,
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
          appButton(
            {
              text: message("teams.create.action"),
              type: "submit",
              isDisabled: state.createBusy,
            },
            h,
          ),
        ].filter(Predicate.isNotNull),
      ),
    );
  }

  return h.section([], children);
};

export const teamScreenView = <Message>(
  state: {
    readonly team: LoadedTeam;
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
  },
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

  if (detail.may.update) {
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
          textField(
            {
              id: "rename-team-tz",
              label: message("teams.create.timeZone"),
              value: state.renameTimeZone,
              isDisabled: state.renameBusy,
              onInput: actions.onRenameTimeZoneChange,
            },
            h,
          ),
          problemView(state.renameFailure, h),
          appButton(
            {
              text: message("team.rename.action"),
              type: "submit",
              isDisabled: state.renameBusy,
            },
            h,
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
          [h.Class("flex items-center justify-between gap-4 border-b border-line-soft py-3 last:border-b-0")],
          [
            h.span(
              [h.Class("flex flex-wrap items-center gap-x-3 gap-y-1")],
              [
                h.span([h.Class("font-medium")], [entry.email]),
                badge("neutral", [roleName(entry.role)], h),
                h.span(
                  [h.Class("text-sm text-muted")],
                  [message("team.since", { date: formatDate(new Date(entry.since)) })],
                ),
              ],
            ),
            mayRemove
              ? appButton(
                  {
                    text: message(isLead ? "team.removeLead" : "team.removeMember"),
                    isDisabled: state.rosterBusy,
                    className: linkButton,
                    onClick: isLead
                      ? actions.onRemoveLead(entry.personId)
                      : actions.onRemoveMember(entry.personId),
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
  if (detail.may.manageMembers) {
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
          appButton(
            {
              text: message("team.addMember.action"),
              type: "submit",
              isDisabled: state.addMemberBusy,
            },
            h,
          ),
        ].filter(Predicate.isNotNull),
      ),
    );
  }

  // Assign Lead
  if (detail.may.manageLeads) {
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
          appButton(
            {
              text: message("team.assignLead.action"),
              type: "submit",
              isDisabled: state.assignLeadBusy,
            },
            h,
          ),
        ].filter(Predicate.isNotNull),
      ),
    );
  }

  return h.section([], children);
};

export const settingsScreenView = <Message>(
  state: {
    readonly settings: LoadedSettings;
    readonly size: string;
    readonly sizeSaved: boolean;
    readonly sizeBusy: boolean;
    readonly sizeFailure?: Failure | undefined;
    readonly peopleBusy: boolean;
    readonly peopleFailure?: Failure | undefined;
  },
  actions: {
    readonly onSizeChange: (size: string) => Message;
    readonly onSubmitSize: Message;
    readonly onGrantAdmin: (personId: PersonId) => Message;
    readonly onRevokeAdmin: (personId: PersonId) => Message;
    readonly onRemovePerson: (personId: PersonId) => Message;
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

  // MinimumGroupSizeForm
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
          ? h.p([h.Role("status"), h.Class("text-sm font-medium text-primary")], [message("settings.saved")])
          : null,
        appButton(
          {
            text: message("settings.save"),
            type: "submit",
            isDisabled: state.sizeBusy,
          },
          h,
        ),
      ].filter(Predicate.isNotNull),
    ),
  );

  // People
  children.push(h.div([h.Class("mt-8")], [subSectionTitle(message("settings.people"), h, 2)]));
  children.push(
    h.ul(
      [h.Class("mt-3 rounded-panel border border-line bg-surface px-6")],
      settings.people.map((person) => {
        const personId = decodePerson(person.personId);
        return h.li(
          [h.Class("border-b border-line-soft py-3 last:border-b-0")],
          [
            h.p(
              [h.Class("flex flex-wrap items-center gap-2 font-medium")],
              [
                person.email,
                person.organizationAdmin ? badge("primary", [message("settings.admin")], h) : null,
                person.linked ? null : badge("neutral", [message("settings.notSignedInYet")], h),
              ].filter(Predicate.isNotNull),
            ),
            h.div(
              [h.Class("flex gap-4")],
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
                Option.isSome(personId)
                  ? appButton(
                      {
                        text: message("settings.removePerson"),
                        isDisabled: state.peopleBusy,
                        className: linkButton,
                        onClick: actions.onRemovePerson(person.personId),
                      },
                      h,
                    )
                  : null,
              ].filter(Predicate.isNotNull),
            ),
          ],
        );
      }),
    ),
  );

  if (state.peopleFailure) {
    children.push(problemView(state.peopleFailure, h)!);
  }

  return h.section([], children);
};
