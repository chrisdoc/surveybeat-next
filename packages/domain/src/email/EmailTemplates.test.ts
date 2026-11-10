import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  type InvitationEmail,
  type InvitationEmailWithToken,
  type ReminderEmail,
  type ReminderEmailWithToken,
  StoredEmail,
  TransactionalEmail,
} from "./Email.ts";
import { InvitationTokens, withToken } from "./EmailTemplates.ts";

const invitation = { roundId: "round-1", personId: "person-1", generation: 2 };
const base = {
  pulseName: "Weekly Pulse",
  baseUrl: "https://app.surveybeat.app",
  ratingQuestion: null,
  actions: [],
};

const tokens = {
  derive: (ref: typeof invitation) => Effect.succeed(`${ref.roundId}.${ref.personId}.${ref.generation}`),
};
const resolve = (email: StoredEmail) =>
  withToken(email).pipe(Effect.provideService(InvitationTokens, tokens));

const invitationEmail: InvitationEmail = {
  _tag: "InvitationEmail",
  ...base,
  minimumGroupSize: 4,
  invitation,
};
const reminderEmail: ReminderEmail = { _tag: "ReminderEmail", ...base, invitation };

describe("withToken", () => {
  it.effect("derives the token an Invitation or reminder refers to", () =>
    Effect.gen(function* () {
      const invited = yield* resolve(invitationEmail);
      expect(invited).toMatchObject({ _tag: "InvitationEmail", token: "round-1.person-1.2" });
      expect(invited).not.toHaveProperty("invitation");
      const reminded = yield* resolve(reminderEmail);
      expect(reminded).toMatchObject({ _tag: "ReminderEmail", token: "round-1.person-1.2" });
    }),
  );

  it.effect("carries the AI processing flag through to the rendered email", () =>
    Effect.gen(function* () {
      const invited = yield* resolve({ ...invitationEmail, aiProcessing: true });
      expect(invited).toMatchObject({ _tag: "InvitationEmail", aiProcessing: true });
      const reminded = yield* resolve({ ...reminderEmail, aiProcessing: true });
      expect(reminded).toMatchObject({ _tag: "ReminderEmail", aiProcessing: true });
    }),
  );

  it.effect("keeps the token of a row stored before tokens were derived", () =>
    Effect.gen(function* () {
      const legacy: InvitationEmailWithToken = {
        _tag: "InvitationEmail",
        ...base,
        anonymityStatement: "Your name is never stored with your answers.",
        token: "stored-token",
      };
      expect(yield* resolve(legacy)).toEqual(legacy);
      const legacyReminder: ReminderEmailWithToken = {
        _tag: "ReminderEmail",
        ...base,
        token: "stored-token",
        unsubscribeUrl: "https://app.surveybeat.app/api/reminders/unsubscribe?t=stored-token",
      };
      expect(yield* resolve(legacyReminder)).toEqual(legacyReminder);
    }),
  );
});

describe("stored email schemas", () => {
  const decodeStored = Schema.decodeUnknownSync(StoredEmail);
  const decodeWritable = Schema.decodeUnknownSync(TransactionalEmail);

  it("decode rows stored before tokens were derived", () => {
    const row = {
      _tag: "InvitationEmail",
      ...base,
      anonymityStatement: "Your name is never stored with your answers.",
      token: "stored-token",
    };
    expect(decodeStored(row)).toEqual(row);
    expect(() => decodeWritable(row)).toThrow();
  });

  it("decode rows stored before the AI processing flag existed, with no flag", () => {
    const row = { _tag: "ReminderEmail", ...base, invitation };
    expect(decodeStored(row)).toEqual(row);
    expect(decodeWritable(row)).toEqual(row);
    expect(decodeStored(row)).not.toHaveProperty("aiProcessing");
  });

  it("round-trip a row with the AI processing flag", () => {
    const flagged = { ...invitationEmail, aiProcessing: true };
    expect(decodeStored(flagged)).toEqual(flagged);
    expect(decodeWritable(flagged)).toEqual(flagged);
  });

  it("round-trip a new row without a token", () => {
    expect(decodeStored(invitationEmail)).toEqual(invitationEmail);
    expect(decodeStored(reminderEmail)).toEqual(reminderEmail);
    expect(JSON.stringify(Schema.encodeSync(StoredEmail)(invitationEmail))).not.toContain("token");
  });
});
