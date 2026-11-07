import {
  EmailAddress,
  MembershipId,
  PersonId,
  PulseId,
  type PulseCommand,
  QuestionId,
  SendTime,
  TeamId,
  TemplateQuestionKey,
  TimeZone,
} from "@surveybeat/domain";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Organizations } from "./EmailDelivery.ts";

export const PULSES_TEST_ROUTE = "/__test/pulses";

/**
 * Test stages only (`isTestStage`): runs the Pulse editor against a real Organization Durable
 * Object, so `Organization.test.ts` checks the SQL of the question library and Pulses on local
 * workerd. An admin creates a Team and a Pulse, then edits it; the answer is what each step left.
 */
export const pulseTestRoutes = (organizations: Organizations) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    const run = new URL(request.url, "http://localhost").searchParams.get("run") ?? "";
    const organizationId = `pulses-${run}`;
    const organization = organizations.getByName(organizationId);
    const admin = PersonId.make(`admin-${run}`);
    const teamId = TeamId.make(`team-${run}`);
    const pulseId = PulseId.make(`pulse-${run}`);
    const now = 1_700_000_000_000;

    yield* organization.createWithAdmin(organizationId, "Acme", admin, "admin@example.com", `user_${run}`);
    yield* organization.runDirectoryCommand(
      admin,
      {
        _tag: "CreateTeam",
        teamId,
        name: "Platform",
        timeZone: TimeZone.make("Europe/Berlin"),
        lead: {
          email: EmailAddress.make("grace@example.com"),
          personId: PersonId.make(`grace-${run}`),
          membershipId: MembershipId.make(`membership-${run}`),
          signInUrl: "https://app.surveybeat.app/",
        },
      },
      now,
    );

    const step = (command: PulseCommand) =>
      Effect.map(organization.runPulseCommand(admin, command, now), (result) =>
        result._tag === "Accepted" ? "Accepted" : result.rejection._tag,
      );
    const target = { teamId, pulseId };
    const questionIds = () =>
      Effect.map(organization.viewPulse(admin, teamId, pulseId), (view) =>
        view._tag === "Viewed" ? view.value.questions.map((question) => question.questionId) : [],
      );

    const created = yield* step({ _tag: "CreatePulse", ...target });
    const [first, ...rest] = yield* questionIds();
    const firstId = first ?? QuestionId.make("none");
    const results = {
      created,
      createdAgain: yield* step({ _tag: "CreatePulse", ...target }),
      removed: yield* step({ _tag: "RemoveQuestion", ...target, questionId: firstId }),
      reordered: yield* step({ _tag: "ReorderQuestions", ...target, order: [...rest].reverse() }),
      addedBack: yield* step({
        _tag: "AddQuestion",
        ...target,
        questionId: QuestionId.make(`again-${run}`),
        question: { _tag: "FromTemplate", key: TemplateQuestionKey.make("workload-manageable") },
      }),
      addedWritten: yield* step({
        _tag: "AddQuestion",
        ...target,
        questionId: QuestionId.make(`written-${run}`),
        question: {
          _tag: "Written",
          text: "Which ritual should we drop?",
          dimension: null,
          type: { _tag: "SingleChoice", options: ["Stand-up", "Retro"] },
        },
      }),
      edited: yield* step({
        _tag: "EditQuestion",
        ...target,
        questionId: QuestionId.make(`written-${run}`),
        content: {
          text: "How was the offsite?",
          dimension: "recognition",
          type: { _tag: "Rating", lowLabel: "Poor", highLabel: "Great", comment: true },
        },
      }),
      settings: yield* step({
        _tag: "UpdatePulseSettings",
        ...target,
        settings: {
          name: "Friday check-in",
          cadence: { _tag: "Weekly", day: "friday", time: SendTime.make("15:30") },
          answerWindowDays: 6,
          reminders: 0,
          anonymityMode: "anonymous",
          distribution: "invitation",
        },
      }),
      reorderMismatch: yield* step({ _tag: "ReorderQuestions", ...target, order: rest }),
    };
    const view = yield* organization.viewPulse(admin, teamId, pulseId);
    const list = yield* organization.viewPulses(admin, teamId);
    return yield* HttpServerResponse.json({ results, view, list, first: firstId, rest });
  }).pipe(Effect.orDie);
