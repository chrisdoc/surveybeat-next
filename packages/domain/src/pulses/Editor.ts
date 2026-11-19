import { Option } from "effect";
import type { SendState } from "../email/SendState.ts";
import { Policy } from "../Policy.ts";
import { actorOf, emailLocaleOf, teamSummaryOf } from "../people/Directory.ts";
import type { DirectoryState, PersonRecord } from "../people/Directory.ts";
import type { PersonId } from "../people/Identity.ts";
import type { Locale } from "../people/Locale.ts";
import { can } from "../people/Permissions.ts";
import type { Actor, TeamAction } from "../people/Permissions.ts";
import type { TeamId } from "../people/Team.ts";
import {
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  RECOMMENDED_MAX_SECONDS,
  SendTime,
  testInvitationLifetimeMs,
} from "./Pulse.ts";
import type {
  PulseDetail,
  PulseId,
  PulseList,
  PulseQuestion,
  PulseSettings,
  PulseWarning,
  NewPulseQuestion,
  TestSendStatus,
} from "./Pulse.ts";
import { firstVersionId, QuestionId } from "./Question.ts";
import type { QuestionContent, QuestionType, QuestionVersionId } from "./Question.ts";
import { templateQuestion, weeklyTeamHealth } from "./Template.ts";
import type { TemplateQuestionKey } from "./Template.ts";

export interface QuestionRecord {
  readonly id: QuestionId;

  readonly templateKey: TemplateQuestionKey | null;
  readonly createdAt: number;
}

export interface QuestionVersionRecord {
  readonly id: QuestionVersionId;
  readonly questionId: QuestionId;
  readonly number: number;
  readonly content: QuestionContent;
}

export interface PulseRecord {
  readonly id: PulseId;
  readonly teamId: TeamId;
  readonly settings: PulseSettings;
  readonly createdAt: number;

  readonly questions: readonly QuestionVersionId[];
}

export interface PulseState {
  readonly questions: readonly QuestionRecord[];
  readonly versions: readonly QuestionVersionRecord[];
  readonly pulses: readonly PulseRecord[];

  readonly answered: readonly QuestionVersionId[];
}

export const EMPTY_PULSE_STATE: PulseState = { questions: [], versions: [], pulses: [], answered: [] };

export type PulseCommand =
  | { readonly _tag: "CreatePulse"; readonly teamId: TeamId; readonly pulseId: PulseId }
  | {
      readonly _tag: "UpdatePulseSettings";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly settings: PulseSettings;
    }
  | {
      readonly _tag: "AddQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly question: NewPulseQuestion;
      readonly questionId: QuestionId;
    }
  | {
      readonly _tag: "EditQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly questionId: QuestionId;
      readonly content: QuestionContent;
    }
  | {
      readonly _tag: "RemoveQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly questionId: QuestionId;
    }
  | {
      readonly _tag: "ReorderQuestions";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly order: readonly QuestionId[];
    };

export type PulseChange =
  | { readonly _tag: "PulseAdded"; readonly pulse: PulseRecord }
  | { readonly _tag: "PulseSettingsUpdated"; readonly pulseId: PulseId; readonly settings: PulseSettings }
  | {
      readonly _tag: "QuestionAdded";
      readonly question: QuestionRecord;
      readonly version: QuestionVersionRecord;
    }
  | {
      readonly _tag: "QuestionRewritten";
      readonly questionId: QuestionId;
      readonly versionId: QuestionVersionId;
      readonly content: QuestionContent;
    }
  | {
      readonly _tag: "PulseQuestionsSet";
      readonly pulseId: PulseId;
      readonly questions: readonly QuestionVersionId[];
    };

export type PulseRejection =
  | { readonly _tag: "Forbidden" }
  | { readonly _tag: "TeamNotFound" }
  | { readonly _tag: "PulseNotFound" }
  | { readonly _tag: "QuestionNotFound" }
  | { readonly _tag: "QuestionAlreadyInPulse" }
  | { readonly _tag: "QuestionHasAnswers" }
  | { readonly _tag: "PulseNeedsAQuestion" }
  | { readonly _tag: "PulseFull"; readonly maximum: number }
  | { readonly _tag: "OrderMismatch" }
  | { readonly _tag: "TestSendLimitReached"; readonly perHour: number }
  | { readonly _tag: "TestSendNotFound" };

export type PulseDecision =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted"; readonly changes: readonly PulseChange[] };

export type PulseViewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection };

const reject = (rejection: PulseRejection) => ({ _tag: "Rejected", rejection }) as const;

const accept = (changes: readonly PulseChange[]): PulseDecision => ({ _tag: "Accepted", changes });

export const defaultPulseSettings = (locale: Locale): PulseSettings => ({
  name: weeklyTeamHealth(locale).name,
  cadence: { _tag: "Weekly", day: "monday", time: SendTime.make("09:00") },
  answerWindowDays: 3,
  reviewWindowDays: 3,
  reminders: 1,
  anonymityMode: "anonymous",
  distribution: "invitation",
});

const SECONDS_BY_TYPE: Readonly<Record<QuestionType["_tag"], number>> = {
  Rating: 6,
  SingleChoice: 10,
  LongText: 30,
};

export const estimatedSeconds = (type: QuestionType): number => SECONDS_BY_TYPE[type._tag];

export const estimateSeconds = (contents: readonly QuestionContent[]): number =>
  contents.reduce((total, content) => total + estimatedSeconds(content.type), 0);

export const pulseWarnings = (
  contents: readonly QuestionContent[],
  members: number,
  minimumGroupSize: number,
): readonly PulseWarning[] => {
  const warnings: PulseWarning[] = [];

  if (contents.length > Policy.questions.recommended) {
    warnings.push({
      _tag: "TooManyQuestions",
      count: contents.length,
      recommended: Policy.questions.recommended,
    });
  }

  const seconds = estimateSeconds(contents);

  if (seconds > RECOMMENDED_MAX_SECONDS) {
    warnings.push({ _tag: "TooLong", seconds, recommended: RECOMMENDED_MAX_SECONDS });
  }

  if (contents[0]?.type._tag !== "Rating") {
    warnings.push({ _tag: "NoOneTap" });
  }

  if (members < minimumGroupSize) {
    warnings.push({ _tag: "TeamBelowMinimumGroupSize", members, minimumGroupSize });
  }

  return warnings;
};

const initialQuestionId = (pulseId: PulseId, key: TemplateQuestionKey): QuestionId =>
  QuestionId.make(`${pulseId}.${key}`);

export const hasAnswers = (state: PulseState, questionId: QuestionId): boolean =>
  state.versions.some((version) => version.questionId === questionId && state.answered.includes(version.id));

export const findPulse = (state: PulseState, teamId: TeamId, pulseId: PulseId) =>
  state.pulses.find((pulse) => pulse.id === pulseId && pulse.teamId === teamId);

const versionOf = (state: PulseState, versionId: QuestionVersionId) =>
  state.versions.find((version) => version.id === versionId);

const versionInPulse = (state: PulseState, pulse: PulseRecord, questionId: QuestionId) =>
  pulse.questions
    .map((versionId) => versionOf(state, versionId))
    .find((version) => version?.questionId === questionId);

const membersOf = (directory: DirectoryState, teamId: TeamId) =>
  directory.memberships.filter(
    (membership) =>
      membership.teamId === teamId &&
      membership.endedAt === null &&
      (membership.role === "lead" || membership.role === "member"),
  ).length;

const newQuestion = (
  questionId: QuestionId,
  templateKey: TemplateQuestionKey | null,
  content: QuestionContent,
  now: number,
): Extract<PulseChange, { readonly _tag: "QuestionAdded" }> => ({
  _tag: "QuestionAdded",
  question: { id: questionId, templateKey, createdAt: now },
  version: { id: firstVersionId(questionId), questionId, number: 1, content },
});

const contentOf = ({ dimension, text, type }: QuestionContent): QuestionContent => ({
  dimension,
  text,
  type,
});

const authorize = (
  directory: DirectoryState,
  actorId: PersonId,
  action: TeamAction,
  teamId: TeamId,
):
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Allowed"; readonly actor: Actor } => {
  const actor = actorOf(directory, actorId);

  if (Option.isNone(actor) || !can(actor.value, action, { _tag: "Team", teamId })) {
    return reject({ _tag: "Forbidden" });
  }

  if (!directory.teams.some((team) => team.id === teamId)) {
    return reject({ _tag: "TeamNotFound" });
  }

  return { _tag: "Allowed", actor: actor.value };
};

const addQuestion = (
  state: PulseState,
  pulse: PulseRecord,
  question: NewPulseQuestion,
  questionId: QuestionId,
  locale: Locale,
  now: number,
): PulseDecision => {
  if (pulse.questions.length >= MAX_QUESTIONS) {
    return reject({ _tag: "PulseFull", maximum: MAX_QUESTIONS });
  }

  let added: Extract<PulseChange, { readonly _tag: "QuestionAdded" }>;

  if (question._tag === "Written") {
    added = newQuestion(questionId, null, contentOf(question), now);
  } else {
    const fromTemplate = templateQuestion(question.key, locale);

    if (fromTemplate === undefined) {
      return reject({ _tag: "QuestionNotFound" });
    }

    if (questionsOf(state, pulse).some(({ templateKey }) => templateKey === question.key)) {
      return reject({ _tag: "QuestionAlreadyInPulse" });
    }

    added = newQuestion(questionId, question.key, contentOf(fromTemplate), now);
  }

  return accept([
    added,
    { _tag: "PulseQuestionsSet", pulseId: pulse.id, questions: [...pulse.questions, added.version.id] },
  ]);
};

export const decidePulse = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  command: PulseCommand,
  now: number,
): PulseDecision => {
  const action = command._tag === "CreatePulse" ? "team.createPulse" : "team.editPulse";
  const allowed = authorize(directory, actorId, action, command.teamId);

  if (allowed._tag === "Rejected") {
    return allowed;
  }

  const locale = emailLocaleOf(directory, actorId);

  if (command._tag === "CreatePulse") {
    if (state.pulses.some((pulse) => pulse.id === command.pulseId)) {
      return accept([]);
    }

    const added = weeklyTeamHealth(locale).questions.map((question) =>
      newQuestion(initialQuestionId(command.pulseId, question.key), question.key, contentOf(question), now),
    );

    return accept([
      ...added,
      {
        _tag: "PulseAdded",
        pulse: {
          id: command.pulseId,
          teamId: command.teamId,
          settings: defaultPulseSettings(locale),
          createdAt: now,
          questions: added.map(({ version }) => version.id),
        },
      },
    ]);
  }

  const pulse = findPulse(state, command.teamId, command.pulseId);

  if (pulse === undefined) {
    return reject({ _tag: "PulseNotFound" });
  }

  switch (command._tag) {
    case "UpdatePulseSettings": {
      return accept([{ _tag: "PulseSettingsUpdated", pulseId: pulse.id, settings: command.settings }]);
    }

    case "AddQuestion": {
      return addQuestion(state, pulse, command.question, command.questionId, locale, now);
    }

    case "EditQuestion": {
      const version = versionInPulse(state, pulse, command.questionId);

      if (version === undefined) {
        return reject({ _tag: "QuestionNotFound" });
      }

      if (hasAnswers(state, command.questionId)) {
        return reject({ _tag: "QuestionHasAnswers" });
      }

      return accept([
        {
          _tag: "QuestionRewritten",
          questionId: command.questionId,
          versionId: version.id,
          content: contentOf(command.content),
        },
      ]);
    }

    case "RemoveQuestion": {
      const version = versionInPulse(state, pulse, command.questionId);

      if (version === undefined) {
        return reject({ _tag: "QuestionNotFound" });
      }

      if (pulse.questions.length <= MIN_QUESTIONS) {
        return reject({ _tag: "PulseNeedsAQuestion" });
      }

      return accept([
        {
          _tag: "PulseQuestionsSet",
          pulseId: pulse.id,
          questions: pulse.questions.filter((versionId) => versionId !== version.id),
        },
      ]);
    }

    case "ReorderQuestions": {
      const byQuestion = new Map(
        pulse.questions.flatMap((versionId) => {
          const version = versionOf(state, versionId);

          return version === undefined ? [] : [[version.questionId, version.id] as const];
        }),
      );

      const order = command.order.flatMap((questionId) => {
        const versionId = byQuestion.get(questionId);

        return versionId === undefined ? [] : [versionId];
      });

      if (
        command.order.length !== pulse.questions.length ||
        order.length !== pulse.questions.length ||
        new Set(order).size !== order.length
      ) {
        return reject({ _tag: "OrderMismatch" });
      }

      return accept([{ _tag: "PulseQuestionsSet", pulseId: pulse.id, questions: order }]);
    }
  }
};

export type TestSendDecision =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | {
      readonly _tag: "Allowed";

      readonly person: PersonRecord;
      readonly pulse: PulseRecord;
    };

export const decideTestSend = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  teamId: TeamId,
  pulseId: PulseId,
): TestSendDecision => {
  const allowed = authorize(directory, actorId, "team.editPulse", teamId);

  if (allowed._tag === "Rejected") {
    return allowed;
  }

  const pulse = findPulse(state, teamId, pulseId);

  if (pulse === undefined) {
    return reject({ _tag: "PulseNotFound" });
  }

  if (pulse.questions.length < MIN_QUESTIONS) {
    return reject({ _tag: "PulseNeedsAQuestion" });
  }

  const person = directory.people.find((each) => each.id === actorId);

  if (person === undefined) {
    return reject({ _tag: "Forbidden" });
  }

  return { _tag: "Allowed", person, pulse };
};

export const applyPulseChanges = (state: PulseState, changes: readonly PulseChange[]): PulseState =>
  changes.reduce<PulseState>((current, change) => {
    const updatePulse = (pulseId: PulseId, update: (pulse: PulseRecord) => PulseRecord) => ({
      ...current,
      pulses: current.pulses.map((pulse) => (pulse.id === pulseId ? update(pulse) : pulse)),
    });

    switch (change._tag) {
      case "PulseAdded": {
        return { ...current, pulses: [...current.pulses, change.pulse] };
      }

      case "PulseSettingsUpdated": {
        return updatePulse(change.pulseId, (pulse) => ({ ...pulse, settings: change.settings }));
      }

      case "QuestionAdded": {
        return {
          ...current,
          questions: [...current.questions, change.question],
          versions: [...current.versions, change.version],
        };
      }

      case "QuestionRewritten": {
        return {
          ...current,
          questions: current.questions.map((question) =>
            question.id === change.questionId ? { ...question, templateKey: null } : question,
          ),
          versions: current.versions.map((version) =>
            version.id === change.versionId ? { ...version, content: change.content } : version,
          ),
        };
      }

      case "PulseQuestionsSet": {
        return updatePulse(change.pulseId, (pulse) => ({ ...pulse, questions: change.questions }));
      }
    }
  }, state);

const questionsOf = (state: PulseState, pulse: PulseRecord): readonly PulseQuestion[] =>
  pulse.questions.flatMap((versionId) => {
    const version = versionOf(state, versionId);
    const question = state.questions.find((each) => each.id === version?.questionId);

    if (version === undefined || question === undefined) {
      return [];
    }

    return [
      {
        questionId: question.id,
        versionId: version.id,
        templateKey: question.templateKey,
        ...version.content,
        hasAnswers: hasAnswers(state, question.id),
        estimatedSeconds: estimatedSeconds(version.content.type),
      },
    ];
  });

const viewAuthorized = <A>(
  directory: DirectoryState,
  actorId: PersonId,
  teamId: TeamId,
  view: (actor: Actor) => PulseViewed<A>,
): PulseViewed<A> => {
  const allowed = authorize(directory, actorId, "team.viewPulses", teamId);

  return allowed._tag === "Rejected" ? allowed : view(allowed.actor);
};

export const pulsesView = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  teamId: TeamId,

  facts?: (pulseId: PulseId) => { readonly paused: boolean; readonly nextRoundDate: string | null },
): PulseViewed<PulseList> =>
  viewAuthorized(directory, actorId, teamId, (actor) => {
    const team = directory.teams.find((each) => each.id === teamId);

    if (team === undefined) {
      return reject({ _tag: "TeamNotFound" });
    }

    const pulses = state.pulses
      .filter((pulse) => pulse.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, "en"))
      .map((pulse) => {
        const questions = questionsOf(state, pulse);
        const known = facts?.(pulse.id);

        return {
          id: pulse.id,
          name: pulse.settings.name,
          cadence: pulse.settings.cadence,
          questionCount: questions.length,
          estimatedSeconds: estimateSeconds(questions),
          ...(known === undefined ? {} : { paused: known.paused, nextRoundDate: known.nextRoundDate }),
        };
      });

    return { _tag: "Viewed", value: { team: teamSummaryOf(team, actor), pulses } };
  });

export const pulseView = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  teamId: TeamId,
  pulseId: PulseId,
): PulseViewed<PulseDetail> =>
  viewAuthorized(directory, actorId, teamId, (actor) => {
    const team = directory.teams.find((each) => each.id === teamId);

    if (team === undefined) {
      return reject({ _tag: "TeamNotFound" });
    }

    const pulse = findPulse(state, teamId, pulseId);

    if (pulse === undefined) {
      return reject({ _tag: "PulseNotFound" });
    }

    const questions = questionsOf(state, pulse);
    const asked = new Set(questions.map((question) => question.templateKey));

    return {
      _tag: "Viewed",
      value: {
        id: pulse.id,
        team: teamSummaryOf(team, actor),
        settings: pulse.settings,
        questions,
        estimatedSeconds: estimateSeconds(questions),
        warnings: pulseWarnings(questions, membersOf(directory, teamId), directory.minimumGroupSize),
        templateQuestions: weeklyTeamHealth(emailLocaleOf(directory, actorId)).questions.filter(
          (question) => !asked.has(question.key),
        ),
      },
    };
  });

export interface TestSendFound {
  readonly personId: PersonId;
  readonly pulseId: PulseId;
  readonly sentAt: number;
  readonly state: SendState;
}

export const testSendStatusOf = (state: SendState, queuedAt: number, checkedAt: number): TestSendStatus => {
  switch (state._tag) {
    case "Pending": {
      return {
        queuedAt,
        checkedAt,
        state: { _tag: "Queued", attempts: state.attempts, lastCode: state.lastCode },
      };
    }

    case "Sending": {
      return { queuedAt, checkedAt, state: { _tag: "Sending", attempt: state.attempt } };
    }

    case "Sent": {
      return { queuedAt, checkedAt, state: { _tag: "Sent", sentAt: state.sentAt } };
    }

    case "Failed": {
      return {
        queuedAt,
        checkedAt,
        state: { _tag: "Failed", reason: state.reason, code: state.code, failedAt: state.failedAt },
      };
    }
  }
};

export const testSendView = (
  directory: DirectoryState,
  actorId: PersonId,
  teamId: TeamId,
  pulseId: PulseId,
  found: TestSendFound | null,
  now: number,
): PulseViewed<TestSendStatus> => {
  const allowed = authorize(directory, actorId, "team.editPulse", teamId);

  if (allowed._tag === "Rejected") {
    return allowed;
  }

  if (
    found === null ||
    found.personId !== actorId ||
    found.pulseId !== pulseId ||
    found.sentAt <= now - testInvitationLifetimeMs
  ) {
    return reject({ _tag: "TestSendNotFound" });
  }

  return { _tag: "Viewed", value: testSendStatusOf(found.state, found.sentAt, now) };
};
