import {
  EmailAddress,
  MembershipId,
  PersonId,
  PulseId,
  type RoundCommandResult,
  type RoundResult,
  RoundId,
  TeamId,
  TimeZone,
} from "@surveybeat/domain";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const REVIEW_TEST_ROUTE = "/__test/review";

const DAY_MS = 86_400_000;

type OrganizationStub = ReturnType<Organizations["getByName"]>;

/** Sets the Pulse's Review window in days, keeping its other settings (test stages only). */
export const setReviewWindowDays = (
  organization: OrganizationStub,
  admin: PersonId,
  teamId: TeamId,
  pulseId: PulseId,
  days: number,
  now: number,
) =>
  Effect.gen(function* () {
    const detail = yield* organization.viewPulse(admin, teamId, pulseId);
    if (detail._tag !== "Viewed") return;
    yield* organization.runPulseCommand(
      admin,
      {
        _tag: "UpdatePulseSettings",
        teamId,
        pulseId,
        settings: { ...detail.value.settings, reviewWindowDays: days },
      },
      now,
    );
  });

/** The people and Pulse of one scenario: a Lead, two members, and an admin, with one Pulse in one Team. */
interface People {
  readonly organization: OrganizationStub;
  readonly admin: PersonId;
  readonly lead: PersonId;
  readonly member: PersonId;
  readonly otherMember: PersonId;
  readonly teamId: TeamId;
  readonly pulseId: PulseId;
}

/** The People, and one Round of their Pulse (the one the scenario drives). */
export interface Cast extends People {
  readonly roundId: RoundId;
  readonly closeJobId: string;
  readonly closeDue: number;
}

/**
 * One Organization with a Lead, two members, and N = 3, AI processing off, and one Pulse with the Review window
 * `windowDays`. Creating the Pulse schedules its first Round.
 */
const setUpPulse = (organizations: Organizations, label: string, windowDays: number, now: number) =>
  Effect.gen(function* () {
    const organizationId = `review-${label}`;
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
      { _tag: "UpdateSettings", minimumGroupSize: 3, aiProcessing: false },
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
    yield* setReviewWindowDays(organization, admin, teamId, pulseId, windowDays, now);

    const people: People = { organization, admin, lead, member, otherMember, teamId, pulseId };
    return people;
  });

/** The Round of a Pulse with `status`, or the first one listed when none is given (the Pulse's first Round). */
const roundOf = (people: People, status: string | null) =>
  Effect.gen(function* () {
    const listed = yield* people.organization.viewRounds(people.admin, people.teamId, people.pulseId);
    const rounds = listed._tag === "Viewed" ? listed.value.rounds : [];
    const match = status === null ? rounds[0] : rounds.find((round) => round.status === status);
    if (match === undefined) return yield* Effect.die(new Error(`no ${status ?? "first"} round`));
    return RoundId.make(match.id);
  });

/**
 * Opens a Round, has the three people answer (so it meets N), and returns its close job. Each answer is keyed
 * by `tag`, so two Rounds of one Pulse never share an edit id.
 */
const openAndAnswer = (people: People, roundId: RoundId, tag: string) =>
  Effect.gen(function* () {
    const { organization, lead, member, otherMember } = people;
    const openJob = (yield* organization.getJobsForRound(roundId)).find((job) => job.type === "open");
    if (openJob === undefined) return yield* Effect.die(new Error("no open job"));
    yield* organization.runScheduleJob(openJob.id, openJob.due_at);

    const context = yield* organization.getSubmissionRoundContext(roundId, lead);
    const questions = context?.questions ?? [];
    const firstRating = questions.find((question) => question.type._tag === "Rating");
    for (const [index, person] of [lead, member, otherMember].entries()) {
      yield* organization.recordFirstAnswer(
        roundId,
        person,
        `edit-${tag}-${index}`,
        questions.map((question) => ({
          questionVersionId: question.id,
          value: question.type._tag === "Rating" ? 4 : null,
          comment: question.id === firstRating?.id ? `Comment ${index} on ${tag}` : null,
        })),
      );
    }

    const closeJob = (yield* organization.getJobsForRound(roundId)).find((job) => job.type === "close");
    if (closeJob === undefined) return yield* Effect.die(new Error("no close job"));
    const cast: Cast = { ...people, roundId, closeJobId: closeJob.id, closeDue: closeJob.due_at };
    return cast;
  });

/** A Pulse's first Round, opened and answered, not yet closed. */
export const openedRound = (organizations: Organizations, label: string, windowDays: number, now: number) =>
  Effect.gen(function* () {
    const people = yield* setUpPulse(organizations, label, windowDays, now);
    return yield* openAndAnswer(people, yield* roundOf(people, null), label);
  });

/** A Pulse's first Round, opened, answered, and closed: Ready with a window above 0, Shared with 0. */
const closedRound = (organizations: Organizations, label: string, windowDays: number, now: number) =>
  Effect.gen(function* () {
    const cast = yield* openedRound(organizations, label, windowDays, now);
    yield* cast.organization.runScheduleJob(cast.closeJobId, cast.closeDue);
    return cast;
  });

/** The Round's jobs of one type, as the schedule table holds them. */
export const jobsOfType = (cast: Cast, type: string) =>
  Effect.map(cast.organization.getJobsForRound(cast.roundId), (jobs) =>
    jobs.filter((job) => job.type === type),
  );

/** Who has a results-ready email scheduled for this Round, by role name, sorted. */
const resultsReadyFor = (cast: Cast) =>
  Effect.map(cast.organization.getJobsForRound(cast.roundId), (jobs) => {
    const prefix = `results-ready-${cast.roundId}-`;
    const roleOf = (personId: string) =>
      personId === cast.lead
        ? "lead"
        : personId === cast.member
          ? "member"
          : personId === cast.otherMember
            ? "other"
            : personId;
    return jobs
      .filter((job) => job.type === "send" && job.id.startsWith(prefix))
      .map((job) => roleOf(job.id.slice(prefix.length)))
      .sort();
  });

export const viewOf = (cast: Cast, person: PersonId) =>
  Effect.map(cast.organization.viewResults(person, cast.teamId, cast.roundId), (viewed): RoundResult | null =>
    viewed._tag === "Viewed" ? viewed.value : null,
  );

const hasNote = (cast: Cast, person: PersonId) =>
  Effect.map(
    cast.organization.viewRoundNote(person, cast.teamId, cast.roundId),
    (viewed) => viewed._tag === "Viewed" && viewed.value.note !== null,
  );

export const statusOf = (cast: Cast) =>
  Effect.map(cast.organization.getRound(cast.roundId), (round) => round?.status ?? null);

/** "Accepted", or the rejection's tag. */
export const commandOutcome = (result: RoundCommandResult) =>
  result._tag === "Accepted" ? "Accepted" : result.rejection._tag;

const shareCommand = (cast: Cast, actor: PersonId, now: number) =>
  Effect.map(
    cast.organization.runRoundCommand(
      actor,
      { _tag: "ShareResults", teamId: cast.teamId, roundId: cast.roundId },
      now,
    ),
    commandOutcome,
  );

/** What a viewer sees of a Result: its status, which Result sections it carries, and whether its Review window end is the share job's due time. */
const viewSummary = (view: RoundResult | null, shareDue: number | undefined) => ({
  status: view?.status ?? null,
  seesQuestions: (view?.questions.length ?? 0) > 0,
  seesDimensions: (view?.dimensions.length ?? 0) > 0,
  seesComments: (view?.comments.length ?? 0) > 0,
  seesGuideKey: view !== null && "discussionGuide" in view,
  reviewEndsAtIsShareDue: shareDue !== undefined && view?.reviewEndsAt === shareDue,
});

/**
 * Test stages only (`isTestStage`): the Review window (issue 106) on a real Organization Durable Object and
 * local workerd. Three Organizations, each with a Lead, two members, N = 3, and AI off:
 * - window 0: the Round is shared at close (R1 behaviour): no share job, every Person gets a results-ready email.
 * - window 3, shared by hand: the Round is Ready at close; the share job is due three days later; only the
 *   Lead has a results-ready email; members see no Result data; the Lead shares it twice (both Accepted);
 *   a member and an admin are Forbidden; afterwards the share job is cancelled and the members have emails.
 * - window 3, shared by the window's end: changing the Pulse's window after close does not move the share job;
 *   running the share job twice and then the due jobs shares the Round once.
 */
export const reviewTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const now = yield* Clock.currentTimeMillis;

    // Window 0: shared at once.
    const zero = yield* closedRound(organizations, `${run}-zero`, 0, now);
    const zeroView = yield* viewOf(zero, zero.member);
    const zeroSummary = {
      roundStatus: yield* statusOf(zero),
      shareJobs: (yield* jobsOfType(zero, "share")).length,
      resultsReadyFor: yield* resultsReadyFor(zero),
      memberSeesQuestions: (zeroView?.questions.length ?? 0) > 0,
    };

    // Window 3, shared by the Lead.
    const manual = yield* closedRound(organizations, `${run}-manual`, 3, now);
    const manualShare = (yield* jobsOfType(manual, "share"))[0];
    if (manualShare === undefined) return yield* Effect.die(new Error("no share job"));
    // Read before any share command runs, so the summary shows the Round as it was at close.
    const roundBefore = yield* statusOf(manual);
    const resultsReadyBefore = yield* resultsReadyFor(manual);
    const leadBefore = yield* viewOf(manual, manual.lead);
    const memberBefore = yield* viewOf(manual, manual.member);
    // The Lead's Note: the Lead sees it during the Review window, a member only once the Round is Shared.
    yield* manual.organization.saveRoundNote(
      manual.lead,
      manual.teamId,
      manual.roundId,
      "Talk on Monday",
      now,
    );
    const leadSeesNoteBefore = yield* hasNote(manual, manual.lead);
    const memberSeesNoteBefore = yield* hasNote(manual, manual.member);
    const memberCommand = yield* shareCommand(manual, manual.member, now);
    const adminCommand = yield* shareCommand(manual, manual.admin, now);
    const leadFirstShare = yield* shareCommand(manual, manual.lead, manual.closeDue);
    const leadSecondShare = yield* shareCommand(manual, manual.lead, manual.closeDue);
    const leadAfter = yield* viewOf(manual, manual.lead);
    const memberAfter = yield* viewOf(manual, manual.member);
    const memberSeesNoteAfter = yield* hasNote(manual, manual.member);
    const manualSummary = {
      roundStatus: roundBefore,
      shareJobDueDays: (manualShare.due_at - manual.closeDue) / DAY_MS,
      shareJobStatus: manualShare.status,
      resultsReadyBefore,
      leadView: viewSummary(leadBefore, manualShare.due_at),
      memberView: viewSummary(memberBefore, manualShare.due_at),
      memberCommand,
      adminCommand,
      leadFirstShare,
      leadSecondShare,
      roundStatusAfterShare: yield* statusOf(manual),
      shareJobStatusAfterShare: (yield* jobsOfType(manual, "share"))[0]?.status ?? null,
      resultsReadyAfter: yield* resultsReadyFor(manual),
      leadViewAfter: viewSummary(leadAfter, manualShare.due_at),
      memberViewAfter: viewSummary(memberAfter, manualShare.due_at),
      leadSeesNoteBefore,
      memberSeesNoteBefore,
      memberSeesNoteAfter,
    };

    // Window 3, shared when the window ends: a later change to the Pulse does not move the share job.
    const auto = yield* closedRound(organizations, `${run}-auto`, 3, now);
    // Changed at the close, the Organization's clock: an earlier `now` would re-plan the next Round into the past.
    yield* setReviewWindowDays(auto.organization, auto.admin, auto.teamId, auto.pulseId, 7, auto.closeDue);
    const autoShare = (yield* jobsOfType(auto, "share"))[0];
    if (autoShare === undefined) return yield* Effect.die(new Error("no share job"));
    const autoBefore = {
      roundStatus: yield* statusOf(auto),
      shareJobDueDays: (autoShare.due_at - auto.closeDue) / DAY_MS,
    };
    yield* auto.organization.runScheduleJob(autoShare.id, autoShare.due_at);
    yield* auto.organization.runScheduleJob(autoShare.id, autoShare.due_at);
    yield* auto.organization.runDueJobs(autoShare.due_at);
    const autoView = yield* viewOf(auto, auto.member);
    const autoSummary = {
      ...autoBefore,
      roundStatusAfterWindow: yield* statusOf(auto),
      shareJobStatusAfterWindow: (yield* jobsOfType(auto, "share"))[0]?.status ?? null,
      resultsReadyAfter: yield* resultsReadyFor(auto),
      memberSeesQuestionsAfter: (autoView?.questions.length ?? 0) > 0,
    };

    // Cascade: Round A is Ready, then the Pulse's next Round B is also Ready. The Lead shares B, which shares A too.
    const cascade = yield* closedRound(organizations, `${run}-cascade`, 7, now);
    const roundA = cascade.roundId;
    const roundB = yield* roundOf(cascade, "scheduled");
    const closingB = yield* openAndAnswer(cascade, roundB, `${run}-cascade-b`);
    yield* cascade.organization.runScheduleJob(closingB.closeJobId, closingB.closeDue);
    const roundBCast: Cast = {
      ...cascade,
      roundId: roundB,
      closeJobId: closingB.closeJobId,
      closeDue: closingB.closeDue,
    };
    const sharedB = yield* shareCommand(roundBCast, cascade.lead, closingB.closeDue);
    const roundSummary = (cast: Cast) =>
      Effect.gen(function* () {
        return {
          roundStatus: yield* statusOf(cast),
          shareJobStatus: (yield* jobsOfType(cast, "share"))[0]?.status ?? null,
          resultsReadyFor: yield* resultsReadyFor(cast),
        };
      });
    const cascadeSummary = {
      shareCommand: sharedB,
      roundA: yield* roundSummary({ ...cascade, roundId: roundA }),
      roundB: yield* roundSummary(roundBCast),
    };

    // Close early: a Lead closes an Open Round of a window-2 Pulse; the share job is due two days after closing.
    const early = yield* openedRound(organizations, `${run}-early`, 2, now);
    const openedRoundRecord = yield* early.organization.getRound(early.roundId);
    const openedAt = openedRoundRecord?.openedAt ?? null;
    if (openedAt === null) return yield* Effect.die(new Error("round not open"));
    const closeEarly = yield* early.organization.runRoundCommand(
      early.lead,
      { _tag: "CloseRoundEarly", teamId: early.teamId, roundId: early.roundId },
      openedAt + DAY_MS,
    );
    const earlyRound = yield* early.organization.getRound(early.roundId);
    const earlyShare = (yield* jobsOfType(early, "share"))[0];
    const closeEarlySummary = {
      command: commandOutcome(closeEarly),
      roundStatus: earlyRound?.status ?? null,
      shareJobStatus: earlyShare?.status ?? null,
      shareJobDueDays:
        earlyShare === undefined || earlyRound?.closedAt === null || earlyRound?.closedAt === undefined
          ? null
          : (earlyShare.due_at - earlyRound.closedAt) / DAY_MS,
    };

    return yield* HttpServerResponse.json({
      zero: zeroSummary,
      manual: manualSummary,
      auto: autoSummary,
      cascade: cascadeSummary,
      closeEarly: closeEarlySummary,
    });
  });
