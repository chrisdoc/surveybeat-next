import type { Locale } from "@surveybeat/domain";
import { Popover } from "@foldkit/ui";
import { Option } from "effect";
import * as Scene from "foldkit/scene";
import { setup } from "foldkit/test/vitest";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfirmEmailChange,
  DeletePasskeyCmd,
  initialModel,
  ListPasskeysCmd,
  localeOf,
  Message,
  RenamePasskeyCmd,
  RequestEmailChange,
  update,
  view,
} from "./App.ts";
import type { Model } from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import type { SessionModel } from "./session.ts";
import {
  decodeOrgId,
  decodeTeamId,
  decodePulseId,
  decodeTimeZone,
  decodeSize,
  decodeSendTime,
  makeUrl,
  openAccountMenu,
  signedInAdmin,
} from "./appSceneFixtures.ts";

setup();

afterEach(() => {
  setLocale("en");
});

describe("App Scenes", () => {
  describe("Privacy page", () => {
    it("renders privacy page when signed out", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
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
        Scene.expect(Scene.role("heading", { name: "Privacy at SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Nothing shown below the minimum group size" })).toExist(),
        Scene.expect(
          Scene.role("heading", { name: "AI processing is off until an admin turns it on" }),
        ).toExist(),
        Scene.expect(Scene.role("heading", { name: "Anonymous Submissions" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Comment redaction" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "30-day point-in-time restore window" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Changing your answers" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Who can trigger a restore" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Back" })).toExist(),
      );
    });

    it("offers erasure behind a confirmation next to the export, and clears nothing on the first click", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("button", { name: "Download my personal data" })).toExist(),
        Scene.expect(Scene.role("heading", { name: "Erase your personal data" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Erase permanently" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Erase my personal data" })),
        Scene.expect(Scene.label("Type your email address to confirm")).toExist(),
        Scene.expect(Scene.role("button", { name: "Erase permanently" })).toBeDisabled(),
        Scene.type(Scene.label("Type your email address to confirm"), "alice@acme.com"),
        Scene.expect(Scene.role("button", { name: "Erase permanently" })).toBeEnabled(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("button", { name: "Erase permanently" })).toBeAbsent(),
      );
    });

    it("offers the sign-in account erasure to someone who is in no Organization", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Scene.expect(Scene.role("heading", { name: "Erase your personal data" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Erase my personal data" })).toExist(),
      );
    });

    it("offers an email change next to the export and the erasure, and sends nothing on the first click", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("heading", { name: "Change your email address" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Send code" })).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Change my email address" })),
        Scene.expect(Scene.label("New email address")).toExist(),
        Scene.expect(Scene.role("button", { name: "Send code" })).toBeDisabled(),
        Scene.type(Scene.label("New email address"), "alice.new@acme.com"),
        Scene.expect(Scene.role("button", { name: "Send code" })).toBeEnabled(),
        Scene.click(Scene.role("button", { name: "Cancel" })),
        Scene.expect(Scene.role("button", { name: "Send code" })).toBeAbsent(),
        Scene.Command.expectNone(),
      );
    });

    it("asks for the code after sending it, then confirms the new address", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.click(Scene.role("button", { name: "Change my email address" })),
        Scene.type(Scene.label("New email address"), " alice.new@acme.com "),
        Scene.click(Scene.role("button", { name: "Send code" })),
        Scene.Command.expectHas(RequestEmailChange({ email: "alice.new@acme.com" })),
        Scene.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Success" } }),
        ),
        Scene.expect(
          Scene.text("We sent a 6-digit code to alice.new@acme.com. It expires in 10 minutes."),
        ).toExist(),
        Scene.expect(Scene.role("button", { name: "Confirm new address" })).toBeDisabled(),
        Scene.type(Scene.label("Code"), "123456"),
        Scene.click(Scene.role("button", { name: "Confirm new address" })),
        Scene.Command.expectHas(ConfirmEmailChange({ email: "alice.new@acme.com", otp: "123456" })),
        Scene.Command.resolve(
          ConfirmEmailChange,
          Message.EmailChangeFinished({ outcome: { _tag: "Success" } }),
        ),
        Scene.expect(Scene.text("Your email address is now alice.new@acme.com.")).toExist(),
        Scene.expect(Scene.label("Code")).toBeAbsent(),
      );
    });

    it("shows why a code, an address or an old session was refused, and keeps the form", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.click(Scene.role("button", { name: "Change my email address" })),
        Scene.type(Scene.label("New email address"), "bob@acme.com"),
        Scene.click(Scene.role("button", { name: "Send code" })),
        Scene.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Failure", failure: "EmailTaken" } }),
        ),
        Scene.expect(
          Scene.text("That address already belongs to someone else. Use a different one."),
        ).toExist(),
        Scene.expect(Scene.label("New email address")).toExist(),
        Scene.type(Scene.label("New email address"), "alice.new@acme.com"),
        Scene.expect(
          Scene.text("That address already belongs to someone else. Use a different one."),
        ).toBeAbsent(),
        Scene.click(Scene.role("button", { name: "Send code" })),
        Scene.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Success" } }),
        ),
        Scene.type(Scene.label("Code"), "000000"),
        Scene.click(Scene.role("button", { name: "Confirm new address" })),
        Scene.Command.resolve(
          ConfirmEmailChange,
          Message.EmailChangeFinished({ outcome: { _tag: "Failure", failure: "WrongEmailCode" } }),
        ),
        Scene.expect(
          Scene.text("That code is wrong or has expired. Check it, or ask for a new one."),
        ).toExist(),
        Scene.click(Scene.role("button", { name: "Confirm new address" })),
        Scene.Command.resolve(
          ConfirmEmailChange,
          Message.EmailChangeFinished({ outcome: { _tag: "Failure", failure: "SignInAgainRequired" } }),
        ),
        Scene.expect(Scene.text("Sign in again to change your email address, then try once more.")).toExist(),
        Scene.click(Scene.role("button", { name: "Use another address" })),
        Scene.expect(Scene.label("New email address")).toExist(),
      );
    });

    it("offers the email change to someone who is in no Organization", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Scene.expect(Scene.role("heading", { name: "Change your email address" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Change my email address" })).toExist(),
      );
    });

    it("keeps the email change out of the public privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
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
        Scene.expect(Scene.role("heading", { name: "Change your email address" })).toBeAbsent(),
      );
    });

    it("keeps the erasure out of the public privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
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
        Scene.expect(Scene.role("heading", { name: "Erase your personal data" })).toBeAbsent(),
      );
    });

    it("keeps the app nav on the privacy page when signed in", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("link", { name: "Teams" })).toExist(),
        Scene.expect(
          Scene.role("heading", { name: "AI processing is off until an admin turns it on" }),
        ).toExist(),
      );
    });

    it("centres the sign-in card with product framing and the privacy promise", () => {
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
        Scene.expect(Scene.text("Short check-ins that show how your Team is really doing.")).toExist(),
        Scene.expect(Scene.role("button", { name: "Email me a code" })).toExist(),
        Scene.expect(Scene.role("link", { name: "How privacy works" })).toExist(),
        Scene.expect(
          Scene.text("Anonymous by design: answers are never stored with a name or a time."),
        ).toExist(),
      );
    });

    it("renders privacy link on sign in page", () => {
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
        Scene.expect(Scene.role("link", { name: "Privacy" })).toExist(),
      );
    });
  });

  describe("Language", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/");

    const signedIn = (locale: Locale | null, organizationLocale: Locale): SessionModel => ({
      _tag: "SignedIn",
      organization: { id: decodeOrgId("org-1"), name: "Acme" },
      organizationAdmin: true,
      locale,
      detectedLocale: null,
      organizationLocale,
    });

    it("shows the screens in English, with no language picker in the account menu", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(teamsUrl, []),
          session: signedInAdmin,
          teams: { _tag: "Loaded", teams: [] },
        }),
        Scene.expect(Scene.role("link", { name: "Organization settings" })).toExist(),
        ...openAccountMenu("Acme"),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
        Scene.expect(Scene.text("You're not in any Team yet.")).toExist(),
        Scene.expect(Scene.label("Language")).toBeAbsent(),
      );
    });

    it("has no default language on the settings screen", () => {
      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [],
        removedPeople: [],
      };

      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          session: signedInAdmin,
          settings: { _tag: "Loaded", settings },
          size: "4",
        }),
        Scene.expect(Scene.label("Language")).toBeAbsent(),
        Scene.expect(Scene.text("Default language")).toBeAbsent(),
      );
    });

    describe("localeOf", () => {
      const modelWith = (browser: Locale | null, session: SessionModel) => ({
        ...initialModel(teamsUrl, []),
        browserLocale: Option.fromNullishOr(browser),
        session,
      });

      it("is English for a signed-in Person, whatever the choices recorded", () => {
        expect(localeOf(modelWith("en", signedIn(null, "en")))).toBe("en");
        expect(localeOf(modelWith(null, signedIn("en", "en")))).toBe("en");
        expect(localeOf(modelWith(null, signedIn(null, "en")))).toBe("en");
      });

      it("is English when signed out, with or without a browser language", () => {
        const signedOut: SessionModel = {
          _tag: "SignedOut",
          failed: false,
          stage: "email",
          email: "",
          code: "",
          busy: false,
          notice: null,
        };

        expect(localeOf(modelWith("en", signedOut))).toBe("en");
        expect(localeOf(modelWith(null, signedOut))).toBe("en");
      });
    });
  });

  describe("Header and footer", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/teams");

    const teamsModel = (session: SessionModel = signedInAdmin) => ({
      ...initialModel(teamsUrl, []),
      session,
      teams: { _tag: "Loaded" as const, teams: [] },
    });

    it("marks the section on screen as the current navigation item", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/history"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("link", { name: "My history", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toBeAbsent(),
      );
    });

    it("marks Teams as the current section on Team screens", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/teams/team-1/pulses"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "My history", current: "page" })).toBeAbsent(),
      );
    });

    it("lists Organization settings only for admins", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel(signedInAdmin)),
        Scene.expect(Scene.role("link", { name: "Organization settings" })).toExist(),
      );
      Scene.scene(
        { update, view },
        Scene.given(teamsModel({ ...signedInAdmin, organizationAdmin: false })),
        Scene.expect(Scene.role("link", { name: "Organization settings" })).toBeAbsent(),
      );
    });

    it("keeps Privacy out of the navigation and in the footer", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.expect(Scene.role("contentinfo")).toExist(),
        Scene.inside(
          Scene.role("contentinfo"),
          Scene.expect(Scene.role("link", { name: "Privacy" })).toExist(),
        ),
        Scene.inside(
          Scene.role("navigation", { name: "Main navigation" }),
          Scene.expect(Scene.role("link", { name: "Privacy" })).toBeAbsent(),
        ),
      );
    });

    it("marks the footer Privacy link as the current page on the Privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
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
        Scene.expect(Scene.role("link", { name: "Privacy", current: "page" })).toExist(),
      );
    });

    it("keeps the signed-in header and its menus on the Privacy page", () => {
      Scene.scene(
        { update, view },
        Scene.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: signedInAdmin,
        }),
        Scene.expect(Scene.role("heading", { name: "Privacy at SurveyBeat" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Privacy", current: "page" })).toExist(),
        Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toBeAbsent(),
        ...openAccountMenu("Acme"),
        Scene.expect(Scene.role("link", { name: "Passkeys & privacy" })).toExist(),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
      );
    });

    it("lists passkeys with provider labels and supports renaming on Privacy", () => {
      const base = initialModel(makeUrl("https://app.surveybeat.com/privacy"), []);

      Scene.scene(
        { update, view },
        Scene.given({
          ...base,
          session: signedInAdmin,
          passkeyCapabilities: {
            supported: true,
            conditionalGet: true,
            platformAuthenticator: true,
          },
          passkeys: {
            ...base.passkeys,
            list: {
              _tag: "Loaded",
              passkeys: [
                {
                  id: "pk-1",
                  name: "MacBook Pro",
                  credentialID: "cred-1",
                  deviceType: "multiDevice",
                  backedUp: true,
                  createdAt: "2026-11-20T12:00:00.000Z",
                  aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
                },
                {
                  id: "pk-2",
                  name: null,
                  credentialID: "cred-2",
                  deviceType: "singleDevice",
                  backedUp: false,
                  createdAt: "2026-11-20T12:00:00.000Z",
                  aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
                },
              ],
            },
          },
        }),
        Scene.expect(Scene.role("heading", { name: "Passkeys" })).toExist(),
        Scene.expect(Scene.text("MacBook Pro")).toExist(),
        Scene.expect(Scene.text("Synced")).toExist(),
        Scene.expect(Scene.text("Google Password Manager")).toExist(),
        Scene.expect(Scene.text("This device")).toExist(),
        Scene.expect(Scene.role("button", { name: "Add a passkey" })).toExist(),
      );
    });

    it("renames and removes a passkey on Privacy and hides Add when unsupported", () => {
      const base = initialModel(makeUrl("https://app.surveybeat.com/privacy"), []);

      Scene.scene(
        { update, view },
        Scene.given({
          ...base,
          session: signedInAdmin,
          passkeyCapabilities: {
            supported: true,
            conditionalGet: true,
            platformAuthenticator: true,
          },
          passkeys: {
            ...base.passkeys,
            list: {
              _tag: "Loaded",
              passkeys: [
                {
                  id: "pk-1",
                  name: null,
                  credentialID: "cred-1",
                  deviceType: "multiDevice",
                  backedUp: true,
                  createdAt: "2026-11-20T12:00:00.000Z",
                  aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
                },
              ],
            },
          },
        }),
        Scene.expect(Scene.text("Apple Passwords")).toExist(),
        Scene.click(Scene.role("button", { name: "Rename" })),
        Scene.type(Scene.label("Passkey name"), "Work laptop"),
        Scene.click(Scene.role("button", { name: "Save" })),
        Scene.Command.expectHas(RenamePasskeyCmd),
        Scene.Command.resolve(RenamePasskeyCmd, Message.PasskeyRenamed({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(ListPasskeysCmd),
        Scene.Command.resolve(
          ListPasskeysCmd,
          Message.GotPasskeys({
            outcome: {
              _tag: "Success",
              passkeys: [
                {
                  id: "pk-1",
                  name: "Work laptop",
                  credentialID: "cred-1",
                  deviceType: "multiDevice",
                  backedUp: true,
                  createdAt: "2026-11-20T12:00:00.000Z",
                  aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
                },
              ],
            },
          }),
        ),
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.expect(Scene.role("alertdialog", { name: "Remove passkey" })).toExist(),
        Scene.click(Scene.role("button", { name: "Remove" })),
        Scene.Command.expectHas(DeletePasskeyCmd),
        Scene.Command.resolve(DeletePasskeyCmd, Message.PasskeyDeleted({ outcome: { _tag: "Success" } })),
        Scene.Command.expectHas(ListPasskeysCmd),
        Scene.Command.resolve(
          ListPasskeysCmd,
          Message.GotPasskeys({ outcome: { _tag: "Success", passkeys: [] } }),
        ),
      );

      Scene.scene(
        { update, view },
        Scene.given({
          ...base,
          session: signedInAdmin,
          passkeys: {
            ...base.passkeys,
            list: { _tag: "Loaded", passkeys: [] },
          },
        }),
        Scene.expect(
          Scene.text("This browser does not support passkeys. You can still sign in with an email code."),
        ).toExist(),
        Scene.expect(Scene.role("button", { name: "Add a passkey" })).toBeAbsent(),
      );
    });

    it("keeps Sign out in the account menu until it opens", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toBeAbsent(),
        ...openAccountMenu("Acme"),
        Scene.expect(Scene.role("button", { name: "Sign out" })).toExist(),
        Scene.keydown(Scene.selector("#account-menu-panel"), "Escape"),
        // Escape returns focus to the account button and closes the panel.
        Scene.Command.resolve(Popover.FocusButton, Popover.Message.CompletedFocusButton()),
        Scene.Mount.expectEnded(Popover.AnchorPopover),
        Scene.expect(Scene.role("button", { name: "Acme Account menu" })).toHaveAttr(
          "aria-expanded",
          "false",
        ),
      );
    });

    it("opens the phone navigation from the Menu button", () => {
      Scene.scene(
        { update, view },
        Scene.given(teamsModel()),
        Scene.click(Scene.role("button", { name: "Menu" })),
        Scene.Mount.resolve(Popover.AnchorPopover, Popover.Message.CompletedAnchorPopover()),
        Scene.inside(
          Scene.selector("#nav-menu-panel"),
          Scene.expect(Scene.role("link", { name: "My history" })).toExist(),
          Scene.expect(Scene.role("link", { name: "Teams", current: "page" })).toExist(),
          Scene.expect(Scene.role("link", { name: "Organization settings" })).toExist(),
        ),
      );
    });

    it("closes both header menus when the URL changes", () => {
      const open = {
        ...teamsModel(),
        navMenu: Popover.open(Popover.init({ id: "nav-menu" })).model,
        accountMenu: Popover.open(Popover.init({ id: "account-menu" })).model,
      };

      expect(open.navMenu.isOpen).toBe(true);
      expect(open.accountMenu.isOpen).toBe(true);

      const next = update(open, Message.UrlChanged({ url: makeUrl("https://app.surveybeat.com/history") }));

      expect(next.model.navMenu.isOpen).toBe(false);
      expect(next.model.accountMenu.isOpen).toBe(false);
    });
  });

  describe("Document title", () => {
    const teamsUrl = makeUrl("https://app.surveybeat.com/teams");

    /** The window title `view` gives `model`, read while a Scene runs the real view. */
    const titleOf = (model: Model): string => {
      let title = "";
      Scene.scene(
        {
          update,
          view: (current, h) => {
            const document = view(current, h);
            title = document.title;

            return document;
          },
        },
        Scene.given(model),
      );

      return title;
    };

    const teamOf = (id: string, name: string) => ({
      id: decodeTeamId(id),
      name,
      timeZone: decodeTimeZone("UTC"),
      yourRole: "lead" as const,
    });

    const teamDetailOf = (id: string, name: string) => ({
      team: teamOf(id, name),
      roster: [],
      may: {
        update: true,
        manageLeads: true,
        manageMembers: true,
        managePulses: true,
        viewResults: true,
      },
    });

    const platform = { _tag: "Loaded" as const, detail: teamDetailOf("team-1", "Platform Engineering") };

    const pulseDetail = {
      _tag: "Loaded" as const,
      detail: {
        id: decodePulseId("pulse-1"),
        team: teamOf("team-1", "Platform Engineering"),
        settings: {
          name: "Weekly check-in",
          cadence: { _tag: "Weekly" as const, day: "monday" as const, time: decodeSendTime("09:00") },
          answerWindowDays: 3,
          reviewWindowDays: 3,
          reminders: 1,
          anonymityMode: "anonymous" as const,
          distribution: "invitation" as const,
        },
        questions: [],
        estimatedSeconds: 0,
        warnings: [],
        templateQuestions: [],
      },
    };

    const inOrganization = (url: string, extra: Partial<Model> = {}): Model => ({
      ...initialModel(makeUrl(url), []),
      session: signedInAdmin,
      ...extra,
    });

    it("names the screen and the Organization on the Teams screen", () => {
      expect(
        titleOf(inOrganization("https://app.surveybeat.com/teams", { teams: { _tag: "Loaded", teams: [] } })),
      ).toBe("Teams · Acme — SurveyBeat");
    });

    it("shows the Teams screen's title on a page that does not exist", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/nowhere"))).toBe("Teams · Acme — SurveyBeat");
    });

    it("names the Team on its screen, and 'Team' while its detail loads", () => {
      expect(
        titleOf(inOrganization("https://app.surveybeat.com/teams/team-1", { teamDetail: platform })),
      ).toBe("Platform Engineering · Acme — SurveyBeat");
      expect(titleOf(inOrganization("https://app.surveybeat.com/teams/team-1"))).toBe(
        "Team · Acme — SurveyBeat",
      );
    });

    it("ignores a Team loaded for another screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-2", {
            teamDetail: { _tag: "Loaded", detail: teamDetailOf("team-1", "Platform Engineering") },
          }),
        ),
      ).toBe("Team · Acme — SurveyBeat");
    });

    it("names the Team on the Pulses screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses", {
            pulses: {
              _tag: "Loaded",
              pulses: { team: teamOf("team-1", "Platform Engineering"), pulses: [] },
            },
          }),
        ),
      ).toBe("Pulses · Platform Engineering — SurveyBeat");
    });

    it("names the Pulse and its Team in the Pulse editor", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1", {
            pulseDetail,
            teamDetail: platform,
          }),
        ),
      ).toBe("Weekly check-in · Platform Engineering — SurveyBeat");
    });

    it("falls back to 'Pulse' and the Organization while the Pulse loads", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1"))).toBe(
        "Pulse · Acme — SurveyBeat",
      );
    });

    it("names the Team on the Rounds screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/pulses/pulse-1/rounds", {
            teamDetail: platform,
          }),
        ),
      ).toBe("Rounds · Platform Engineering — SurveyBeat");
    });

    it("names the Team on the Results screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            teamDetail: platform,
          }),
        ),
      ).toBe("Results · Platform Engineering — SurveyBeat");
    });

    it("ignores a Team loaded for another Results screen", () => {
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            teamDetail: { _tag: "Loaded", detail: teamDetailOf("team-9", "Other Team") },
          }),
        ),
      ).toBe("Results · Acme — SurveyBeat");
    });

    it("names My history and the Organization", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/history"))).toBe(
        "My history · Acme — SurveyBeat",
      );
    });

    it("names the Organization settings for admins, and falls back to Teams for others", () => {
      expect(titleOf(inOrganization("https://app.surveybeat.com/settings"))).toBe(
        "Organization settings · Acme — SurveyBeat",
      );
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/settings", {
            session: { ...signedInAdmin, organizationAdmin: false },
          }),
        ),
      ).toBe("Teams · Acme — SurveyBeat");
    });

    it("gives a Round's results title the Team's name, in English", () => {
      const english = { ...signedInAdmin, locale: "en" as const };
      expect(
        titleOf(
          inOrganization("https://app.surveybeat.com/teams/team-1/rounds/round-1", {
            session: english,
            teamDetail: platform,
          }),
        ),
      ).toBe("Results · Platform Engineering — SurveyBeat");
    });

    it("keeps the session and Privacy screens' own titles, all naming SurveyBeat", () => {
      const signedOut = (url: string): Model => ({
        ...initialModel(makeUrl(url), []),
        session: {
          _tag: "SignedOut",
          failed: false,
          stage: "email",
          email: "",
          code: "",
          busy: false,
          notice: null,
        },
      });

      expect(titleOf(signedOut("https://app.surveybeat.com/"))).toBe("Sign in to SurveyBeat");
      expect(titleOf(signedOut("https://app.surveybeat.com/privacy"))).toBe("Privacy at SurveyBeat");
      expect(titleOf({ ...initialModel(teamsUrl, []), session: { _tag: "Loading" } })).toBe("SurveyBeat");
      expect(
        titleOf({
          ...initialModel(teamsUrl, []),
          session: { _tag: "CreateOrganization", name: "", busy: false },
        }),
      ).toBe("Create an Organization — SurveyBeat");
      expect(titleOf({ ...initialModel(teamsUrl, []), session: { _tag: "NotInOrganization" } })).toBe(
        "You're not part of an Organization yet — SurveyBeat",
      );
      expect(
        titleOf({
          ...initialModel(teamsUrl, []),
          session: { _tag: "ChooseOrganization", organizations: [], busy: false },
        }),
      ).toBe("Choose an Organization — SurveyBeat");
    });
  });
});
