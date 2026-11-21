import { Option } from "effect";
import type { Update } from "foldkit";
import type { Model, Message } from "./appModel.ts";
import {
  LoadSession,
  CreateTeam,
  GetTeam,
  UpdateTeam,
  AddMember,
  AssignLead,
  RemoveMember,
  RemoveLead,
  RemovePerson,
  ListPulses,
  ListRoundsCmd,
  Navigate,
} from "./appCommands.ts";
import { decodeEmail, decodeName, decodeZone } from "./directory.ts";
import { teamHref } from "./routes.ts";

type TeamsMessage = Extract<
  Message,
  {
    _tag:
      | "GotTeams"
      | "CreateTeamNameChanged"
      | "CreateTeamTimeZoneChanged"
      | "CreateTeamLeadEmailChanged"
      | "SubmitCreateTeam"
      | "CreatedTeam"
      | "GotTeam"
      | "RenameNameChanged"
      | "RenameTimeZoneChanged"
      | "SubmitRenameTeam"
      | "UpdatedTeam"
      | "AddMemberEmailChanged"
      | "SubmitAddMember"
      | "AddedMember"
      | "AssignLeadEmailChanged"
      | "SubmitAssignLead"
      | "AssignedLead"
      | "RemoveMemberClicked"
      | "RemovedMember"
      | "RemoveLeadClicked"
      | "ConfirmRemove"
      | "DismissRemove"
      | "RemovedLead";
  }
>;

export const updateTeams = (model: Model, message: TeamsMessage): Update.Return<Model, Message> => {
  switch (message._tag) {
    case "GotTeams": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            teams: { _tag: "Loaded", teams: outcome.teams },
          },
          commands:
            model.route._tag === "Teams"
              ? outcome.teams
                  .filter((team) => team.yourRole === "lead")
                  .map((team) => ListPulses({ teamId: team.id }))
              : [],
        };
      }

      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          teams: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "CreateTeamNameChanged": {
      return { model: { ...model, createTeamName: message.name } };
    }

    case "CreateTeamTimeZoneChanged": {
      return { model: { ...model, createTeamTimeZone: message.tz } };
    }

    case "CreateTeamLeadEmailChanged": {
      return { model: { ...model, createTeamLeadEmail: message.email } };
    }

    case "SubmitCreateTeam": {
      const n = decodeName(model.createTeamName.trim());
      const z = decodeZone(model.createTeamTimeZone.trim());
      const e = decodeEmail(model.createTeamLeadEmail.trim());

      if (Option.isNone(n) || Option.isNone(z) || Option.isNone(e)) {
        return {
          model: { ...model, createTeamFailure: Option.some("Invalid") },
        };
      }

      return {
        model: { ...model, createTeamBusy: true, createTeamFailure: Option.none() },
        commands: [CreateTeam({ name: n.value, timeZone: z.value, leadEmail: e.value })],
      };
    }

    case "CreatedTeam": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        const nextUrl = teamHref(outcome.detail.team.id);

        return {
          model: { ...model, createTeamBusy: false },
          commands: [Navigate({ url: nextUrl })],
        };
      }

      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          createTeamBusy: false,
          createTeamFailure: Option.some(outcome.failure),
        },
      };
    }

    case "GotTeam": {
      const { outcome } = message;

      if (outcome._tag === "Success") {
        return {
          model: {
            ...model,
            teamDetail: { _tag: "Loaded", detail: outcome.detail },
            renameName: outcome.detail.team.name,
            renameTimeZone: outcome.detail.team.timeZone,
          },
          commands:
            model.route._tag === "Rounds"
              ? [ListRoundsCmd({ teamId: model.route.teamId, pulseId: model.route.pulseId })]
              : [],
        };
      }

      if (outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          teamDetail: { _tag: "Failed", failure: outcome.failure },
        },
      };
    }

    case "RenameNameChanged": {
      return { model: { ...model, renameName: message.name } };
    }

    case "RenameTimeZoneChanged": {
      return { model: { ...model, renameTimeZone: message.tz } };
    }

    case "SubmitRenameTeam": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;
      const n = decodeName(model.renameName.trim());
      const z = decodeZone(model.renameTimeZone.trim());

      if (Option.isNone(n) || Option.isNone(z)) {
        return { model: { ...model, renameFailure: Option.some("Invalid") } };
      }

      return {
        model: { ...model, renameBusy: true, renameFailure: Option.none() },
        commands: [UpdateTeam({ teamId, name: n.value, timeZone: z.value })],
      };
    }

    case "UpdatedTeam": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;

      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, renameBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          renameBusy: false,
          renameFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "AddMemberEmailChanged": {
      return { model: { ...model, addMemberEmail: message.email, addMemberAdded: false } };
    }

    case "SubmitAddMember": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;
      const e = decodeEmail(model.addMemberEmail.trim());

      if (Option.isNone(e)) {
        return { model: { ...model, addMemberFailure: Option.some("Invalid") } };
      }

      return {
        model: { ...model, addMemberBusy: true, addMemberFailure: Option.none() },
        commands: [AddMember({ teamId, email: e.value })],
      };
    }

    case "AddedMember": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;

      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            addMemberBusy: false,
            addMemberAdded: true,
            addMemberEmail: "",
          },
          commands: [GetTeam({ teamId })],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          addMemberBusy: false,
          addMemberFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "AssignLeadEmailChanged": {
      return { model: { ...model, assignLeadEmail: message.email, assignLeadAdded: false } };
    }

    case "SubmitAssignLead": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;
      const e = decodeEmail(model.assignLeadEmail.trim());

      if (Option.isNone(e)) {
        return { model: { ...model, assignLeadFailure: Option.some("Invalid") } };
      }

      return {
        model: { ...model, assignLeadBusy: true, assignLeadFailure: Option.none() },
        commands: [AssignLead({ teamId, email: e.value })],
      };
    }

    case "AssignedLead": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;

      if (message.outcome._tag === "Success") {
        return {
          model: {
            ...model,
            assignLeadBusy: false,
            assignLeadAdded: true,
            assignLeadEmail: "",
          },
          commands: [GetTeam({ teamId })],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          assignLeadBusy: false,
          assignLeadFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RemoveMemberClicked": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const entry = model.teamDetail.detail.roster.find((row) => row.personId === message.personId);

      return {
        model: {
          ...model,
          rosterFailure: Option.none(),
          pendingRemove: Option.some({
            kind: "member",
            personId: message.personId,
            email: entry?.email ?? "",
          }),
        },
      };
    }

    case "RemovedMember": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;

      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, rosterBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          rosterBusy: false,
          rosterFailure: Option.some(message.outcome.failure),
        },
      };
    }

    case "RemoveLeadClicked": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const entry = model.teamDetail.detail.roster.find((row) => row.personId === message.personId);

      return {
        model: {
          ...model,
          rosterFailure: Option.none(),
          pendingRemove: Option.some({
            kind: "lead",
            personId: message.personId,
            email: entry?.email ?? "",
          }),
        },
      };
    }

    case "ConfirmRemove": {
      if (Option.isSome(model.pendingRemovePerson)) {
        const personId = model.pendingRemovePerson.value.personId;

        return {
          model: {
            ...model,
            pendingRemovePerson: Option.none(),
            peopleBusy: true,
            peopleFailure: Option.none(),
          },
          commands: [RemovePerson({ personId })],
        };
      }

      if (Option.isNone(model.pendingRemove)) {
        return { model };
      }

      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const pending = model.pendingRemove.value;
      const teamId = model.teamDetail.detail.team.id;

      return {
        model: { ...model, pendingRemove: Option.none(), rosterBusy: true, rosterFailure: Option.none() },
        commands: [
          pending.kind === "lead"
            ? RemoveLead({ teamId, personId: pending.personId })
            : RemoveMember({ teamId, personId: pending.personId }),
        ],
      };
    }

    case "DismissRemove": {
      return { model: { ...model, pendingRemove: Option.none(), pendingRemovePerson: Option.none() } };
    }

    case "RemovedLead": {
      if (model.teamDetail._tag !== "Loaded") {
        return { model };
      }

      const teamId = model.teamDetail.detail.team.id;

      if (message.outcome._tag === "Success") {
        return {
          model: { ...model, rosterBusy: false },
          commands: [GetTeam({ teamId })],
        };
      }

      if (message.outcome.failure === "Unauthenticated") {
        return { model, commands: [LoadSession()] };
      }

      return {
        model: {
          ...model,
          rosterBusy: false,
          rosterFailure: Option.some(message.outcome.failure),
        },
      };
    }
  }
};
