import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { isUnhandled, setup, transition, types } from "xstate";
import { AiClient, RedactedText } from "../ai/AiClient.ts";
import type { AiInput, AiRequest } from "../ai/AiClient.ts";
import { Policy } from "../Policy.ts";
import { redact } from "../privacy/Redaction.ts";
import type { Roster } from "../privacy/Redaction.ts";
import { DiscussionGuide, enforceEffectiveNOnResult } from "./Results.ts";
import type { RoundResult } from "./Results.ts";
import { nextRetryAt } from "./Retry.ts";
import type { RoundStatus } from "./Round.ts";

export const StoredThemes = Schema.Struct({
  themes: Schema.Array(
    Schema.Struct({ label: Schema.String, sentence: Schema.String, supportingComments: Schema.Int }),
  ),
  guide: Schema.NullOr(DiscussionGuide),
});

export type StoredThemes = typeof StoredThemes.Type;

export type RoundThemesRecord =
  | { readonly status: "pending"; readonly requestedAt: number; readonly attempts: number }
  | { readonly status: "ready"; readonly themes: StoredThemes }
  | { readonly status: "failed" };

export const MAX_THEMES = Policy.themes.maximum;

export const MIN_SUPPORTING_COMMENTS = 2;

export const QUOTE_RUN_WORDS = 6;

export const shouldRequestThemes = (result: RoundResult, aiProcessing: boolean): boolean =>
  aiProcessing &&
  result.meetsMinimumGroupSize &&
  !result.delayed &&
  (result.status === "closed" || result.status === "ready" || result.status === "shared");

export const buildThemesInput = (
  result: RoundResult,
  openActionTitles: readonly string[],
  roster: Roster,
): AiInput => {
  const questionPositions = new Map(result.questions.map((q) => [q.questionVersionId, q.position]));

  return {
    questions: result.questions.map((q) => ({
      position: q.position,
      text: q.text,
      dimension: q.dimension,
      score: q.meetsMinimumGroupSize ? q.score : null,
      change: q.change?.change ?? null,
      largerThanUsual: q.change?.highlight?.isLargerThanUsual ?? false,
    })),
    dimensions: result.dimensions
      .filter((d) => d.meetsMinimumGroupSize)
      .map((d) => ({
        dimension: d.dimension,
        score: d.score,
        change: d.change?.change ?? null,
        largerThanUsual: d.change?.highlight?.isLargerThanUsual ?? false,
      })),
    comments: result.meetsMinimumGroupSize
      ? result.comments.map((c) => ({
          questionPosition: questionPositions.get(c.questionVersionId) ?? -1,
          text: RedactedText.make(c.text),
        }))
      : [],
    actions: openActionTitles.flatMap((title) => {
      const redacted = redact(title, roster);

      return redacted.trim() === "" ? [] : [{ title: RedactedText.make(redacted) }];
    }),
  };
};

export const THEMES_SCHEMA_NAME = "comment_themes_and_guide";

export const themesJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["themes", "guide"],
  properties: {
    themes: {
      type: "array",
      description: `At most ${MAX_THEMES} Comment themes. Each needs at least ${MIN_SUPPORTING_COMMENTS} supporting comments.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "sentence", "supportingCommentIndexes"],
        properties: {
          label: { type: "string", description: "A short label of 6 words or fewer." },
          sentence: {
            type: "string",
            description: "One neutral sentence that paraphrases the theme. Never quote a comment.",
          },
          supportingCommentIndexes: {
            type: "array",
            description: "Indexes, counted from 0, of the comments that support this theme.",
            items: { type: "integer" },
          },
        },
      },
    },
    guide: {
      type: "object",
      additionalProperties: false,
      required: ["whatStoodOut", "whatPeopleRaised", "actionsToCheckOn", "questions"],
      properties: {
        whatStoodOut: {
          type: "array",
          description: "What stood out in the scores and changes, especially larger-than-usual changes.",
          items: { type: "string" },
        },
        whatPeopleRaised: {
          type: "array",
          description: "What people raised in the comments, paraphrased. Never quote.",
          items: { type: "string" },
        },
        actionsToCheckOn: {
          type: "array",
          description: "Only titles from the given open Actions. Empty when there are none.",
          items: { type: "string" },
        },
        questions: {
          type: "array",
          description: "At most 3 open questions the Lead can ask the Team.",
          items: { type: "string" },
        },
      },
    },
  },
};

export const themesInstructions = [
  "You write the Comment themes and the discussion guide for one Round of a Team's pulse check.",
  "You receive the Round's anonymous data as JSON: questions with scores and changes, dimensions with scores and changes (largerThanUsual marks a change that is bigger than usual), comments indexed from 0, and the titles of open Actions.",
  `Write at most ${MAX_THEMES} Comment themes. Each has a short label of 6 words or fewer and one neutral sentence, plus the indexes of the comments that support it.`,
  `Only write a theme that at least ${MIN_SUPPORTING_COMMENTS} comments support.`,
  `Paraphrase. Never quote a comment and never reuse ${QUOTE_RUN_WORDS} or more consecutive words from a comment.`,
  "Never say or guess who wrote a comment, never name anyone, and never mention anything that is not in the input.",
  "Keep the wording neutral. Never advise punishing or praising an individual.",
  "The discussion guide has four lists:",
  "- whatStoodOut: what stood out in the scores and changes, especially the larger-than-usual ones.",
  "- whatPeopleRaised: what people raised in the comments, paraphrased.",
  "- actionsToCheckOn: only titles from the given open Actions; empty when there are none.",
  "- questions: at most 3 open questions the Lead can ask the Team.",
  "The same rules apply to the guide: paraphrase, never quote, and never say who said what.",
  "With no comments, return no themes and build the guide from the scores and Actions.",
  "Reply only with JSON that matches the schema.",
].join("\n");

export const themesRequest = (input: AiInput): AiRequest => ({
  instructions: themesInstructions,
  input,
  schemaName: THEMES_SCHEMA_NAME,
  schema: themesJsonSchema,
  maxTokens: 2000,
});

const wordsOf = (text: string): readonly string[] =>
  text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

const runsOf = (text: string): Set<string> => {
  const words = wordsOf(text);
  const runs = new Set<string>();

  for (let i = 0; i + QUOTE_RUN_WORDS <= words.length; i++) {
    runs.add(words.slice(i, i + QUOTE_RUN_WORDS).join(" "));
  }

  return runs;
};

export const repeatsCommentWords = (text: string, comments: readonly string[]): boolean => {
  const commentRuns = new Set(comments.flatMap((comment) => [...runsOf(comment)]));

  return [...runsOf(text)].some((run) => commentRuns.has(run));
};

export class ThemesReplyInvalid extends Data.TaggedError("ThemesReplyInvalid") {}

const ReplyEnvelope = Schema.Struct({
  themes: Schema.Array(Schema.Unknown),
  guide: Schema.optionalKey(Schema.Unknown),
});

const ThemeReply = Schema.Struct({
  label: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  sentence: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  supportingCommentIndexes: Schema.Array(Schema.Int),
});

const decodeEnvelope = Schema.decodeUnknownOption(ReplyEnvelope);

const decodeThemeReply = Schema.decodeUnknownOption(ThemeReply);

const decodeGuide = Schema.decodeUnknownOption(DiscussionGuide);

export const checkThemesReply = (
  reply: unknown,
  comments: readonly string[],
): Effect.Effect<StoredThemes, ThemesReplyInvalid> => {
  const envelope = Option.getOrNull(decodeEnvelope(reply));

  if (envelope === null) {
    return Effect.fail(new ThemesReplyInvalid());
  }

  const themes = envelope.themes.slice(0, MAX_THEMES).flatMap((entry) => {
    const decoded = Option.getOrNull(decodeThemeReply(entry));

    if (decoded === null) {
      return [];
    }

    const supporters = new Set(
      decoded.supportingCommentIndexes.filter((index) => index >= 0 && index < comments.length),
    ).size;

    if (supporters < MIN_SUPPORTING_COMMENTS) {
      return [];
    }

    if (repeatsCommentWords(`${decoded.label} ${decoded.sentence}`, comments)) {
      return [];
    }

    return [{ label: decoded.label, sentence: decoded.sentence, supportingComments: supporters }];
  });

  const guide = Option.getOrNull(decodeGuide(envelope.guide));

  const guideRepeats =
    guide === null ||
    [...guide.whatStoodOut, ...guide.whatPeopleRaised, ...guide.actionsToCheckOn, ...guide.questions].some(
      (text) => repeatsCommentWords(text, comments),
    );

  return Effect.succeed({ themes, guide: guideRepeats ? null : guide });
};

export type ThemesJobDecision =
  | { readonly _tag: "Store"; readonly themes: StoredThemes }
  | { readonly _tag: "RetryAt"; readonly dueAt: number; readonly attempts: number }
  | { readonly _tag: "GiveUp" };

type ThemesEvent =
  | { readonly type: "Store"; readonly themes: StoredThemes }
  | { readonly type: "Reject" }
  | { readonly type: "Unavailable" }
  | { readonly type: "Invalid" }
  | { readonly type: "NotConfigured" };

export const themesRetryMachine = setup({
  schemas: {
    context: types<{
      attempts: number;
      requestedAt: number;
      now: number;
      decision: ThemesJobDecision | null;
    }>(),
    events: {
      Store: types<{ themes: StoredThemes }>(),
      Reject: types<Record<string, never>>(),
      Unavailable: types<Record<string, never>>(),
      Invalid: types<Record<string, never>>(),
      NotConfigured: types<Record<string, never>>(),
    },
  },
}).createMachine({
  id: "ThemesRetry",
  context: { attempts: 0, requestedAt: 0, now: 0, decision: null },
  initial: "pending",
  states: {
    pending: {
      on: {
        Store: ({ event }) => ({
          target: "ready",
          context: { decision: { _tag: "Store", themes: event.themes } },
        }),
        Reject: ({ context }) => retryOrGiveUp(context),
        Unavailable: ({ context }) => retryOrGiveUp(context),
        Invalid: ({ context }) => retryOrGiveUp(context),
        NotConfigured: () => ({ target: "failed", context: { decision: { _tag: "GiveUp" } } }),
      },
    },
    ready: {},
    failed: {},
  },
});

const retryOrGiveUp = (context: { attempts: number; requestedAt: number; now: number }) => {
  const failedAttempts = context.attempts + 1;
  const dueAt = nextRetryAt(context.requestedAt, failedAttempts, context.now);

  return dueAt === null
    ? { target: "failed", context: { decision: { _tag: "GiveUp" } as const } }
    : {
        context: {
          attempts: failedAttempts,
          decision: { _tag: "RetryAt", dueAt, attempts: failedAttempts } as const,
        },
      };
};

const themesDecision = (
  params: { readonly requestedAt: number; readonly attempts: number; readonly now: number },
  event: ThemesEvent,
): ThemesJobDecision => {
  const snapshot = themesRetryMachine.resolveState({
    value: "pending",
    context: { attempts: params.attempts, requestedAt: params.requestedAt, now: params.now, decision: null },
  });

  const [next, effects] = transition(themesRetryMachine, snapshot, event);
  const decision = isUnhandled(snapshot, [next, effects]) ? null : next.context.decision;

  if (decision === null) {
    throw new Error(`Themes retry refused ${event.type}`);
  }

  return decision;
};

export const runThemesAttempt = (params: {
  readonly input: AiInput;
  readonly requestedAt: number;
  readonly attempts: number;
  readonly now: number;
}): Effect.Effect<ThemesJobDecision, never, AiClient> => {
  const comments = params.input.comments.map((c) => c.text);

  return AiClient.use((client) => client.complete(themesRequest(params.input))).pipe(
    Effect.flatMap((reply) => checkThemesReply(reply, comments)),
    Effect.map((themes): ThemesJobDecision => themesDecision(params, { type: "Store", themes })),
    Effect.catchTags({
      AiNotConfigured: (): Effect.Effect<ThemesJobDecision> =>
        Effect.succeed(themesDecision(params, { type: "NotConfigured" })),
      AiRejected: (): Effect.Effect<ThemesJobDecision> =>
        Effect.succeed(themesDecision(params, { type: "Reject" })),
      AiUnavailable: (): Effect.Effect<ThemesJobDecision> =>
        Effect.succeed(themesDecision(params, { type: "Unavailable" })),
      ThemesReplyInvalid: (): Effect.Effect<ThemesJobDecision> =>
        Effect.succeed(themesDecision(params, { type: "Invalid" })),
    }),
  );
};

export const viewRoundResult = (params: {
  readonly stored: RoundResult;
  readonly organizationN: number;
  readonly isLead: boolean;
  readonly themes: RoundThemesRecord | null;
  readonly round: { readonly status: RoundStatus; readonly reviewEndsAt: number | null };
  readonly resultPending?: boolean;
}): RoundResult => {
  const {
    themes: _themes,
    themesStatus: _themesStatus,
    discussionGuide: _discussionGuide,
    reviewEndsAt: _reviewEndsAt,
    ...r
  } = enforceEffectiveNOnResult(params.stored, params.organizationN);

  const status = params.round.status;

  const reviewEnds =
    status === "ready" && params.round.reviewEndsAt !== null
      ? { reviewEndsAt: params.round.reviewEndsAt }
      : {};

  if (!params.isLead && (status === "closed" || status === "ready")) {
    return {
      ...r,
      ...reviewEnds,
      status,
      questions: [],
      dimensions: [],
      comments: [],
      themesStatus: "notRequested",
      themes: [],
    };
  }

  const couldNotCompute = params.isLead && status === "closed" && r.delayed && params.resultPending !== true;

  const shown: RoundResult = {
    ...r,
    ...reviewEnds,
    status,
    comments: params.isLead ? r.comments : [],
    ...(couldNotCompute ? { couldNotCompute: true } : {}),
  };

  const hidden = (themesStatus: "notRequested" | "preparing" | "unavailable"): RoundResult => ({
    ...shown,
    themesStatus,
    themes: [],
    ...(params.isLead ? { discussionGuide: null } : {}),
  });

  const record = params.themes;
  const closed = status === "closed" || status === "ready" || status === "shared";

  if (!closed || !r.meetsMinimumGroupSize || record === null) {
    return hidden("notRequested");
  }

  switch (record.status) {
    case "pending": {
      return hidden("preparing");
    }

    case "failed": {
      return hidden("unavailable");
    }

    case "ready": {
      if (!params.isLead) {
        return {
          ...shown,
          themesStatus: "ready",
          themes: record.themes.themes.map(({ label, sentence }) => ({ label, sentence })),
        };
      }

      return {
        ...shown,
        themesStatus: "ready",
        themes: record.themes.themes,
        discussionGuide: record.themes.guide,
      };
    }
  }
};
