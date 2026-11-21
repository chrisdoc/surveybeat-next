import * as Story from "foldkit/story";
import { afterEach, describe, expect, it } from "vitest";
import {
  AddMember,
  AssignLead,
  GetTeam,
  GetTeamOverviewCmd,
  initialModel,
  ListPulses,
  Message,
  RemoveMember,
  update,
  UpdateTeam,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import {
  decodeOrgId,
  decodeTeamId,
  decodePersonId,
  decodeTimeZone,
  decodeEmail,
  makeUrl,
} from "./appStoryFixtures.ts";

afterEach(() => {
  setLocale("en");
});

describe("App Stories", () => {
  describe("Team detail screen", () => {
    it("renames team, adds member, and assigns lead", () => {
      const teamId = decodeTeamId("team-1");
      const personId = decodePersonId("person-1");

      const detail = {
        team: {
          id: teamId,
          name: "Old Name",
          timeZone: decodeTimeZone("UTC"),
          yourRole: "lead" as const,
        },
        roster: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            role: "member" as const,
            since: 1_700_000_000_000,
          },
        ],
        may: {
          update: true,
          manageLeads: true,
          manageMembers: true,
          managePulses: true,
          viewResults: true,
        },
      };

      Story.story(
        update,
        Story.given(initialModel(makeUrl(`https://app.surveybeat.com/teams/${teamId}`), [])),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        Story.Command.resolve(
          GetTeamOverviewCmd,
          Message.GotTeamOverview({
            outcome: { _tag: "Failure", failure: "Forbidden" },
          }),
        ),
        Story.Command.resolve(
          ListPulses,
          Message.GotPulses({
            outcome: {
              _tag: "Success",
              pulses: { team: detail.team, pulses: [] },
            },
          }),
        ),
        Story.model((m) => {
          expect(m.teamDetail._tag).toBe("Loaded");
          expect(m.renameName).toBe("Old Name");
        }),
        // Rename team
        Story.message(Message.RenameNameChanged({ name: "New Name" })),
        Story.message(Message.SubmitRenameTeam()),
        Story.Command.expectHas(UpdateTeam),
        Story.Command.resolve(UpdateTeam, Message.UpdatedTeam({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: {
              _tag: "Success",
              detail: {
                ...detail,
                team: { ...detail.team, name: "New Name" },
              },
            },
          }),
        ),
        // Add member
        Story.message(Message.AddMemberEmailChanged({ email: "bob@acme.com" })),
        Story.message(Message.SubmitAddMember()),
        Story.Command.expectHas(AddMember),
        Story.Command.resolve(AddMember, Message.AddedMember({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        // Assign lead
        Story.message(Message.AssignLeadEmailChanged({ email: "carol@acme.com" })),
        Story.message(Message.SubmitAssignLead()),
        Story.Command.expectHas(AssignLead),
        Story.Command.resolve(AssignLead, Message.AssignedLead({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail },
          }),
        ),
        // Remove member: asking first, then confirming
        Story.message(Message.RemoveMemberClicked({ personId })),
        Story.message(Message.ConfirmRemove()),
        Story.Command.expectHas(RemoveMember),
        Story.Command.resolve(RemoveMember, Message.RemovedMember({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetTeam),
        Story.Command.resolve(
          GetTeam,
          Message.GotTeam({
            outcome: { _tag: "Success", detail: { ...detail, roster: [] } },
          }),
        ),
        Story.model((m) => {
          if (m.teamDetail._tag === "Loaded") {
            expect(m.teamDetail.detail.roster).toHaveLength(0);
          }
        }),
      );
    });
  });
});
