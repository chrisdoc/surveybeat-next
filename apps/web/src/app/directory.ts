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
import { type Child, appButton, problemView, screenView, signOutView, textField } from "./components.ts";
import { pulsesHref, settingsHref, teamHref, teamsHref } from "./routes.ts";

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
): Html =>
  screenView(
    title,
    [
      h.nav(
        [h.Class("mt-4 flex gap-4")],
        [
          h.a([h.Href(teamsHref()), h.Class("underline")], [message("nav.teams")]),
          organizationAdmin
            ? h.a([h.Href(settingsHref()), h.Class("underline")], [message("nav.settings")])
            : null,
        ].filter(Predicate.isNotNull),
      ),
      ...children,
      signOutView(h),
    ],
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
  const children: Array<Child> = [h.h2([h.Class("text-xl font-semibold")], [message("teams.title")])];

  if (state.teams._tag === "Failed") {
    children.push(problemView(state.teams.failure, h)!);
  } else if (state.teams._tag === "Loaded") {
    if (state.teams.teams.length === 0) {
      children.push(h.p([h.Class("mt-2 text-gray-600")], [message("teams.empty")]));
    } else {
      children.push(
        h.ul(
          [h.Class("mt-3 flex flex-col gap-2")],
          state.teams.teams.map((team) =>
            h.li(
              [],
              [
                h.a(
                  [h.Href(teamHref(team.id)), h.Class("flex justify-between rounded border px-3 py-2")],
                  [
                    h.span([], [team.name]),
                    team.yourRole !== null
                      ? h.span(
                          [h.Class("text-sm text-gray-600")],
                          [message("teams.yourRole", { role: roleName(team.yourRole) })],
                        )
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
        [h.Class("mt-6 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitCreate)],
        [
          h.h2([h.Class("text-xl font-semibold")], [message("teams.create.title")]),
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

  return h.section([h.Class("mt-6")], children);
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
  const children: Array<Child> = [
    h.a([h.Href(teamsHref()), h.Class("text-sm underline")], [message("team.back")]),
  ];

  if (state.team._tag === "Failed") {
    children.push(problemView(state.team.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }

  if (state.team._tag !== "Loaded") {
    return h.section([h.Class("mt-6")], children);
  }

  const { detail } = state.team;
  children.push(h.h2([h.Class("mt-2 text-xl font-semibold")], [detail.team.name]));
  children.push(
    h.p([h.Class("text-sm text-gray-600")], [message("team.timeZone", { timeZone: detail.team.timeZone })]),
  );

  if (detail.team.yourRole === null) {
    children.push(h.p([h.Class("mt-2 text-sm text-gray-600")], [message("team.noResultsAccess")]));
  }

  if (detail.may.managePulses) {
    children.push(
      h.a(
        [h.Href(pulsesHref(detail.team.id)), h.Class("mt-4 inline-block underline")],
        [message("team.pulses")],
      ),
    );
  }

  if (detail.may.update) {
    children.push(
      h.form(
        [h.Class("mt-4 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitRename)],
        [
          h.h3([h.Class("text-lg font-medium")], [message("team.rename.title")]),
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
  children.push(h.h3([h.Class("mt-6 text-lg font-medium")], [message("team.roster")]));
  children.push(
    h.ul(
      [h.Class("mt-2 flex flex-col gap-2")],
      detail.roster.map((entry) => {
        const isLead = entry.role === "lead";
        const mayRemove = isLead ? detail.may.manageLeads : detail.may.manageMembers;
        return h.li(
          [h.Class("flex items-center justify-between rounded border px-3 py-2")],
          [
            h.span(
              [],
              [
                entry.email,
                h.span([h.Class("text-sm text-gray-600")], [roleName(entry.role)]),
                h.span(
                  [h.Class("text-sm text-gray-600")],
                  [message("team.since", { date: formatDate(new Date(entry.since)) })],
                ),
              ],
            ),
            mayRemove
              ? appButton(
                  {
                    text: message(isLead ? "team.removeLead" : "team.removeMember"),
                    isDisabled: state.rosterBusy,
                    className: "text-sm underline",
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
        [h.Class("mt-4 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitAddMember)],
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
          state.addMemberAdded ? h.p([h.Role("status")], [message("team.added")]) : null,
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
        [h.Class("mt-4 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitAssignLead)],
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
          state.assignLeadAdded ? h.p([h.Role("status")], [message("team.added")]) : null,
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

  return h.section([h.Class("mt-6")], children);
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
  const children: Array<Child> = [h.h2([h.Class("text-xl font-semibold")], [message("settings.title")])];

  if (state.settings._tag === "Failed") {
    children.push(problemView(state.settings.failure, h)!);
    return h.section([h.Class("mt-6")], children);
  }

  if (state.settings._tag !== "Loaded") {
    return h.section([h.Class("mt-6")], children);
  }

  const { settings } = state.settings;

  // MinimumGroupSizeForm
  children.push(
    h.form(
      [h.Class("mt-4 flex flex-col gap-3"), h.OnSubmit(actions.onSubmitSize)],
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
        h.p([h.Class("text-sm text-gray-600")], [message("settings.minimumGroupSize.help")]),
        problemView(state.sizeFailure, h),
        state.sizeSaved ? h.p([h.Role("status")], [message("settings.saved")]) : null,
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
  children.push(h.h3([h.Class("mt-6 text-lg font-medium")], [message("settings.people")]));
  children.push(
    h.ul(
      [h.Class("mt-2 flex flex-col gap-2")],
      settings.people.map((person) => {
        const personId = decodePerson(person.personId);
        return h.li(
          [h.Class("rounded border px-3 py-2")],
          [
            h.p(
              [],
              [
                person.email,
                person.organizationAdmin
                  ? h.span([h.Class("ml-2 text-sm text-gray-600")], [message("settings.admin")])
                  : null,
                person.linked
                  ? null
                  : h.span([h.Class("ml-2 text-sm text-gray-600")], [message("settings.notSignedInYet")]),
              ].filter(Predicate.isNotNull),
            ),
            h.div(
              [h.Class("mt-1 flex gap-4 text-sm")],
              [
                appButton(
                  {
                    text: message(person.organizationAdmin ? "settings.revokeAdmin" : "settings.makeAdmin"),
                    isDisabled: state.peopleBusy,
                    className: "underline",
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
                        className: "underline",
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

  return h.section([h.Class("mt-6")], children);
};
