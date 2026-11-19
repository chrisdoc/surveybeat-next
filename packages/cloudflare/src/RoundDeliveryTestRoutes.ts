import {
  calculateRoundInstants,
  EmailAddress,
  MembershipId,
  PersonId,
  PulseId,
  TeamId,
  TimeZone,
} from "@surveybeat/domain";
import type { Weekday } from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const ROUND_DELIVERY_TEST_ROUTE = "/__test/round-delivery";

const otherWeekday: Record<Weekday, Weekday> = {
  monday: "wednesday",
  tuesday: "wednesday",
  wednesday: "friday",
  thursday: "monday",
  friday: "tuesday",
  saturday: "monday",
  sunday: "thursday",
};

export const roundDeliveryTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `delivery-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
    const leadEmail = `lead-${run}@example.com`;
    const now = yield* Clock.currentTimeMillis;

    yield* organization.createWithAdmin(
      organizationId,
      "Acme",
      admin,
      `admin-${run}@example.com`,
      `user_${run}`,
    );
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "CreateTeam",
        teamId,
        name: "Engineering",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make(leadEmail),
          personId: PersonId.make(`lead-${run}`),
          membershipId: MembershipId.make(`membership-${run}`),
          signInUrl: "https://app.surveybeat.app/",
        },
      },
      now,
    );
    yield* organization.runPulseCommand(admin, { _tag: "CreatePulse", pulseId, teamId }, now);

    const detail = yield* organization.viewPulse(admin, teamId, pulseId);
    if (detail._tag !== "Viewed") {
      return yield* HttpServerResponse.json({ error: "no_pulse" });
    }
    const settings = detail.value.settings;
    const movedSettings = {
      ...settings,
      cadence: { ...settings.cadence, day: otherWeekday[settings.cadence.day] },
    };
    yield* organization.runPulseCommand(
      admin,
      { _tag: "UpdatePulseSettings", teamId, pulseId, settings: movedSettings },
      now,
    );

    const rounds = yield* organization.viewRounds(admin, teamId, pulseId);
    const round = rounds._tag === "Viewed" ? rounds.value.rounds[0] : undefined;
    if (round === undefined) {
      return yield* HttpServerResponse.json({ error: "no_round" });
    }
    const fromDate = calculateRoundInstants(
      round.plannedOpenDate,
      movedSettings.cadence.time,
      ["Europe/Berlin"],
      "Europe/Berlin",
      movedSettings.answerWindowDays,
    );

    const openJob = (yield* organization.getJobsForRound(round.id)).find((job) => job.type === "open");
    if (openJob === undefined) {
      return yield* HttpServerResponse.json({ error: "no_open_job" });
    }
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);
    const invitations = yield* organization.getInvitations(round.id);

    return yield* HttpServerResponse.json({
      leadEmail,
      plannedOpenAt: round.plannedOpenAt,
      openAtFromPlannedDate: fromDate.openInstant,
      invitationSendIds: invitations.map((invitation) => invitation.sendId),
    });
  }).pipe(Effect.orDie);
