import {
  EmailAddress,
  MembershipId,
  PersonId,
  PulseId,
  type RoundResult,
  RoundId,
  TeamId,
  TimeZone,
  type RoundViewed,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";
import { setReviewWindowDays } from "./ReviewWindowTestRoutes.ts";

export const THEMES_TEST_ROUTE = "/__test/themes";

const viewedValue = (viewed: RoundViewed<RoundResult>): RoundResult | null =>
  viewed._tag === "Viewed" ? viewed.value : null;

export const themesTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const aiKey = yield* Config.Redacted("OPENROUTER_API_KEY").pipe(
      Config.withDefault(Redacted.make("")),
      Effect.orDie,
    );
    if (Redacted.value(aiKey) !== "") {
      return yield* HttpServerResponse.json({ error: "ai_key_configured" });
    }

    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const now = yield* Clock.currentTimeMillis;

    const withAi = yield* scenario(organizations, `${run}-on`, true, now);
    const withoutAi = yield* scenario(organizations, `${run}-off`, false, now);

    return yield* HttpServerResponse.json({ withAi, withoutAi });
  });

const scenario = (organizations: Organizations, label: string, aiProcessing: boolean, now: number) =>
  Effect.gen(function* () {
    const organizationId = `themes-${label}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${label}`);
    const lead = PersonId.make(`lead-${label}`);
    const member = PersonId.make(`member-${label}`);
    const otherMember = PersonId.make(`other-${label}`);
    const teamId = TeamId.make(`team-${label}`);
    const pulseId = PulseId.make(`pulse-${label}`);
    const signInUrl = "https://app.surveybeat.app/";

    yield* organization.createWithAdmin(
      organizationId,
      "Acme",
      admin,
      `admin-${label}@example.com`,
      `user_admin_${label}`,
    );
    yield* organization.runDirectoryCommand(
      admin,
      { _tag: "UpdateSettings", minimumGroupSize: 3, aiProcessing },
      now,
    );
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "CreateTeam",
        teamId,
        name: "Engineering",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make(`lead-${label}@example.com`),
          personId: lead,
          membershipId: MembershipId.make(`membership-lead-${label}`),
          signInUrl,
        },
      },
      now,
    );
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "AddMember",
        teamId,
        role: "member",
        member: {
          email: EmailAddress.make(`member-${label}@example.com`),
          personId: member,
          membershipId: MembershipId.make(`membership-member-${label}`),
          signInUrl,
        },
      },
      now,
    );
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "AddMember",
        teamId,
        role: "member",
        member: {
          email: EmailAddress.make(`other-${label}@example.com`),
          personId: otherMember,
          membershipId: MembershipId.make(`membership-other-${label}`),
          signInUrl,
        },
      },
      now,
    );
    yield* organization.runPulseCommand(admin, { _tag: "CreatePulse", pulseId, teamId }, now);
    yield* setReviewWindowDays(organization, admin, teamId, pulseId, 0, now);

    const listed = yield* organization.viewRounds(admin, teamId, pulseId);
    const roundId = RoundId.make(listed._tag === "Viewed" ? (listed.value.rounds[0]?.id ?? "") : "");

    const openJob = (yield* organization.getJobsForRound(roundId)).find((job) => job.type === "open");
    if (openJob === undefined) {
      return { error: "no_open_job" };
    }
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);

    const context = yield* organization.getSubmissionRoundContext(roundId, lead);
    const questions = context?.questions ?? [];
    const firstRating = questions.find((question) => question.type._tag === "Rating");
    for (const [index, person] of [lead, member, otherMember].entries()) {
      yield* organization.recordFirstAnswer(
        roundId,
        person,
        `edit-${label}-${index}`,
        questions.map((question) => ({
          questionVersionId: question.id,
          value: question.type._tag === "Rating" ? 4 : null,
          comment: question.id === firstRating?.id ? `Comment ${index} on ${label}` : null,
        })),
      );
    }

    const closeJob = (yield* organization.getJobsForRound(roundId)).find((job) => job.type === "close");
    if (closeJob === undefined) {
      return { error: "no_close_job" };
    }
    yield* organization.runScheduleJob(closeJob.id, closeJob.due_at);
    const jobsAfterClose = yield* organization.getJobsForRound(roundId);
    const themesJob = jobsAfterClose.find((job) => job.type === "themes");

    yield* organization.runDueJobs(closeJob.due_at);
    const jobsAfterRun = yield* organization.getJobsForRound(roundId);
    const themesJobAfterRun = jobsAfterRun.find((job) => job.type === "themes");
    const stored = yield* organization.getRoundThemes(roundId);

    const leadView = viewedValue(yield* organization.viewResults(lead, teamId, roundId));
    const memberView = viewedValue(yield* organization.viewResults(member, teamId, roundId));

    return {
      themesJobExisted: themesJob !== undefined,
      themesJobCompleted: themesJobAfterRun?.status === "completed",
      storedStatus: stored?.status ?? null,
      leadThemesStatus: leadView?.themesStatus ?? null,
      leadHasDiscussionGuideKey: leadView !== null && "discussionGuide" in leadView,
      leadDiscussionGuide: leadView?.discussionGuide ?? null,
      leadHasComments: (leadView?.comments.length ?? 0) > 0,
      memberThemesStatus: memberView?.themesStatus ?? null,
      memberHasDiscussionGuideKey: memberView !== null && "discussionGuide" in memberView,
      memberThemes: memberView?.themes ?? null,
      memberHasComments: (memberView?.comments.length ?? 0) > 0,
    };
  });
