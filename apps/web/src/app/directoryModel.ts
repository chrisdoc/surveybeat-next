import {
  EmailAddress,
  EmailSendProgress,
  FailedEmails,
  MinimumGroupSize,
  OrganizationSettings,
  PersonId,
  TeamDetail,
  TeamName,
  TeamSummary,
  TimeZone,
} from "@surveybeat/domain";
import type { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";
import { message } from "../messages/locale.ts";
import { Failure } from "./api.ts";

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

export const LoadedFailedEmails = defineTaggedUnion({
  Loading: {},
  Loaded: { list: FailedEmails },
  Failed: { failure: Failure },
});

export type LoadedFailedEmails = typeof LoadedFailedEmails.Type;

export const FailedEmailResend = Schema.Union([
  Schema.TaggedStruct("Resending", {}),
  Schema.TaggedStruct("Resent", {
    state: EmailSendProgress,
    polls: Schema.Int,
    statusUnavailable: Schema.Boolean,
  }),
  Schema.TaggedStruct("Failed", { failure: Failure }),
]);

export type FailedEmailResend = typeof FailedEmailResend.Type;

export const FAILED_EMAIL_POLL_INTERVAL = "3 seconds";

export const FAILED_EMAIL_MAX_POLLS = 300;

export const failedEmailKeepsPolling = (state: EmailSendProgress, polls: number): boolean =>
  (state._tag === "Queued" || state._tag === "Sending") && polls < FAILED_EMAIL_MAX_POLLS;

export const formPanelClass =
  "mt-8 flex flex-col gap-4 rounded-panel border border-line bg-surface p-6 sm:p-8";

export const roleName = (role: TeamSummary["yourRole"]): string =>
  role === null ? "" : message(`role.${role}`);

export const decodeName = Schema.decodeUnknownOption(TeamName);

export const decodeZone = Schema.decodeUnknownOption(TimeZone);

export const decodeEmail = Schema.decodeUnknownOption(EmailAddress);

export const decodeSize = Schema.decodeUnknownOption(MinimumGroupSize);

export const decodePerson = Schema.decodeUnknownOption(PersonId);

export type NavSection = "teams" | "history" | "settings";

export interface ShellHeader<Message> {
  readonly organizationName: string;
  readonly organizationAdmin: boolean;
  readonly section: NavSection | null;

  readonly privacyCurrent: boolean;
  readonly navMenu: Popover.Model;
  readonly accountMenu: Popover.Model;
  readonly onNavMenu: (message: Popover.Message) => Message;
  readonly onAccountMenu: (message: Popover.Message) => Message;
}

export interface AttentionItem {
  readonly label: string;
  readonly text: string;
  readonly detail: string;
  readonly href: string;
}

export interface ChecklistStep {
  readonly text: string;
  readonly detail?: string | undefined;
  readonly href: string;
  readonly done: boolean;
}

export interface OffboardingForm {
  readonly open: boolean;
  readonly confirmation: string;
  readonly busy: boolean;
  readonly failure: Failure | undefined;
}
