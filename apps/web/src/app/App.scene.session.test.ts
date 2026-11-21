import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, it } from "vitest";
import {
  ChooseOrganization,
  CreateOrganization,
  CreateTeam,
  initialModel,
  LeaveAfterErasureCmd,
  ListTeams,
  LoadSession,
  Message,
  Navigate,
  OffboardOrganization,
  SignInWithPasskey,
  update,
  view,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import {
  instant,
  decodeOrgId,
  decodeTeamId,
  decodePulseId,
  decodePersonId,
  decodeTimeZone,
  decodeEmail,
  decodeSendTime,
  decodeRoundId,
  decodeActionId,
  makeUrl,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
  describe("Sign-in states", () => {
    it("renders signed out screen with the email-code form", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: {
            _tag: "SignedOut",
            failed: false,
            stage: "email",
            email: "",
            code: "",
            busy: false,
            notice: null,
          },
        }),
        Scene.expect(Scene.role("heading", { name: "Sign in to SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("textbox", { name: "Your email" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Email me a code" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Sign in with a passkey" })).toBeAbsent(),
      );
    });

    it("shows the passkey sign-in option when supported and signs in cleanly", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          passkeyCapabilities: {
            supported: true,
            conditionalGet: true,
            platformAuthenticator: true,
          },
          session: {
            _tag: "SignedOut",
            failed: false,
            stage: "email",
            email: "",
            code: "",
            busy: false,
            notice: null,
          },
        }),
        Scene.expect(Scene.role("textbox", { name: "Your email" })).toHaveAttr(
          "autocomplete",
          "email webauthn",
        ),
        Scene.click(Scene.role("button", { name: "Sign in with a passkey" })),
        Scene.Command.expectHas(SignInWithPasskey),
        Scene.Command.resolve(SignInWithPasskey, Message.PasskeySignedIn({ verified: false })),
        Scene.expect(Scene.text("Passkey sign-in did not work. Try again or use an email code.")).toExist(),
        Scene.click(Scene.role("button", { name: "Sign in with a passkey" })),
        Scene.Command.resolve(SignInWithPasskey, Message.PasskeySignedIn({ verified: true })),
        Scene.Command.expectHas(LoadSession),
        Scene.Command.resolve(LoadSession, Message.GotSession({ result: { _tag: "SignedOut" } })),
      );
    });

    it("asks for the code once the email is submitted", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: {
            _tag: "SignedOut",
            failed: false,
            stage: "code",
            email: "ada@example.com",
            code: "",
            busy: false,
            notice: "We sent a 6-digit code to ada@example.com. It expires in 10 minutes.",
          },
        }),
        Scene.expect(Scene.role("textbox", { name: "Sign-in code" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Sign in with this code" })).toExist(),
      );
    });

    it("renders failed sign-in notice when query param is present", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/?signin=failed"), []),
          session: {
            _tag: "SignedOut",
            failed: true,
            stage: "email",
            email: "",
            code: "",
            busy: false,
            notice: null,
          },
        }),
        Scene.expect(Scene.text("Signing in did not work. Please try again.")).toExist(),
      );
    });

    it("renders create organization screen and submits form", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: { _tag: "CreateOrganization", name: "", busy: false },
        }),
        Scene.expect(Scene.role("heading", { name: "Create an Organization" })).toExist(),
        Scene.type(Scene.label("Organization name"), "Acme Corp"),
        Scene.click(Scene.role("button", { name: "Create Organization" })),
        Scene.Command.expectHas(CreateOrganization),
        Scene.Command.resolve(
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
        Scene.Command.expectHas(ListTeams),
        Scene.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
        Scene.expect(Scene.role("heading", { name: "What needs my attention" })).toExist(),
      );
    });

    it("renders not in organization screen", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Scene.expect(Scene.role("heading", { name: "You're not part of an Organization yet" })).toExist(),
      );
    });

    it("finishes a deletion that was already confirmed from outside an Organization", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Scene.click(Scene.role("button", { name: "Finish that deletion" })),
        Scene.Command.expectHas(OffboardOrganization({ confirmation: "" })),
        Scene.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({ outcome: { _tag: "Success" } }),
        ),
        Scene.Command.expectHas(LeaveAfterErasureCmd),
        Scene.Command.resolve(LeaveAfterErasureCmd, Message.LeftAfterErasure()),
      );
    });

    it("renders choose organization screen and picks an organization", () => {
      const orgA = { id: decodeOrgId("org-a"), name: "Org Alpha" };
      const orgB = { id: decodeOrgId("org-b"), name: "Org Beta" };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: {
            _tag: "ChooseOrganization",
            organizations: [orgA, orgB],
            busy: false,
          },
        }),
        Scene.expect(Scene.role("heading", { name: "Choose an Organization" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Org Alpha" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Org Beta" })).toExist(),
        Scene.click(Scene.role("button", { name: "Org Beta" })),
        Scene.Command.expectHas(ChooseOrganization),
        Scene.Command.resolve(
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
        Scene.Command.expectHas(ListTeams),
        Scene.Command.resolve(
          ListTeams,
          Message.GotTeams({
            outcome: { _tag: "Success", teams: [] },
          }),
        ),
      );
    });
  });

  describe("Home page", () => {
    const teamId = decodeTeamId("team-1");
    const pulseId = decodePulseId("pulse-1");
    const roundId = decodeRoundId("round-1");
    const actionId = decodeActionId("action-1");

    const teamSummary = {
      id: teamId,
      name: "Engineering",
      timeZone: decodeTimeZone("Europe/Berlin"),
      yourRole: "lead" as const,
    };

    const pulse = {
      id: pulseId,
      name: "Weekly check-in",
      cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
      questionCount: 3,
      estimatedSeconds: 90,
    };

    const round = (status: "closed" | "open" | "shared") => ({
      id: roundId,
      pulseId,
      teamId,
      status,
      plannedOpenDate: "2026-11-09",
      plannedOpenAt: instant("2026-11-09T09:00:00Z"),
      openedAt: status === "open" ? instant("2026-11-09T09:00:00Z") : null,
      plannedCloseAt: instant("2026-11-13T09:00:00Z"),
      closedAt: status === "open" ? null : instant("2026-11-13T09:00:00Z"),
      pulseName: "Weekly check-in",
    });

    const action = (status: "committed" | "done") => ({
      id: actionId,
      teamId,
      roundId,
      title: "Fix standups",
      ownerId: decodePersonId("person-1"),
      ownerEmail: decodeEmail("alice@acme.com"),
      dueDate: "2026-11-20",
      dimension: null,
      status,
      createdAt: instant("2026-11-01T09:00:00Z"),
      updatedAt: instant("2026-11-01T09:00:00Z"),
      doneAt: status === "done" ? instant("2026-11-02T09:00:00Z") : null,
    });

    const home = (status: "closed" | "open" | "shared", actionStatus: "committed" | "done") => ({
      teams: { _tag: "Loaded" as const, teams: [teamSummary] },
      homePulses: { [teamId]: { team: teamSummary, pulses: [pulse] } },
      homeRounds: { [pulseId]: { pulseId, paused: false, rounds: [round(status)] } },
      homeActions: { [teamId]: [action(actionStatus)] },
    });

    it("tells a Lead what waits: Results to share, an open Round, an Action due", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          ...home("closed", "committed"),
        }),
        Scene.expect(Scene.role("heading", { name: "What needs my attention" })).toExist(),
        Scene.expect(Scene.text("Results ready to share")).toExist(),
        Scene.expect(Scene.text("Action due")).toExist(),
        Scene.expect(Scene.role("link", { name: "Fix standups" })).toExist(),
        Scene.expect(Scene.text("Nothing needs your attention")).toBeAbsent(),
      );
    });

    it("shows an open Round as the thing to act on", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          ...home("open", "done"),
        }),
        Scene.expect(Scene.text("Round open")).toExist(),
        Scene.expect(Scene.text("Results ready to share")).toBeAbsent(),
        Scene.expect(Scene.text("Action due")).toBeAbsent(),
      );
    });

    it("says nothing needs attention when the Round is shared and the Action is done", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          ...home("shared", "done"),
        }),
        Scene.expect(Scene.text("Nothing needs your attention")).toExist(),
        Scene.expect(Scene.role("link", { name: "See your history" })).toExist(),
        Scene.expect(Scene.text("Results ready to share")).toBeAbsent(),
      );
    });

    it("offers a member nothing to act on", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          teams: {
            _tag: "Loaded",
            teams: [{ ...teamSummary, yourRole: "member" as const }],
          },
        }),
        Scene.expect(Scene.text("Nothing needs your attention")).toExist(),
        Scene.expect(Scene.role("link", { name: "See your history" })).toExist(),
        Scene.expect(Scene.text("Round open")).toBeAbsent(),
      );
    });
  });

  describe("Teams screen", () => {
    it("opens the Create Team form from its button and closes it without doing anything", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
        Scene.expect(Scene.text("No Team yet")).toExist(),
        Scene.expect(Scene.text("You're not in any Team yet.")).toExist(),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toExist(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
      );
    });

    it("renders teams list and creates team via form", () => {
      const teamId = decodeTeamId("team-1");

      const teamSummary = {
        id: teamId,
        name: "Engineering",
        timeZone: decodeTimeZone("Europe/Berlin"),
        yourRole: "lead" as const,
        memberCount: 3,
        nextRoundDate: "2026-11-16",
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [teamSummary] },
        }),
        Scene.expect(Scene.text("Engineering")).toExist(),
        // The row carries the facts: role badge, size, and the next Round.
        Scene.expect(Scene.text("Lead")).toExist(),
        Scene.expect(Scene.text("3 people · Next Round Nov 16, 2026")).toExist(),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.expect(Scene.role("heading", { name: "Create a Team" })).toExist(),
        Scene.type(Scene.label("Team name"), "Design"),
        Scene.change(Scene.label("Time zone"), "UTC"),
        Scene.type(Scene.label("Lead's email"), "lead@acme.com"),
        Scene.click(Scene.role("button", { name: "Create Team" })),
        Scene.Command.expectHas(CreateTeam),
        Scene.Command.resolve(
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
        Scene.Command.expectHas(Navigate),
        Scene.Command.resolve(Navigate, Message.Navigated()),
      );
    });
  });
});
