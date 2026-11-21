import * as Story from "foldkit/story";
import { afterEach, describe, expect, it } from "vitest";
import {
  AddPasskeyCmd,
  ChooseOrganization,
  CreateOrganization,
  CreateTeam,
  initialModel,
  ListActionsCmd,
  ListPasskeysCmd,
  ListPulses,
  ListTeams,
  LoadSession,
  Message,
  Navigate,
  update,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import { decodeOrgId, decodeTeamId, decodeTimeZone, makeUrl } from "./appStoryFixtures.ts";

afterEach(() => {
  setLocale("en");
});

describe("App Stories", () => {
  describe("Sign-in states", () => {
    it("handles initial session loading and signed out state", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"), [])),
        Story.model((m) => {
          expect(m.session._tag).toBe("Loading");
        }),
        Story.message(
          Message.GotSession({
            result: { _tag: "SignedOut" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedOut");

          if (m.session._tag === "SignedOut") {
            expect(m.session.failed).toBe(false);
          }
        }),
      );
    });

    it("handles signin failed query parameter", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/?signin=failed"), [])),
        Story.message(
          Message.GotSession({
            result: { _tag: "SignedOut" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedOut");

          if (m.session._tag === "SignedOut") {
            expect(m.session.failed).toBe(true);
          }
        }),
      );
    });

    it("handles retry session", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"), [])),
        Story.message(
          Message.GotSession({
            result: { _tag: "Failed" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("Failed");
        }),
        Story.message(Message.RetrySession()),
        Story.model((m) => {
          expect(m.session._tag).toBe("Loading");
        }),
        Story.Command.expectHas(LoadSession),
        Story.Command.resolve(
          LoadSession,
          Message.GotSession({
            result: { _tag: "NotInOrganization" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("NotInOrganization");
        }),
      );
    });

    it("handles create organization flow", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"), [])),
        Story.message(
          Message.GotSession({
            result: { _tag: "CreateOrganization" },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("CreateOrganization");
        }),
        Story.message(Message.CreateOrgNameChanged({ name: "Acme Corp" })),
        Story.model((m) => {
          if (m.session._tag === "CreateOrganization") {
            expect(m.session.name).toBe("Acme Corp");
          }
        }),
        Story.message(Message.SubmitCreateOrg()),
        Story.Command.expectHas(CreateOrganization),
        Story.Command.resolve(
          CreateOrganization,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: { id: decodeOrgId("org-1"), name: "Acme Corp" },
              organizationAdmin: true,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedIn");
        }),
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });

    it("handles choose organization flow", () => {
      const orgA = { id: decodeOrgId("org-a"), name: "Org Alpha" };
      const orgB = { id: decodeOrgId("org-b"), name: "Org Beta" };

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"), [])),
        Story.message(
          Message.GotSession({
            result: {
              _tag: "ChooseOrganization",
              organizations: [orgA, orgB],
            },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("ChooseOrganization");
        }),
        Story.message(Message.ChooseOrgClicked({ organizationId: orgB.id })),
        Story.Command.expectHas(ChooseOrganization),
        Story.Command.resolve(
          ChooseOrganization,
          Message.GotSession({
            result: {
              _tag: "SignedIn",
              organization: orgB,
              organizationAdmin: false,
              locale: null,
              detectedLocale: null,
              organizationLocale: "en",
            },
          }),
        ),
        Story.model((m) => {
          expect(m.session._tag).toBe("SignedIn");
        }),
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });
  });

  describe("Teams screen", () => {
    it("loads teams list and creates a team", () => {
      const teamId = decodeTeamId("team-1");

      const teamSummary = {
        id: teamId,
        name: "Engineering",
        timeZone: decodeTimeZone("Europe/Berlin"),
        yourRole: "lead" as const,
      };

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/"), [])),
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
        Story.Command.expectHas(ListTeams),
        Story.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [teamSummary] },
          }),
        ),
        Story.Command.resolve(
          ListPulses,
          Message.GotPulses({
            outcome: {
              _tag: "Success",
              pulses: { team: teamSummary, pulses: [] },
            },
          }),
        ),
        Story.Command.resolve(
          ListActionsCmd,
          Message.GotActions({
            outcome: { _tag: "Success", list: { teamId, actions: [] } },
          }),
        ),
        Story.model((m) => {
          expect(m.teams._tag).toBe("Loaded");

          if (m.teams._tag === "Loaded") {
            expect(m.teams.teams).toHaveLength(1);
            expect(m.teams.teams[0]?.name).toBe("Engineering");
          }
        }),
        Story.message(Message.CreateTeamNameChanged({ name: "Design" })),
        Story.message(Message.CreateTeamTimeZoneChanged({ tz: "UTC" })),
        Story.message(Message.CreateTeamLeadEmailChanged({ email: "lead@acme.com" })),
        Story.message(Message.SubmitCreateTeam()),
        Story.Command.expectHas(CreateTeam),
        Story.Command.resolve(
          CreateTeam,
          Message.CreatedTeam({
            outcome: {
              _tag: "Success",
              detail: {
                team: {
                  id: decodeTeamId("team-2"),
                  name: "Design",
                  timeZone: decodeTimeZone("UTC"),
                  yourRole: "lead",
                },
                roster: [],
                may: {
                  update: true,
                  manageLeads: true,
                  manageMembers: true,
                  managePulses: true,
                  viewResults: true,
                },
              },
            },
          }),
        ),
        Story.model((m) => {
          expect(m.createTeamBusy).toBe(false);
        }),
        Story.Command.expectHas(Navigate),
        Story.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });

  describe("Passkey state transitions", () => {
    it("updates capabilities and maps add passkey outcomes cleanly", () => {
      const signedInPrivacy = {
        ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
        session: {
          _tag: "SignedIn" as const,
          organization: { id: decodeOrgId("org-1"), name: "Acme" },
          organizationAdmin: true,
          locale: null,
          detectedLocale: null,
          organizationLocale: "en" as const,
        },
      };

      Story.story(
        update,
        Story.given(signedInPrivacy),
        Story.message(
          Message.GotPasskeyCapabilities({
            capabilities: {
              supported: true,
              conditionalGet: true,
              platformAuthenticator: true,
            },
          }),
        ),
        Story.model((m) => {
          expect(m.passkeyCapabilities.supported).toBe(true);
        }),
        Story.message(Message.AddPasskeyClicked()),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(true);
        }),
        Story.Command.resolve(
          AddPasskeyCmd,
          Message.AddedPasskey({
            cancelled: true,
            outcome: { _tag: "Failure", failure: "Unavailable" },
          }),
        ),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(false);
          expect(m.passkeys.notice).toBeNull();
          expect(m.passkeys.failure).toMatchObject({ _tag: "None" });
        }),
        Story.message(Message.AddPasskeyClicked()),
        Story.Command.resolve(
          AddPasskeyCmd,
          Message.AddedPasskey({
            cancelled: false,
            outcome: { _tag: "Failure", failure: "PasskeyAlreadyExists" },
          }),
        ),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(false);
          expect(m.passkeys.failure).toMatchObject({ _tag: "Some", value: "PasskeyAlreadyExists" });
        }),
        Story.message(Message.AddPasskeyClicked()),
        Story.Command.resolve(
          AddPasskeyCmd,
          Message.AddedPasskey({
            cancelled: false,
            outcome: { _tag: "Failure", failure: "PasskeySignInAgainRequired" },
          }),
        ),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(false);
          expect(m.passkeys.failure).toMatchObject({ _tag: "Some", value: "PasskeySignInAgainRequired" });
        }),
        Story.message(Message.AddPasskeyClicked()),
        Story.Command.resolve(
          AddPasskeyCmd,
          Message.AddedPasskey({
            cancelled: false,
            outcome: { _tag: "Failure", failure: "Unauthenticated" },
          }),
        ),
        Story.Command.expectHas(LoadSession),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(false);
          expect(m.passkeys.failure).toMatchObject({ _tag: "Some", value: "Unauthenticated" });
        }),
        Story.Command.resolve(
          LoadSession,
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
        Story.Command.expectHas(ListPasskeysCmd),
        Story.Command.resolve(
          ListPasskeysCmd,
          Message.GotPasskeys({ outcome: { _tag: "Success", passkeys: [] } }),
        ),
        Story.message(Message.AddPasskeyClicked()),
        Story.Command.resolve(
          AddPasskeyCmd,
          Message.AddedPasskey({
            cancelled: false,
            outcome: { _tag: "Success" },
          }),
        ),
        Story.Command.expectHas(ListPasskeysCmd),
        Story.model((m) => {
          expect(m.passkeys.busy).toBe(false);
          expect(m.passkeys.failure).toMatchObject({ _tag: "None" });
          expect(m.passkeys.notice).toBe("Passkey added.");
        }),
        Story.Command.resolve(
          ListPasskeysCmd,
          Message.GotPasskeys({ outcome: { _tag: "Success", passkeys: [] } }),
        ),
      );
    });
  });
});
