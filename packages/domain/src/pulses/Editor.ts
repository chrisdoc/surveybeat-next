import { Option } from "effect";
import { actorOf, type DirectoryState, emailLocaleOf, teamSummaryOf } from "../people/Directory.ts";
import type { PersonId } from "../people/Identity.ts";
import type { Locale } from "../people/Locale.ts";
import { type Actor, can, type TeamAction } from "../people/Permissions.ts";
import type { TeamId } from "../people/Team.ts";
import {
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  type PulseDetail,
  type PulseId,
  type PulseList,
  type PulseQuestion,
  type PulseSettings,
  type PulseWarning,
  RECOMMENDED_MAX_QUESTIONS,
  RECOMMENDED_MAX_SECONDS,
  SendTime,
  type NewPulseQuestion,
} from "./Pulse.ts";
import {
  firstVersionId,
  type QuestionContent,
  QuestionId,
  type QuestionType,
  type QuestionVersionId,
} from "./Question.ts";
import { templateQuestion, type TemplateQuestionKey, weeklyTeamHealth } from "./Template.ts";

/**
 * The question library and the Pulses of one Organization, and the Pulse editor's rules. Pure,
 * like the directory: the Organization Durable Object loads both states, asks `decidePulse`, and
 * applies the changes in one transaction. Records are plain data because they cross the RPC
 * boundary.
 */

/** A Question in the Organization's library. */
export interface QuestionRecord {
  readonly id: QuestionId;
  /** The Template Question it was copied from, if any. */
  readonly templateKey: TemplateQuestionKey | null;
  readonly createdAt: number;
}

/** One meaning of a Question. Release 1 keeps exactly one per Question, number 1. */
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
  /** The Question versions it asks, in order. */
  readonly questions: ReadonlyArray<QuestionVersionId>;
}

export interface PulseState {
  readonly questions: ReadonlyArray<QuestionRecord>;
  readonly versions: ReadonlyArray<QuestionVersionRecord>;
  readonly pulses: ReadonlyArray<PulseRecord>;
  /** The Question versions that have Answers. Always empty until Answers are stored (slice 09). */
  readonly answered: ReadonlyArray<QuestionVersionId>;
}

export const EMPTY_PULSE_STATE: PulseState = { questions: [], versions: [], pulses: [], answered: [] };

/** Every command names the Team, so the permission table is asked before anything is looked up. */
export type PulseCommand =
  /** A new Pulse from the weekly team health Template, with all its Questions and the default settings. */
  | { readonly _tag: "CreatePulse"; readonly teamId: TeamId; readonly pulseId: PulseId }
  | {
      readonly _tag: "UpdatePulseSettings";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly settings: PulseSettings;
    }
  /** Appends a new library Question, with the id the caller minted. */
  | {
      readonly _tag: "AddQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly question: NewPulseQuestion;
      readonly questionId: QuestionId;
    }
  /**
   * Changes a Question's text, type, or Dimension. Refused once it has Answers. An edited Template
   * Question is the Lead's own from then on, so the Template's original can be added again.
   */
  | {
      readonly _tag: "EditQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly questionId: QuestionId;
      readonly content: QuestionContent;
    }
  /** Takes a Question out of the Pulse. The Question and its version stay in the library. */
  | {
      readonly _tag: "RemoveQuestion";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly questionId: QuestionId;
    }
  /** Puts the Pulse's Questions in this order, which must list each of them exactly once. */
  | {
      readonly _tag: "ReorderQuestions";
      readonly teamId: TeamId;
      readonly pulseId: PulseId;
      readonly order: ReadonlyArray<QuestionId>;
    };

export type PulseChange =
  | { readonly _tag: "PulseAdded"; readonly pulse: PulseRecord }
  | { readonly _tag: "PulseSettingsUpdated"; readonly pulseId: PulseId; readonly settings: PulseSettings }
  | {
      readonly _tag: "QuestionAdded";
      readonly question: QuestionRecord;
      readonly version: QuestionVersionRecord;
    }
  /**
   * Rewrites a Question's only version in place, allowed only while no Answer points at it, and
   * detaches the Question from the Template it was copied from.
   */
  | {
      readonly _tag: "QuestionRewritten";
      readonly questionId: QuestionId;
      readonly versionId: QuestionVersionId;
      readonly content: QuestionContent;
    }
  | {
      readonly _tag: "PulseQuestionsSet";
      readonly pulseId: PulseId;
      readonly questions: ReadonlyArray<QuestionVersionId>;
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
  | { readonly _tag: "OrderMismatch" };

export type PulseDecision =
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Accepted"; readonly changes: ReadonlyArray<PulseChange> };

export type PulseViewed<A> =
  | { readonly _tag: "Viewed"; readonly value: A }
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection };

const reject = (rejection: PulseRejection) => ({ _tag: "Rejected", rejection }) as const;
const accept = (changes: ReadonlyArray<PulseChange>): PulseDecision => ({ _tag: "Accepted", changes });

/**
 * The settings of a new Pulse in `locale`, named after the Template: Monday 09:00, a three-day
 * window, one reminder, anonymous, by Invitation.
 */
export const defaultPulseSettings = (locale: Locale): PulseSettings => ({
  name: weeklyTeamHealth(locale).name,
  cadence: { _tag: "Weekly", day: "monday", time: SendTime.make("09:00") },
  answerWindowDays: 3,
  reminders: 1,
  anonymityMode: "anonymous",
  distribution: "invitation",
});

/**
 * Seconds a member needs for one Question, by type: a rating is a tap, a single choice means
 * reading the options, and long text means writing. The optional comment on a rating is not
 * counted, since most members skip it.
 */
const SECONDS_BY_TYPE: { readonly [T in QuestionType["_tag"]]: number } = {
  Rating: 6,
  SingleChoice: 10,
  LongText: 30,
};

export const estimatedSeconds = (type: QuestionType): number => SECONDS_BY_TYPE[type._tag];

/** The estimated answer time of a Pulse: the sum over its Questions. */
export const estimateSeconds = (contents: ReadonlyArray<QuestionContent>): number =>
  contents.reduce((total, content) => total + estimatedSeconds(content.type), 0);

/**
 * The editor's warnings, in the order it shows them. `members` counts the Team's active Leads and
 * members, the people a Round would invite.
 */
export const pulseWarnings = (
  contents: ReadonlyArray<QuestionContent>,
  members: number,
  minimumGroupSize: number,
): ReadonlyArray<PulseWarning> => {
  const warnings: Array<PulseWarning> = [];
  if (contents.length > RECOMMENDED_MAX_QUESTIONS) {
    warnings.push({
      _tag: "TooManyQuestions",
      count: contents.length,
      recommended: RECOMMENDED_MAX_QUESTIONS,
    });
  }
  const seconds = estimateSeconds(contents);
  if (seconds > RECOMMENDED_MAX_SECONDS) {
    warnings.push({ _tag: "TooLong", seconds, recommended: RECOMMENDED_MAX_SECONDS });
  }
  if (contents[0]?.type._tag !== "Rating") warnings.push({ _tag: "NoOneTap" });
  if (members < minimumGroupSize)
    warnings.push({ _tag: "TeamBelowMinimumGroupSize", members, minimumGroupSize });
  return warnings;
};

/** The library Question each Template Question becomes in a new Pulse: unique, as Pulse ids are. */
const initialQuestionId = (pulseId: PulseId, key: TemplateQuestionKey): QuestionId =>
  QuestionId.make(`${pulseId}.${key}`);

/** Whether any Answer points at a version of this Question. False until slice 09 stores Answers. */
export const hasAnswers = (state: PulseState, questionId: QuestionId): boolean =>
  state.versions.some((version) => version.questionId === questionId && state.answered.includes(version.id));

const findPulse = (state: PulseState, teamId: TeamId, pulseId: PulseId) =>
  state.pulses.find((pulse) => pulse.id === pulseId && pulse.teamId === teamId);

const versionOf = (state: PulseState, versionId: QuestionVersionId) =>
  state.versions.find((version) => version.id === versionId);

/** The version of `questionId` this Pulse asks, if it asks that Question. */
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

/** A new Question with its first and, in Release 1, only version. */
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

/** Authorizes `action` on the Team and finds it: the permission table first, so refusals leak nothing. */
const authorize = (
  directory: DirectoryState,
  actorId: PersonId,
  action: TeamAction,
  teamId: TeamId,
):
  | { readonly _tag: "Rejected"; readonly rejection: PulseRejection }
  | { readonly _tag: "Allowed"; readonly actor: Actor } => {
  const actor = actorOf(directory, actorId);
  if (Option.isNone(actor) || !can(actor.value, action, { _tag: "Team", teamId }))
    return reject({ _tag: "Forbidden" });
  if (!directory.teams.some((team) => team.id === teamId)) return reject({ _tag: "TeamNotFound" });
  return { _tag: "Allowed", actor: actor.value };
};

/**
 * Adds one Question at the end, always as a new library Question with its first version. A Template
 * Question is copied in `locale`, the language of the Person adding it.
 */
const addQuestion = (
  state: PulseState,
  pulse: PulseRecord,
  question: NewPulseQuestion,
  questionId: QuestionId,
  locale: Locale,
  now: number,
): PulseDecision => {
  if (pulse.questions.length >= MAX_QUESTIONS) return reject({ _tag: "PulseFull", maximum: MAX_QUESTIONS });
  let added: Extract<PulseChange, { readonly _tag: "QuestionAdded" }>;
  if (question._tag === "Written") {
    added = newQuestion(questionId, null, contentOf(question), now);
  } else {
    const fromTemplate = templateQuestion(question.key, locale);
    if (fromTemplate === undefined) return reject({ _tag: "QuestionNotFound" });
    if (questionsOf(state, pulse).some(({ templateKey }) => templateKey === question.key))
      return reject({ _tag: "QuestionAlreadyInPulse" });
    added = newQuestion(questionId, question.key, contentOf(fromTemplate), now);
  }
  return accept([
    added,
    { _tag: "PulseQuestionsSet", pulseId: pulse.id, questions: [...pulse.questions, added.version.id] },
  ]);
};

/**
 * Decides one Pulse editor command by `actorId`. Leads of the Team and Organization admins may
 * create and edit its Pulses (the permission table). The rules: a Pulse keeps 1 to
 * {@link MAX_QUESTIONS} Questions, asks each at most once, and a Question with Answers is never
 * rewritten. Anything softer (more than 7 Questions, over 90 seconds, no rating first, a Team
 * smaller than N) is a warning in the view, never a refusal.
 */
export const decidePulse = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  command: PulseCommand,
  now: number,
): PulseDecision => {
  const action = command._tag === "CreatePulse" ? "team.createPulse" : "team.editPulse";
  const allowed = authorize(directory, actorId, action, command.teamId);
  if (allowed._tag === "Rejected") return allowed;

  // The language of the Pulse's new Questions and settings: the acting Person's (ADR 0018).
  const locale = emailLocaleOf(directory, actorId);

  if (command._tag === "CreatePulse") {
    // Ids are minted fresh, so a taken one can only be a retry of this same create.
    if (state.pulses.some((pulse) => pulse.id === command.pulseId)) return accept([]);
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
  if (pulse === undefined) return reject({ _tag: "PulseNotFound" });

  switch (command._tag) {
    case "UpdatePulseSettings":
      return accept([{ _tag: "PulseSettingsUpdated", pulseId: pulse.id, settings: command.settings }]);

    case "AddQuestion":
      return addQuestion(state, pulse, command.question, command.questionId, locale, now);

    case "EditQuestion": {
      const version = versionInPulse(state, pulse, command.questionId);
      if (version === undefined) return reject({ _tag: "QuestionNotFound" });
      if (hasAnswers(state, command.questionId)) return reject({ _tag: "QuestionHasAnswers" });
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
      if (version === undefined) return reject({ _tag: "QuestionNotFound" });
      if (pulse.questions.length <= MIN_QUESTIONS) return reject({ _tag: "PulseNeedsAQuestion" });
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

/** Applies a decision's changes to an in-memory state: what the Durable Object does in SQL. */
export const applyPulseChanges = (state: PulseState, changes: ReadonlyArray<PulseChange>): PulseState =>
  changes.reduce<PulseState>((current, change) => {
    const updatePulse = (pulseId: PulseId, update: (pulse: PulseRecord) => PulseRecord) => ({
      ...current,
      pulses: current.pulses.map((pulse) => (pulse.id === pulseId ? update(pulse) : pulse)),
    });
    switch (change._tag) {
      case "PulseAdded":
        return { ...current, pulses: [...current.pulses, change.pulse] };
      case "PulseSettingsUpdated":
        return updatePulse(change.pulseId, (pulse) => ({ ...pulse, settings: change.settings }));
      case "QuestionAdded":
        return {
          ...current,
          questions: [...current.questions, change.question],
          versions: [...current.versions, change.version],
        };
      case "QuestionRewritten":
        return {
          ...current,
          questions: current.questions.map((question) =>
            question.id === change.questionId ? { ...question, templateKey: null } : question,
          ),
          versions: current.versions.map((version) =>
            version.id === change.versionId ? { ...version, content: change.content } : version,
          ),
        };
      case "PulseQuestionsSet":
        return updatePulse(change.pulseId, (pulse) => ({ ...pulse, questions: change.questions }));
    }
  }, state);

/** A Pulse's Questions in order, as the editor shows them. */
const questionsOf = (state: PulseState, pulse: PulseRecord): ReadonlyArray<PulseQuestion> =>
  pulse.questions.flatMap((versionId) => {
    const version = versionOf(state, versionId);
    const question = state.questions.find((each) => each.id === version?.questionId);
    if (version === undefined || question === undefined) return [];
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

/** A Team's Pulses, oldest first, for its Leads and for Organization admins. */
export const pulsesView = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  teamId: TeamId,
): PulseViewed<PulseList> =>
  viewAuthorized(directory, actorId, teamId, (actor) => {
    const team = directory.teams.find((each) => each.id === teamId);
    if (team === undefined) return reject({ _tag: "TeamNotFound" });
    const pulses = state.pulses
      .filter((pulse) => pulse.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, "en"))
      .map((pulse) => {
        const questions = questionsOf(state, pulse);
        return {
          id: pulse.id,
          name: pulse.settings.name,
          cadence: pulse.settings.cadence,
          questionCount: questions.length,
          estimatedSeconds: estimateSeconds(questions),
        };
      });
    return { _tag: "Viewed", value: { team: teamSummaryOf(team, actor), pulses } };
  });

/** The Pulse editor's view of one Pulse of the Team. */
export const pulseView = (
  directory: DirectoryState,
  state: PulseState,
  actorId: PersonId,
  teamId: TeamId,
  pulseId: PulseId,
): PulseViewed<PulseDetail> =>
  viewAuthorized(directory, actorId, teamId, (actor) => {
    const team = directory.teams.find((each) => each.id === teamId);
    if (team === undefined) return reject({ _tag: "TeamNotFound" });
    const pulse = findPulse(state, teamId, pulseId);
    if (pulse === undefined) return reject({ _tag: "PulseNotFound" });
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
