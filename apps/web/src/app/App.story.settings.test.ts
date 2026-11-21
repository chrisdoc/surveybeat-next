import { Option } from "effect";
import * as Story from "foldkit/story";
import { afterEach, describe, expect, it } from "vitest";
import {
  GetSettings,
  GrantAdmin,
  initialModel,
  ListFailedEmails,
  LoadSession,
  Message,
  OffboardOrganization,
  RemovePerson,
  ConfirmEmailChange,
  CorrectPersonEmail,
  RequestEmailChange,
  ErasePersonData,
  EraseOwnPersonData,
  EraseOwnAccountData,
  LeaveAfterErasureCmd,
  RevokeAdmin,
  update,
  UpdateSettings,
} from "./App.ts";
import { setLocale } from "../messages/locale.ts";
import { decodeOrgId, decodePersonId, decodeEmail, decodeSize, makeUrl } from "./appStoryFixtures.ts";

afterEach(() => {
  setLocale("en");
});

describe("App Stories", () => {
  describe("Settings screen", () => {
    it("updates minimum group size and manages admin roles", () => {
      const personId = decodePersonId("person-1");

      const settings = {
        name: "Acme",
        minimumGroupSize: decodeSize(4),
        aiProcessing: false,
        defaultLocale: "en" as const,
        people: [
          {
            personId,
            email: decodeEmail("alice@acme.com"),
            organizationAdmin: false,
            linked: true,
          },
        ],
        removedPeople: [],
      };

      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/settings"), [])),
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
        Story.Command.expectHas(GetSettings, ListFailedEmails),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.model((m) => {
          expect(m.settings._tag).toBe("Loaded");
          expect(m.size).toBe("4");
        }),
        // Change size
        Story.message(Message.SizeChanged({ size: "5" })),
        Story.message(Message.SubmitSize()),
        Story.Command.expectHas(UpdateSettings),
        Story.Command.resolve(UpdateSettings, Message.UpdatedSettings({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, minimumGroupSize: decodeSize(5) },
            },
          }),
        ),
        // Grant admin
        Story.message(Message.GrantAdminClicked({ personId })),
        Story.Command.expectHas(GrantAdmin),
        Story.Command.resolve(GrantAdmin, Message.GrantedAdmin({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        // Revoke admin
        Story.message(Message.RevokeAdminClicked({ personId })),
        Story.Command.expectHas(RevokeAdmin),
        Story.Command.resolve(RevokeAdmin, Message.RevokedAdmin({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings },
          }),
        ),
        // Remove person
        Story.message(Message.RemovePersonClicked({ personId })),
        Story.message(Message.ConfirmRemove()),
        Story.Command.expectHas(RemovePerson),
        Story.Command.resolve(RemovePerson, Message.RemovedPerson({ outcome: { _tag: "Success" } })),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: { ...settings, people: [] },
            },
          }),
        ),
        Story.model((m) => {
          if (m.settings._tag === "Loaded") {
            expect(m.settings.settings.people).toHaveLength(0);
          }
        }),
      );
    });
  });

  describe("Deleting the Organization (GDPR 308)", () => {
    const settings = {
      name: "Acme",
      minimumGroupSize: decodeSize(4),
      aiProcessing: false,
      defaultLocale: "en" as const,
      people: [],
      removedPeople: [],
    };

    const signedIn = Message.GotSession({
      result: {
        _tag: "SignedIn",
        organization: { id: decodeOrgId("org-1"), name: "Acme" },
        organizationAdmin: true,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      },
    });

    it("keeps deletion closed until the export has been downloaded", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/settings"), [])),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.OffboardingOpened()),
        Story.model((m) => {
          expect(m.offboardingDownloaded).toBe(false);
          expect(m.offboarding.open).toBe(false);
        }),
        Story.message(Message.OffboardingDownloaded()),
        Story.model((m) => {
          expect(m.offboardingDownloaded).toBe(true);
        }),
        Story.message(Message.OffboardingOpened()),
        Story.model((m) => {
          expect(m.offboarding.open).toBe(true);
          expect(m.offboarding.confirmation).toBe("");
        }),
      );
    });

    it("sends only the typed name, then leaves the app when the Organization is deleted", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          offboardingDownloaded: true,
        }),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.OffboardingOpened()),
        Story.message(Message.OffboardingSubmitted()),
        Story.Command.expectNone(),
        Story.message(Message.OffboardingConfirmationChanged({ value: "Acme" })),
        Story.message(Message.OffboardingSubmitted()),
        Story.Command.expectHas(OffboardOrganization({ confirmation: "Acme" })),
        Story.model((m) => {
          expect(m.offboarding.busy).toBe(true);
        }),
        Story.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({ outcome: { _tag: "Success" } }),
        ),
        Story.Command.resolve(LeaveAfterErasureCmd, Message.LeftAfterErasure()),
      );
    });

    it("keeps the form open with the reason when the typed name does not match", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          offboardingDownloaded: true,
        }),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.OffboardingOpened()),
        Story.message(Message.OffboardingConfirmationChanged({ value: "acme" })),
        Story.message(Message.OffboardingSubmitted()),
        Story.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({
            outcome: { _tag: "Failure", failure: "OrganizationNotConfirmed" },
          }),
        ),
        Story.model((m) => {
          expect(m.offboarding.open).toBe(true);
          expect(m.offboarding.busy).toBe(false);
          expect(m.offboarding.confirmation).toBe("acme");
          expect(m.offboardingDownloaded).toBe(true);
          expect(Option.getOrNull(m.offboarding.failure)).toBe("OrganizationNotConfirmed");
        }),
        Story.message(Message.OffboardingConfirmationChanged({ value: "Acme" })),
        Story.model((m) => {
          expect(Option.isNone(m.offboarding.failure)).toBe(true);
        }),
        Story.message(Message.OffboardingDismissed()),
        Story.model((m) => {
          expect(m.offboarding.open).toBe(false);
          expect(m.offboarding.confirmation).toBe("");
          expect(m.offboardingDownloaded).toBe(true);
        }),
      );
    });

    it("asks for the sign-in again when the session has expired", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/settings"), []),
          offboardingDownloaded: true,
        }),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.OffboardingOpened()),
        Story.message(Message.OffboardingConfirmationChanged({ value: "Acme" })),
        Story.message(Message.OffboardingSubmitted()),
        Story.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({ outcome: { _tag: "Failure", failure: "Unauthenticated" } }),
        ),
        Story.Command.expectHas(LoadSession),
        Story.Command.resolve(LoadSession, Message.GotSession({ result: { _tag: "NotInOrganization" } })),
      );
    });

    it("finishes a confirmed deletion from the screen with no Organization, without a name", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Story.message(Message.FinishPendingOffboarding()),
        Story.Command.expectHas(OffboardOrganization({ confirmation: "" })),
        Story.model((m) => {
          expect(m.offboarding.busy).toBe(true);
        }),
        Story.Command.resolve(
          OffboardOrganization,
          Message.OffboardedOrganization({ outcome: { _tag: "Failure", failure: "Forbidden" } }),
        ),
        Story.model((m) => {
          expect(m.offboarding.busy).toBe(false);
          expect(Option.getOrNull(m.offboarding.failure)).toBe("Forbidden");
        }),
      );
    });
  });

  describe("Rectifying an email address (GDPR 309)", () => {
    const personId = decodePersonId("person-1");

    const signedInModel = {
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

    it("sends a code for the typed address, then the code, and ends on the new address", () => {
      Story.story(
        update,
        Story.given(signedInModel),
        Story.message(Message.EmailChangeCodeRequested()),
        Story.Command.expectNone(),
        Story.message(Message.EmailChangeOpened()),
        Story.message(Message.EmailChangeAddressChanged({ value: " alice.new@acme.com " })),
        Story.message(Message.EmailChangeCodeRequested()),
        Story.model((m) => {
          expect(m.emailChange.busy).toBe(true);
        }),
        Story.Command.expectHas(RequestEmailChange),
        Story.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Success" } }),
        ),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("code");
          expect(m.emailChange.busy).toBe(false);
        }),
        Story.message(Message.EmailChangeConfirmed()),
        Story.Command.expectNone(),
        Story.message(Message.EmailChangeCodeChanged({ value: " 123456 " })),
        Story.message(Message.EmailChangeConfirmed()),
        Story.Command.expectHas(ConfirmEmailChange),
        Story.Command.resolve(
          ConfirmEmailChange,
          Message.EmailChangeFinished({ outcome: { _tag: "Success" } }),
        ),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("done");
          expect(m.emailChange.email).toBe(" alice.new@acme.com ");
          expect(m.emailChange.code).toBe("");
        }),
      );
    });

    it("keeps the step and shows the failure, then lets the Person pick another address", () => {
      Story.story(
        update,
        Story.given(signedInModel),
        Story.message(Message.EmailChangeOpened()),
        Story.message(Message.EmailChangeAddressChanged({ value: "bob@acme.com" })),
        Story.message(Message.EmailChangeCodeRequested()),
        Story.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Failure", failure: "EmailTaken" } }),
        ),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("address");
          expect(Option.getOrNull(m.emailChange.failure)).toBe("EmailTaken");
        }),
        Story.message(Message.EmailChangeAddressChanged({ value: "alice.new@acme.com" })),
        Story.model((m) => {
          expect(Option.isNone(m.emailChange.failure)).toBe(true);
        }),
        Story.message(Message.EmailChangeCodeRequested()),
        Story.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Success" } }),
        ),
        Story.message(Message.EmailChangeCodeChanged({ value: "000000" })),
        Story.message(Message.EmailChangeConfirmed()),
        Story.Command.resolve(
          ConfirmEmailChange,
          Message.EmailChangeFinished({ outcome: { _tag: "Failure", failure: "WrongEmailCode" } }),
        ),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("code");
          expect(m.emailChange.busy).toBe(false);
          expect(Option.getOrNull(m.emailChange.failure)).toBe("WrongEmailCode");
        }),
        Story.message(Message.EmailChangeOtherAddress()),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("address");
          expect(m.emailChange.code).toBe("");
          expect(Option.isNone(m.emailChange.failure)).toBe(true);
        }),
        Story.message(Message.EmailChangeDismissed()),
        Story.model((m) => {
          expect(m.emailChange.step).toBe("closed");
          expect(m.emailChange.email).toBe("");
        }),
      );
    });

    it("sends the Person to sign in again when the session ended", () => {
      Story.story(
        update,
        Story.given(signedInModel),
        Story.message(Message.EmailChangeOpened()),
        Story.message(Message.EmailChangeAddressChanged({ value: "alice.new@acme.com" })),
        Story.message(Message.EmailChangeCodeRequested()),
        Story.Command.resolve(
          RequestEmailChange,
          Message.EmailChangeCodeSent({ outcome: { _tag: "Failure", failure: "Unauthenticated" } }),
        ),
        Story.Command.expectHas(LoadSession),
        Story.Command.resolve(LoadSession, Message.GotSession({ result: { _tag: "SignedOut" } })),
      );
    });

    it("sends the corrected address of a Person who has not signed in, and reloads the People", () => {
      Story.story(
        update,
        Story.given(signedInModel),
        Story.message(Message.CorrectEmailClicked({ personId })),
        Story.message(Message.CorrectEmailSubmitted()),
        Story.Command.expectNone(),
        Story.message(Message.CorrectEmailChanged({ value: " pat.new@acme.com " })),
        Story.message(Message.CorrectEmailSubmitted()),
        Story.Command.expectHas(CorrectPersonEmail),
        Story.Command.resolve(
          CorrectPersonEmail,
          Message.CorrectedEmail({ outcome: { _tag: "Failure", failure: "PersonHasAccount" } }),
        ),
        Story.model((m) => {
          expect(Option.isSome(m.correctEmail.pending)).toBe(true);
          expect(m.correctEmail.busy).toBe(false);
          expect(Option.getOrNull(m.correctEmail.failure)).toBe("PersonHasAccount");
        }),
        Story.message(Message.CorrectEmailSubmitted()),
        Story.Command.resolve(CorrectPersonEmail, Message.CorrectedEmail({ outcome: { _tag: "Success" } })),
        Story.model((m) => {
          expect(Option.isNone(m.correctEmail.pending)).toBe(true);
          expect(m.correctEmail.value).toBe("");
        }),
        Story.Command.expectHas(GetSettings),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: {
              _tag: "Success",
              settings: {
                name: "Acme",
                minimumGroupSize: decodeSize(4),
                aiProcessing: false,
                defaultLocale: "en" as const,
                people: [],
                removedPeople: [],
              },
            },
          }),
        ),
      );
    });
  });

  describe("Erasing personal data (GDPR 307)", () => {
    const personId = decodePersonId("person-1");

    const settings = {
      name: "Acme",
      minimumGroupSize: decodeSize(4),
      aiProcessing: false,
      defaultLocale: "en" as const,
      people: [],
      removedPeople: [{ personId, email: decodeEmail("ghost@acme.com"), linked: false }],
    };

    const signedIn = Message.GotSession({
      result: {
        _tag: "SignedIn",
        organization: { id: decodeOrgId("org-1"), name: "Acme" },
        organizationAdmin: true,
        locale: null,
        detectedLocale: null,
        organizationLocale: "en",
      },
    });

    it("sends nothing until an admin types the address, then erases a removed Person", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/settings"), [])),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.ErasePersonClicked({ personId })),
        Story.model((m) => {
          expect(Option.getOrNull(m.pendingErasePerson)).toEqual({ personId, email: "ghost@acme.com" });
        }),
        Story.message(Message.ConfirmErasePerson()),
        Story.Command.expectNone(),
        Story.model((m) => {
          expect(Option.getOrNull(m.peopleFailure)).toBe("ErasureNotConfirmed");
        }),
        Story.message(Message.ErasePersonConfirmationChanged({ value: "ghost@acme.com" })),
        Story.message(Message.ConfirmErasePerson()),
        Story.Command.expectHas(ErasePersonData),
        Story.Command.resolve(ErasePersonData, Message.ErasedPerson({ outcome: { _tag: "Success" } })),
        Story.Command.resolve(
          GetSettings,
          Message.GotSettings({
            outcome: { _tag: "Success", settings: { ...settings, removedPeople: [] } },
          }),
        ),
        Story.model((m) => {
          expect(Option.isNone(m.pendingErasePerson)).toBe(true);
          expect(m.erasePersonConfirmation).toBe("");
        }),
      );
    });

    it("keeps the confirmation open and shows why when the server refuses", () => {
      Story.story(
        update,
        Story.given(initialModel(makeUrl("https://app.surveybeat.com/settings"), [])),
        Story.message(signedIn),
        Story.Command.resolve(GetSettings, Message.GotSettings({ outcome: { _tag: "Success", settings } })),
        Story.Command.resolve(
          ListFailedEmails,
          Message.GotFailedEmails({ outcome: { _tag: "Success", list: { emails: [] } } }),
        ),
        Story.message(Message.ErasePersonClicked({ personId })),
        Story.message(Message.ErasePersonConfirmationChanged({ value: "ghost@acme.com" })),
        Story.message(Message.ConfirmErasePerson()),
        Story.Command.resolve(
          ErasePersonData,
          Message.ErasedPerson({ outcome: { _tag: "Failure", failure: "LastAdmin" } }),
        ),
        Story.model((m) => {
          expect(Option.isSome(m.pendingErasePerson)).toBe(true);
          expect(Option.getOrNull(m.peopleFailure)).toBe("LastAdmin");
          expect(m.peopleBusy).toBe(false);
        }),
        Story.message(Message.DismissErasePerson()),
        Story.model((m) => {
          expect(Option.isNone(m.pendingErasePerson)).toBe(true);
        }),
      );
    });

    it("erases the signed-in Person only after the address is typed, then leaves the app", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: {
            _tag: "SignedIn",
            organization: { id: decodeOrgId("org-1"), name: "Acme" },
            organizationAdmin: true,
            locale: null,
            detectedLocale: null,
            organizationLocale: "en",
          },
        }),
        Story.message(Message.SelfEraseOpened()),
        Story.message(Message.SelfEraseSubmitted()),
        Story.Command.expectNone(),
        Story.model((m) => {
          expect(Option.getOrNull(m.selfErase.failure)).toBe("ErasureNotConfirmed");
        }),
        Story.message(Message.SelfEraseConfirmationChanged({ value: "alice@acme.com" })),
        Story.message(Message.SelfEraseSubmitted()),
        Story.Command.expectHas(EraseOwnPersonData),
        Story.Command.resolve(EraseOwnPersonData, Message.SelfErased({ outcome: { _tag: "Success" } })),
        Story.Command.resolve(LeaveAfterErasureCmd, Message.LeftAfterErasure()),
      );
    });

    it("shows the failure and lets the Person try again when the server refuses", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: {
            _tag: "SignedIn",
            organization: { id: decodeOrgId("org-1"), name: "Acme" },
            organizationAdmin: true,
            locale: null,
            detectedLocale: null,
            organizationLocale: "en",
          },
        }),
        Story.message(Message.SelfEraseOpened()),
        Story.message(Message.SelfEraseConfirmationChanged({ value: "alice@acme.com" })),
        Story.message(Message.SelfEraseSubmitted()),
        Story.Command.resolve(
          EraseOwnPersonData,
          Message.SelfErased({ outcome: { _tag: "Failure", failure: "LastLead" } }),
        ),
        Story.model((m) => {
          expect(m.selfErase.busy).toBe(false);
          expect(m.selfErase.open).toBe(true);
          expect(Option.getOrNull(m.selfErase.failure)).toBe("LastLead");
        }),
      );
    });

    it("erases only the sign-in account for someone in no Organization", () => {
      Story.story(
        update,
        Story.given({
          ...initialModel(makeUrl("https://app.surveybeat.com/privacy"), []),
          session: { _tag: "NotInOrganization" },
        }),
        Story.message(Message.SelfEraseOpened()),
        Story.message(Message.SelfEraseConfirmationChanged({ value: "alice@acme.com" })),
        Story.message(Message.SelfEraseSubmitted()),
        Story.Command.expectHas(EraseOwnAccountData),
        Story.Command.resolve(EraseOwnAccountData, Message.SelfErased({ outcome: { _tag: "Success" } })),
        Story.Command.resolve(LeaveAfterErasureCmd, Message.LeftAfterErasure()),
      );
    });
  });
});
