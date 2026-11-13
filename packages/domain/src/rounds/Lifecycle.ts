// @effect-diagnostics globalDate:off -- every instant here arrives as an argument; these functions only parse and format it in a fixed time zone.

import type { PersonId } from "../people/Identity.ts";
import { actorOf, type DirectoryState } from "../people/Directory.ts";
import { type Actor, can, type TeamAction } from "../people/Permissions.ts";
import type { TeamId } from "../people/Team.ts";
import type { PulseId, SendTime, Weekday } from "../pulses/Pulse.ts";
import type { JobId, RoundId, RoundStatus, ScheduleJobStatus, ScheduleJobType } from "./Round.ts";

/** A member eligible to answer frozen when the Round opens. */
export interface FrozenRoundMember {
  readonly roundId: RoundId;
  readonly personId: PersonId;
  readonly timeZone: string;
  readonly sendAt: number;
}

/** One Round of a Pulse in state storage. */
export interface RoundRecord {
  readonly id: RoundId;
  readonly pulseId: PulseId;
  readonly teamId: TeamId;
  readonly status: RoundStatus;
  readonly plannedOpenDate: string;
  readonly plannedOpenAt: number;
  readonly openedAt: number | null;
  readonly plannedCloseAt: number;
  readonly closedAt: number | null;
  /** When the Review window ends (fixed at close); null for Rounds closed before it existed. */
  readonly reviewEndsAt: number | null;
  readonly effectiveMinimumGroupSize: number | null;
  readonly pulseName: string;
  readonly answerWindowDays: number;
  readonly reminders: number;
  readonly anonymityMode: "anonymous";
  readonly distribution: "invitation";
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A due job in the DO schedule table. */
export interface ScheduleJobRecord {
  readonly id: JobId;
  readonly roundId: RoundId;
  readonly type: ScheduleJobType;
  readonly dueAt: number;
  readonly status: ScheduleJobStatus;
  readonly payload: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

/** Pure time conversion: convert local date and time in an IANA time zone to UTC epoch ms. */
export const localToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number => {
  const targetLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  const getLocal = (utcMs: number) => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) {
      parts[p.type] = p.value;
    }
    let h = parseInt(parts.hour ?? "0", 10);
    if (h === 24) h = 0;
    return {
      year: parseInt(parts.year ?? "0", 10),
      month: parseInt(parts.month ?? "0", 10),
      day: parseInt(parts.day ?? "0", 10),
      hour: h,
      minute: parseInt(parts.minute ?? "0", 10),
    };
  };

  const toAsUtc = (l: { year: number; month: number; day: number; hour: number; minute: number }) =>
    Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, 0);

  const dayBeforeUtc = targetLocalAsUtc - 86_400_000;
  const dayAfterUtc = targetLocalAsUtc + 86_400_000;
  const offsetBefore = toAsUtc(getLocal(dayBeforeUtc)) - dayBeforeUtc;
  const offsetAfter = toAsUtc(getLocal(dayAfterUtc)) - dayAfterUtc;

  // In an overlap, earlier UTC instant wins (so larger offset first).
  const offsets = [offsetBefore, offsetAfter].sort((a, b) => b - a);

  for (const offset of offsets) {
    const candidateUtc = targetLocalAsUtc - offset;
    if (toAsUtc(getLocal(candidateUtc)) === targetLocalAsUtc) {
      return candidateUtc;
    }
  }

  // Spring-forward gap: time moves forward by the gap.
  const gap = Math.abs(offsetAfter - offsetBefore);
  const adjustedTargetAsUtc = targetLocalAsUtc + gap;
  return adjustedTargetAsUtc - offsetAfter;
};

const WEEKDAY_NUMBERS: Record<Weekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export const parseDateIso = (dateStr: string): { year: number; month: number; day: number } => {
  const parts = dateStr.split("-");
  const year = parseInt(parts[0] ?? "0", 10);
  const month = parseInt(parts[1] ?? "0", 10);
  const day = parseInt(parts[2] ?? "0", 10);
  return { year, month, day };
};

export const formatDateIso = (year: number, month: number, day: number): string =>
  `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

export const parseSendTime = (sendTime: SendTime): { hour: number; minute: number } => {
  const parts = sendTime.split(":");
  const hour = parseInt(parts[0] ?? "0", 10);
  const minute = parseInt(parts[1] ?? "0", 10);
  return { hour, minute };
};

/**
 * Returns the next date (YYYY-MM-DD) matching `weekday` on or strictly after the given calendar date.
 */
export const nextWeekdayDate = (
  fromYear: number,
  fromMonth: number,
  fromDay: number,
  targetWeekday: Weekday,
  includeToday: boolean,
): string => {
  const date = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));
  const currentWeekday = date.getUTCDay();
  const targetDayNum = WEEKDAY_NUMBERS[targetWeekday];

  let daysAhead = targetDayNum - currentWeekday;
  if (daysAhead < 0 || (daysAhead === 0 && !includeToday)) {
    daysAhead += 7;
  }
  const nextDate = new Date(date.getTime() + daysAhead * 86_400_000);
  return formatDateIso(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate());
};

/**
 * The next 8 occurrence dates of a cadence weekday starting after `nowMs`.
 */
export const nextEightWeeksCadenceDates = (
  nowMs: number,
  weekday: Weekday,
  timeZone: string,
): ReadonlyArray<string> => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(nowMs))) {
    parts[p.type] = p.value;
  }
  const curYear = parseInt(parts.year ?? "0", 10);
  const curMonth = parseInt(parts.month ?? "0", 10);
  const curDay = parseInt(parts.day ?? "0", 10);

  const firstDate = nextWeekdayDate(curYear, curMonth, curDay, weekday, true);
  const firstParsed = parseDateIso(firstDate);
  const firstDateObj = new Date(Date.UTC(firstParsed.year, firstParsed.month - 1, firstParsed.day));

  const result: Array<string> = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(firstDateObj.getTime() + i * 7 * 86_400_000);
    result.push(formatDateIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return result;
};

/**
 * Calculates open instant, latest send instant, and close instant for a Round.
 */
export const calculateRoundInstants = (
  targetDateStr: string,
  sendTime: SendTime,
  memberTimeZones: ReadonlyArray<string>,
  fallbackTimeZone: string,
  answerWindowDays: number,
): {
  readonly openInstant: number;
  readonly latestSendInstant: number;
  readonly closeInstant: number;
  readonly sends: ReadonlyArray<{ readonly timeZone: string; readonly sendAt: number }>;
} => {
  const { year, month, day } = parseDateIso(targetDateStr);
  const { hour, minute } = parseSendTime(sendTime);

  const timeZonesToUse = memberTimeZones.length > 0 ? memberTimeZones : [fallbackTimeZone];

  const sends = timeZonesToUse.map((tz) => ({
    timeZone: tz,
    sendAt: localToUtc(year, month, day, hour, minute, tz),
  }));

  const sendTimes = sends.map((s) => s.sendAt);
  const openInstant = Math.min(...sendTimes);
  const latestSendInstant = Math.max(...sendTimes);
  const closeInstant = latestSendInstant + answerWindowDays * 24 * 3600_000;

  return {
    openInstant,
    latestSendInstant,
    closeInstant,
    sends,
  };
};

/**
 * Calculates reminders for a member within their answer window.
 * - one reminder: day W-1
 * - two reminders: day 1 and day W-1 (only one if they fall on the same day)
 * - W = 1: one reminder 6 hours after send
 * Skipped if within 2 hours of close.
 */
export const calculateReminders = (
  sendInstant: number,
  answerWindowDays: number,
  remindersCount: number,
  closeInstant: number,
): ReadonlyArray<number> => {
  if (remindersCount <= 0) return [];

  const candidates: Array<number> = [];
  if (answerWindowDays === 1) {
    candidates.push(sendInstant + 6 * 3600_000);
  } else if (remindersCount === 1) {
    candidates.push(sendInstant + (answerWindowDays - 1) * 24 * 3600_000);
  } else if (remindersCount === 2) {
    candidates.push(sendInstant + 1 * 24 * 3600_000);
    const dayWMinusOne = sendInstant + (answerWindowDays - 1) * 24 * 3600_000;
    if (dayWMinusOne !== candidates[0]) {
      candidates.push(dayWMinusOne);
    }
  }

  // A reminder is skipped if it would fall within 2 hours of close.
  const cutoff = closeInstant - 2 * 3600_000;
  return candidates.filter((time) => time < cutoff);
};

/**
 * Calculates delivery time for results-ready email (Issue #46):
 * right away if current local time is between 08:00 and 20:00, otherwise at their next 08:00.
 */
export const calculateResultsReadyDeliveryTime = (nowMs: number, timeZone: string): number => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(nowMs))) {
    parts[p.type] = p.value;
  }
  let h = parseInt(parts.hour ?? "0", 10);
  if (h === 24) h = 0;
  const year = parseInt(parts.year ?? "0", 10);
  const month = parseInt(parts.month ?? "0", 10);
  const day = parseInt(parts.day ?? "0", 10);

  // Between 08:00 and 20:00 local time: send right away (nowMs)
  if (h >= 8 && h < 20) {
    return nowMs;
  }

  // Before 08:00: next 08:00 is today at 08:00
  if (h < 8) {
    return localToUtc(year, month, day, 8, 0, timeZone);
  }

  // At or after 20:00: next 08:00 is tomorrow at 08:00
  const tomorrowUtc = Date.UTC(year, month - 1, day) + 86_400_000;
  const tomDate = new Date(tomorrowUtc);
  return localToUtc(
    tomDate.getUTCFullYear(),
    tomDate.getUTCMonth() + 1,
    tomDate.getUTCDate(),
    8,
    0,
    timeZone,
  );
};

export type RoundCommand =
  | {
      readonly _tag: "SkipWeek";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly plannedOpenDate: string;
    }
  | {
      readonly _tag: "UnskipWeek";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly plannedOpenDate: string;
    }
  | {
      readonly _tag: "PausePulse";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
    }
  | {
      readonly _tag: "ResumePulse";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
    }
  | {
      readonly _tag: "CloseRoundEarly";
      readonly teamId: TeamId;
      readonly roundId: RoundId;
    }
  | {
      readonly _tag: "ShareResults";
      readonly teamId: TeamId;
      readonly roundId: RoundId;
    }
  | {
      readonly _tag: "RetryResult";
      readonly teamId: TeamId;
      readonly roundId: RoundId;
    }
  | {
      readonly _tag: "CancelRound";
      readonly teamId: TeamId;
      readonly roundId: RoundId;
    }
  | {
      readonly _tag: "ResendInvitation";
      readonly teamId: TeamId;
      readonly roundId: RoundId;
      readonly personId: PersonId;
    };

export type RoundRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "PulseNotFound" }
  | { readonly _tag: "RoundNotFound" }
  | { readonly _tag: "RoundNotOpen" }
  | { readonly _tag: "InvalidRoundState"; readonly status: RoundStatus }
  | { readonly _tag: "WeekOutOfRange" }
  | { readonly _tag: "InvitationNotFound" };

/** An HMAC key from `importInvitationTokenKey`. The domain has no DOM or Workers types; the runtime provides the real one. */
export interface InvitationTokenKey {
  readonly type: string;
}

declare const crypto: {
  readonly subtle: {
    readonly digest: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
    readonly importKey: (
      format: "raw",
      keyData: Uint8Array,
      algorithm: { readonly name: "HMAC"; readonly hash: "SHA-256" },
      extractable: boolean,
      usages: ReadonlyArray<"sign">,
    ) => Promise<InvitationTokenKey>;
    readonly sign: (algorithm: "HMAC", key: InvitationTokenKey, data: Uint8Array) => Promise<ArrayBuffer>;
  };
};

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const base64url = (bytes: Uint8Array): string => {
  let result = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = i + 1 < len ? (bytes[i + 1] ?? 0) : 0;
    const b2 = i + 2 < len ? (bytes[i + 2] ?? 0) : 0;

    result += B64_CHARS[(b0 >> 2) & 0x3f];
    result += B64_CHARS[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f)];
    if (i + 1 < len) {
      result += B64_CHARS[((b1 & 0x0f) << 2) | ((b2 >> 6) & 0x03)];
    }
    if (i + 2 < len) {
      result += B64_CHARS[b2 & 0x3f];
    }
  }
  return result;
};

/** Which Invitation a token belongs to. `generation` is the Invitation's `resend_count`: Resend bumps it. */
export interface InvitationTokenRef {
  readonly roundId: string;
  readonly personId: string;
  readonly generation: number;
}

/** Imports the per-stage secret as an HMAC key. The secret never leaves the Worker environment. */
export const importInvitationTokenKey = (secret: string): Promise<InvitationTokenKey> =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);

/**
 * The 128-bit unguessable base64url token of an Invitation (ADR 0005, issue 42). It is derived, not
 * stored: only its hash is persisted, and whoever needs the token (the Queue consumer rendering the
 * email) derives it again from the key and the reference. A Resend bumps `generation`, so the old
 * link stops working exactly as before.
 */
export const deriveInvitationToken = (key: InvitationTokenKey, ref: InvitationTokenRef): Promise<string> =>
  crypto.subtle
    .sign(
      "HMAC",
      key,
      new TextEncoder().encode(`invitation:v1:${ref.roundId}:${ref.personId}:${ref.generation}`),
    )
    .then((mac: ArrayBuffer) => base64url(new Uint8Array(mac).slice(0, 16)));

/** Which test Invitation a token belongs to. `testId` is random per send (ADR 0021). */
export interface TestInvitationTokenRef {
  readonly pulseId: string;
  readonly personId: string;
  readonly testId: string;
}

/**
 * The 128-bit base64url token of a test Invitation (ADR 0021, issue 136). It has its own label, so it
 * can never equal an Invitation token, and it is derived with the same key, never stored. Only its hash
 * is persisted, in `test_invitation_index`.
 */
export const deriveTestInvitationToken = (
  key: InvitationTokenKey,
  ref: TestInvitationTokenRef,
): Promise<string> =>
  crypto.subtle
    .sign(
      "HMAC",
      key,
      new TextEncoder().encode(`test-invitation:v1:${ref.pulseId}:${ref.personId}:${ref.testId}`),
    )
    .then((mac: ArrayBuffer) => base64url(new Uint8Array(mac).slice(0, 16)));

/** Computes the hex-encoded SHA-256 hash of a token for storage and lookup. */
export const hashToken = (token: string): Promise<string> =>
  crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(token))
    .then((buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""),
    );

export type RoundDecision<A> =
  | { readonly _tag: "Rejected"; readonly rejection: RoundRejection }
  | { readonly _tag: "Accepted"; readonly value: A };

const reject = (rejection: RoundRejection) => ({ _tag: "Rejected", rejection }) as const;

/** Authorizes `action` on the Team via the permission table. */
export const authorizeRoundAction = (
  directory: DirectoryState,
  actorId: PersonId,
  action: TeamAction,
  teamId: TeamId,
):
  | { readonly _tag: "Rejected"; readonly rejection: RoundRejection }
  | { readonly _tag: "Allowed"; readonly actor: Actor } => {
  const actor = actorOf(directory, actorId);
  if (actor._tag === "None" || !can(actor.value, action, { _tag: "Team", teamId })) {
    return reject({ _tag: "Forbidden" });
  }
  if (!directory.teams.some((team) => team.id === teamId)) {
    return reject({ _tag: "TeamNotFound" });
  }
  return { _tag: "Allowed", actor: actor.value };
};
