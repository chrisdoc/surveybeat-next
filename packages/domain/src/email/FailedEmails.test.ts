import { describe, expect, it } from "@effect/vitest";
import { SendId } from "./Email.ts";
import { type InvitationFacts, isResendable, progressOf, type ResendFacts } from "./FailedEmails.ts";

const sendId = SendId.make("send-1");

const invitation = (overrides: Partial<InvitationFacts> = {}): InvitationFacts => ({
  roundId: "round-1",
  personId: "person-1",
  status: "failed",
  resendCount: 0,
  sendId: "send-1",
  ...overrides,
});

/** A failed send of `kind`, by default for a current, unrevoked Invitation on its first generation. */
const facts = (overrides: Partial<ResendFacts> = {}): ResendFacts => ({
  kind: "AddedToTeam",
  reason: "rejected",
  generation: 0,
  invitation: invitation(),
  testSend: false,
  ...overrides,
});

describe("isResendable", () => {
  it.each(["AddedToTeam", "ResultsReadyEmail"])("resends a failed %s send", (kind) => {
    expect(isResendable(sendId, facts({ kind, invitation: null, generation: null }))).toBe(true);
  });

  it.each(["unknown", "rejected", "abandoned", "bounced"] as const)(
    "resends a send that failed as %s",
    (reason) => {
      expect(isResendable(sendId, facts({ reason }))).toBe(true);
    },
  );

  it.each(["AddedToTeam", "InvitationEmail", "ReminderEmail", "TestInvitationEmail", "ResultsReadyEmail"])(
    "never resends a complained-about %s send",
    (kind) => {
      expect(isResendable(sendId, facts({ kind, reason: "complained", testSend: true }))).toBe(false);
    },
  );

  it("resends an Invitation's email while its Invitation is current, unrevoked, and still on this send", () => {
    expect(isResendable(sendId, facts({ kind: "InvitationEmail" }))).toBe(true);
  });

  it("refuses an Invitation's email once the Invitation was revoked", () => {
    expect(
      isResendable(sendId, facts({ kind: "InvitationEmail", invitation: invitation({ status: "revoked" }) })),
    ).toBe(false);
  });

  it("refuses an Invitation's email once a later Resend moved the Invitation to a new generation", () => {
    expect(
      isResendable(
        sendId,
        facts({ kind: "InvitationEmail", generation: 0, invitation: invitation({ resendCount: 1 }) }),
      ),
    ).toBe(false);
  });

  it("refuses an Invitation's email once the Invitation is on another send", () => {
    expect(
      isResendable(sendId, facts({ kind: "InvitationEmail", invitation: invitation({ sendId: "send-2" }) })),
    ).toBe(false);
  });

  it("refuses an Invitation's email whose Invitation row is gone", () => {
    expect(isResendable(sendId, facts({ kind: "InvitationEmail", invitation: null }))).toBe(false);
  });

  it("refuses a legacy email that names no Invitation generation", () => {
    expect(isResendable(sendId, facts({ kind: "InvitationEmail", generation: null }))).toBe(false);
  });

  it("resends a reminder while its Invitation is current and unrevoked, whichever send it is on", () => {
    expect(
      isResendable(sendId, facts({ kind: "ReminderEmail", invitation: invitation({ sendId: "other" }) })),
    ).toBe(true);
  });

  it("refuses a reminder once its Invitation was revoked or re-sent", () => {
    expect(
      isResendable(sendId, facts({ kind: "ReminderEmail", invitation: invitation({ status: "revoked" }) })),
    ).toBe(false);
    expect(
      isResendable(sendId, facts({ kind: "ReminderEmail", invitation: invitation({ resendCount: 2 }) })),
    ).toBe(false);
  });

  it("resends a test Invitation only while its test send is on record", () => {
    expect(isResendable(sendId, facts({ kind: "TestInvitationEmail", testSend: true }))).toBe(true);
    expect(isResendable(sendId, facts({ kind: "TestInvitationEmail", testSend: false }))).toBe(false);
  });

  it("refuses a send whose content has no known kind", () => {
    expect(isResendable(sendId, facts({ kind: null }))).toBe(false);
    expect(isResendable(sendId, facts({ kind: "SomethingElse" }))).toBe(false);
  });
});

describe("progressOf", () => {
  it("shows each state as the admin sees it", () => {
    expect(progressOf({ _tag: "Pending", attempts: 2, lastCode: "E_RATE" })).toEqual({
      _tag: "Queued",
      attempts: 2,
      lastCode: "E_RATE",
    });
    expect(progressOf({ _tag: "Sending", attempt: 1, leaseExpiresAt: 9 })).toEqual({
      _tag: "Sending",
      attempt: 1,
    });
    expect(progressOf({ _tag: "Sent", messageId: "m-1", sentAt: 5 })).toEqual({ _tag: "Sent", sentAt: 5 });
    expect(progressOf({ _tag: "Failed", reason: "bounced", code: "5.1.1", failedAt: 7 })).toEqual({
      _tag: "Failed",
      reason: "bounced",
      code: "5.1.1",
      failedAt: 7,
    });
  });
});
