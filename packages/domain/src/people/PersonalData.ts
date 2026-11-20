import { Context, DateTime, Option, Schema } from "effect";
import type { Effect } from "effect";
import { Legal } from "../Legal.ts";
import { Policy } from "../Policy.ts";
import type { AuthUserId } from "./Identity.ts";
import { OrganizationId } from "./Organization.ts";

export const PERSONAL_DATA_EXPORT_SCHEMA_VERSION = 1;

export const PERSONAL_DATA_EXPORT_FILENAME = "surveybeat-personal-data.json";

const Timestamp = Schema.NullOr(Schema.String);

const Name = Schema.NullOr(Schema.String);

export const isoTimestamp = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const input = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

  return Option.match(DateTime.make(input), {
    onNone: () => String(value),
    onSome: DateTime.formatIso,
  });
};

export const AccountUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const AccountSession = Schema.Struct({
  id: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  expiresAt: Timestamp,
  ipAddress: Name,
  userAgent: Name,
});

export const AccountLink = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  accountId: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const AccountPasskey = Schema.Struct({
  id: Schema.String,
  name: Name,
  deviceType: Schema.String,
  createdAt: Timestamp,
});

export const PersonIndexEntry = Schema.Struct({
  organizationId: OrganizationId,
  organizationName: Schema.String,
  personId: Schema.String,
  email: Schema.String,
});

export const OrganizationClaimEntry = Schema.Struct({
  organizationId: OrganizationId,
  name: Schema.String,
  adminPersonId: Schema.String,
  completedAt: Timestamp,
});

export const AccountData = Schema.Struct({
  user: Schema.NullOr(AccountUser),
  activeSessions: Schema.Array(AccountSession),
  providerLinks: Schema.Array(AccountLink),
  passkeys: Schema.Array(AccountPasskey),
  personIndex: Schema.Array(PersonIndexEntry),
  organizationClaims: Schema.Array(OrganizationClaimEntry),
});

export type AccountData = typeof AccountData.Type;

export const ExportedPerson = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  timeZone: Name,
  locale: Name,
  detectedLocale: Name,
  organizationAdmin: Schema.Boolean,
  removedAt: Timestamp,
});

export const ExportedMembership = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  teamName: Schema.String,
  role: Schema.String,
  startedAt: Timestamp,
  endedAt: Timestamp,
});

export const ExportedParticipation = Schema.Struct({
  roundId: Schema.String,
  plannedOpenDate: Schema.String,
  pulseName: Schema.String,
  participated: Schema.Literal(true),
});

export const ExportedRoundMember = Schema.Struct({
  roundId: Schema.String,
  plannedOpenDate: Schema.String,
  pulseName: Schema.String,
  sendAt: Timestamp,
  timeZone: Schema.String,
});

export const ExportedInvitation = Schema.Struct({
  roundId: Schema.String,
  plannedOpenDate: Schema.String,
  pulseName: Schema.String,
  status: Schema.String,
  resendCount: Schema.Finite,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const ExportedReminderOptOut = Schema.Struct({
  pulseId: Schema.String,
  pulseName: Schema.String,
  optedOutAt: Timestamp,
});

export const ExportedAction = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  roundId: Schema.String,
  title: Schema.String,
  dueDate: Name,
  dimension: Name,
  status: Schema.String,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  doneAt: Timestamp,
});

export const ExportedEmailSend = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  status: Schema.String,
  sentAt: Timestamp,
  failedAt: Timestamp,
});

export const ExportedTestSend = Schema.Struct({
  id: Schema.String,
  pulseId: Schema.String,
  pulseName: Name,
  sentAt: Timestamp,
});

export const OrganizationPersonalData = Schema.Struct({
  organization: Schema.Struct({ id: OrganizationId, name: Schema.String }),
  person: ExportedPerson,
  memberships: Schema.Array(ExportedMembership),
  participation: Schema.Array(ExportedParticipation),
  roundMembers: Schema.Array(ExportedRoundMember),
  invitations: Schema.Array(ExportedInvitation),
  reminderOptOuts: Schema.Array(ExportedReminderOptOut),
  actions: Schema.Array(ExportedAction),
  emailSends: Schema.Array(ExportedEmailSend),
  testSends: Schema.Array(ExportedTestSend),
});

export type OrganizationPersonalData = typeof OrganizationPersonalData.Type;

const ProcessingPurpose = Schema.Struct({
  data: Schema.String,
  purpose: Schema.String,
  legalBasis: Schema.String,
  controller: Schema.String,
  retention: Schema.String,
});

const SubProcessor = Schema.Struct({
  name: Schema.String,
  purpose: Schema.String,
  location: Schema.String,
});

export const Transparency = Schema.Struct({
  controllerContact: Schema.String,
  privacyNotice: Schema.String,
  processingPurposes: Schema.Array(ProcessingPurpose),
  subProcessors: Schema.Array(SubProcessor),
  notIncluded: Schema.Array(Schema.String),
  browserLocalData: Schema.String,
  yourRights: Schema.String,
});

export type Transparency = typeof Transparency.Type;

export const PersonalDataExport = Schema.Struct({
  schemaVersion: Schema.Literal(PERSONAL_DATA_EXPORT_SCHEMA_VERSION),
  exportedAt: Schema.String,
  transparency: Transparency,
  account: AccountData,
  organizations: Schema.Array(OrganizationPersonalData),
});

export type PersonalDataExport = typeof PersonalDataExport.Type;

export const personalDataTransparency: Transparency = {
  controllerContact: Legal.privacyEmail,
  privacyNotice: `${Legal.siteOrigin}${Legal.paths.privacy}`,
  processingPurposes: [
    {
      data: "Sign-in: your email address, the session (IP address, browser user agent, expiry) and a passkey's public key if you add one.",
      purpose: "Let you sign in, keep your session safe and detect abuse.",
      legalBasis:
        "GDPR Art. 6(1)(b), to provide the service you use. Art. 6(1)(f), legitimate interests, for security and abuse prevention.",
      controller: "SurveyBeat",
      retention: `A session lasts ${Policy.signIn.sessionDays} days and is refreshed while you use the app. Signing out deletes that session. An expired session row stays until something deletes it. Nothing deletes expired sessions on a schedule yet. The sign-in account stays, and erasing it is not available yet.`,
    },
    {
      data: "People and Teams: email address, role, Team Membership, time zone and language, whether you turned off reminders for a Pulse, and the Invitations sent to you. A current Invitation token is stored as a hash. An older stored Invitation or reminder email can still hold the raw token.",
      purpose: "Run Teams and Pulses, send Invitations and reminders, and count how many people took part.",
      legalBasis: "GDPR Art. 6(1)(f), legitimate interests of your Organization.",
      controller: "Your Organization, with SurveyBeat as its processor",
      retention:
        "While you are a Person in the Organization. Removing a Person ends their Membership, deletes their Participation records and test sends, and revokes their Invitations. These stay: the Person record, Membership history, which Rounds included them, the revoked Invitations, which Pulses they turned reminders off for, Actions they own, and the delivery records of messages sent to them. The sign-in route to that Organization stays, so this export can include it, and sign-in no longer offers that Organization. Erasing the remaining records is not available yet.",
    },
    {
      data: "Participation records: that a Person answered a Round. They hold no Answers and no time.",
      purpose: "Count the response rate and stop a second Submission from the same Person.",
      legalBasis: "GDPR Art. 6(1)(f), legitimate interests of your Organization.",
      controller: "Your Organization, with SurveyBeat as its processor",
      retention: "While the Person is in the Organization.",
    },
    {
      data: "Actions you own: title, due date, status.",
      purpose: "Let a Team agree what to change after a Round and follow it up.",
      legalBasis: "GDPR Art. 6(1)(f), legitimate interests of your Organization.",
      controller: "Your Organization, with SurveyBeat as its processor",
      retention: "While the Organization keeps the Pulse.",
    },
    {
      data: "Email: the recipient address, the kind of message, and the delivery state. The stored record can also hold a structured payload for that message. This file includes the kind and the delivery state. It leaves out the payload, the message body, and any token.",
      purpose: "Deliver the message and show a Lead which sends failed and why.",
      legalBasis: "GDPR Art. 6(1)(f) for Invitations and notices. Art. 6(1)(b) for sign-in messages.",
      controller: "Your Organization for Invitations and notices. SurveyBeat for sign-in messages.",
      retention: "Delivery records while the Organization exists.",
    },
  ],
  subProcessors: [
    {
      name: "Cloudflare, Inc.",
      purpose:
        "Hosts everything: Workers, Durable Objects, D1, Queues, static pages, and Email Sending for Invitations and sign-in codes.",
      location: "Cloudflare's global network.",
    },
    {
      name: "OpenRouter, Inc.",
      purpose:
        "Routes AI requests for comment themes and discussion guides. Used only when an Organization admin turns AI processing on. OpenRouter may still retain content it flags as child sexual abuse material, including traffic sent with a zero data retention request (zdr: true).",
      location: "United States for its account data. Comment text goes only to EU endpoints.",
    },
    {
      name: "Google Cloud (google-vertex/europe)",
      purpose:
        "Runs the AI model for comment themes and discussion guides. SurveyBeat requests zero data retention (zdr: true) on this EU endpoint.",
      location: "European Union",
    },
    {
      name: "Amazon Web Services (amazon-bedrock/eu-west-1)",
      purpose:
        "The second EU endpoint for the same request. SurveyBeat sends the same zero data retention request (zdr: true).",
      location: "Ireland, European Union",
    },
  ],
  notIncluded: [
    "Submissions and Answers are not in this file. A stored Submission and Answer has no Person column (ADR 0005), so SurveyBeat cannot tell which ones are yours. A comment that still identifies its author can be personal data. Ask your Organization or write to the privacy contact to have it found.",
    "Team Results and the personal data of any other Person are not in this file.",
    "Secrets are not in this file: no session token, sign-in code, password, Invitation link or token, token hash, Edit key hash, or passkey credential. An older stored Invitation or reminder can still hold a raw token. That token and every email body are left out of this file.",
  ],
  browserLocalData:
    "Answers kept in this browser (sb_answers_) stay only in this browser. View or clear them on /history. Edit keys (sb_edit_) also stay only in this browser. /history does not show them or clear them. They remain until you clear this site's data. SurveyBeat's servers store a SHA-256 hash of an Edit key, and never the Edit key itself (ADR 0017).",
  yourRights: `You can ask for correction, erasure, restriction or objection by writing to ${Legal.privacyEmail}. SurveyBeat answers within ${Legal.responseDays} days. Requests about data held for an Organization are passed to that Organization.`,
};

export interface PersonalDataSourceShape {
  readonly gather: (userId: AuthUserId, now: number) => Effect.Effect<PersonalDataExport>;
}

export class PersonalDataSource extends Context.Service<PersonalDataSource, PersonalDataSourceShape>()(
  "@surveybeat/domain/PersonalDataSource",
) {}

export const assemblePersonalDataExport = (parts: {
  readonly now: number;
  readonly account: AccountData;
  readonly organizations: readonly OrganizationPersonalData[];
}): PersonalDataExport => ({
  schemaVersion: PERSONAL_DATA_EXPORT_SCHEMA_VERSION,
  exportedAt: DateTime.formatIso(DateTime.makeUnsafe(parts.now)),
  transparency: personalDataTransparency,
  account: parts.account,
  organizations: [...parts.organizations].sort((a, b) => a.organization.id.localeCompare(b.organization.id)),
});
