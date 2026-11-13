import {
  type HistoryQuestion,
  type HistoryRound,
  type HistoryTeamResult,
  MemberHistory,
} from "@surveybeat/domain";
import { Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";
import { formatRoundDate, formatScore, message } from "../messages/locale.ts";
import { Failure } from "./api.ts";
import {
  appButton,
  emptyState,
  pageTitle,
  panel,
  problemView,
  secondaryButtonClass,
  subSectionTitle,
} from "./components.ts";
import { type KeptAnswer, KeptAnswers } from "./keptAnswers.ts";

const noticeClass = "mt-4 rounded-control bg-subtle px-4 py-3 text-sm text-muted";

export const LoadedHistory = defineTaggedUnion({
  Loading: {},
  Loaded: { history: MemberHistory, kept: KeptAnswers, cleared: Schema.Boolean },
  Failed: { failure: Failure },
});
export type LoadedHistory = typeof LoadedHistory.Type;

/** The answer scale runs from 1 to 5; a kept value outside it was never a Rating the member could give. */
const isScaleValue = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  Number.isInteger(value) && value >= 1 && value <= 5;

/** The Question's own labels sit at 1 and 5; 2 to 4, and an end with no label, show the number alone. */
const ratingText = (
  value: 1 | 2 | 3 | 4 | 5,
  lowLabel: string | undefined,
  highLabel: string | undefined,
): string => {
  const label = value === 1 ? lowLabel : value === 5 ? highLabel : undefined;
  if (label === undefined || label === "") return String(value);
  return message("history.yours.rating", { value: String(value), label });
};

const nonEmpty = (text: string | undefined): string | undefined =>
  text === undefined || text === "" ? undefined : text;

/** The member's own Answer as shown: `main` is the value or LongText, `comment` the Rating's comment. */
const yourAnswer = (
  type: HistoryQuestion["type"],
  answer: KeptAnswer | undefined,
): { readonly main: string | undefined; readonly comment: string | undefined } => {
  switch (type._tag) {
    case "Rating": {
      const value = answer?.value;
      return {
        main:
          value !== undefined && isScaleValue(value)
            ? ratingText(value, type.lowLabel, type.highLabel)
            : undefined,
        comment: nonEmpty(answer?.comment),
      };
    }
    case "SingleChoice": {
      const index = answer?.value;
      const option = index !== undefined && Number.isInteger(index) ? type.options[index] : undefined;
      return { main: option, comment: undefined };
    }
    case "LongText":
      return { main: nonEmpty(answer?.comment), comment: undefined };
  }
};

const yourAnswerView = <Message>(
  question: HistoryQuestion,
  roundAnswers: KeptAnswers[string] | undefined,
  h: HtmlBuilder<Message>,
): Html => {
  // The Round's answers are on this device only if the answer page kept any for it.
  if (roundAnswers === undefined) return h.span([], [message("history.yours.notOnDevice")]);
  const { main, comment } = yourAnswer(question.type, roundAnswers[question.questionVersionId]);
  if (main === undefined && comment === undefined) return h.span([], [message("history.yours.none")]);
  return h.div(
    [h.Class("flex flex-col gap-1")],
    [
      ...(main === undefined ? [] : [h.span([], [main])]),
      ...(comment === undefined
        ? []
        : [h.p([h.Class("text-sm text-muted")], [message("history.yours.comment", { text: comment })])]),
    ],
  );
};

const teamScoreText = (round: HistoryRound, question: HistoryQuestion): string => {
  if (question.teamScore !== null)
    return message("history.team.score", { score: formatScore(question.teamScore) });
  if (round.teamResult === "shown" && question.type._tag === "Rating") return message("history.team.hidden");
  return message("results.dash");
};

const teamResultNote = (teamResult: HistoryTeamResult): string | null => {
  if (teamResult === "notShared") return message("history.team.notShared");
  if (teamResult === "belowMinimumGroupSize") return message("history.team.belowMinimum");
  return null;
};

/** One Round's Questions: the member's answer beside the Team's score. Local rather than `dataTable`, which takes text cells only. */
const questionsTable = <Message>(
  round: HistoryRound,
  roundAnswers: KeptAnswers[string] | undefined,
  h: HtmlBuilder<Message>,
): Html => {
  const header = (text: string): Html =>
    h.th([h.Class("py-2 pr-4 text-[13px] font-semibold text-muted")], [text]);
  return h.table(
    [h.Class("mt-2 w-full text-left text-sm")],
    [
      h.thead(
        [],
        [
          h.tr(
            [h.Class("border-b border-line-soft")],
            [
              header(message("history.column.question")),
              header(message("history.column.yours")),
              header(message("history.column.team")),
            ],
          ),
        ],
      ),
      h.tbody(
        [],
        round.questions.map((question) =>
          h.tr(
            [h.Class("border-b border-line-soft last:border-b-0")],
            [
              h.td([h.Class("py-2 pr-4")], [question.text]),
              h.td([h.Class("py-2 pr-4")], [yourAnswerView(question, roundAnswers, h)]),
              h.td([h.Class("py-2 pr-4 tabular-nums")], [teamScoreText(round, question)]),
            ],
          ),
        ),
      ),
    ],
  );
};

const roundView = <Message>(round: HistoryRound, kept: KeptAnswers, h: HtmlBuilder<Message>): Html => {
  const date = formatRoundDate(round.plannedOpenDate);
  const note = teamResultNote(round.teamResult);
  return panel(
    [
      subSectionTitle(round.pulseName, h, 2),
      h.p([h.Class("text-sm text-muted")], [message("history.round.meta", { team: round.teamName, date })]),
      ...(note === null ? [] : [h.p([h.Class("text-sm text-muted")], [note])]),
      questionsTable(round, kept[round.roundId], h),
    ],
    h,
    "flex flex-col gap-2",
  );
};

/** The signed-in Person's history of Rounds: their own answers from this device beside the Team's scores. */
export const historyView = <Message>(
  state: LoadedHistory,
  actions: { readonly onClear: Message },
  h: HtmlBuilder<Message>,
): Html => {
  const children: Array<Html> = [
    pageTitle(message("history.title"), h),
    h.p([h.Class("mt-2 text-muted")], [message("history.intro")]),
  ];

  if (state._tag === "Loading") {
    children.push(h.p([h.Class("mt-6 text-muted")], [message("app.loading")]));
    return h.section([], children);
  }

  if (state._tag === "Failed") {
    const problem = problemView(state.failure, h);
    if (problem !== null) children.push(problem);
    return h.section([], children);
  }

  const { history, kept, cleared } = state;
  const hasKept = Object.values(kept).some((answers) => Object.keys(answers).length > 0);
  const keptForListed = history.rounds.some((round) => Object.keys(kept[round.roundId] ?? {}).length > 0);

  if (cleared) {
    children.push(h.p([h.Role("status"), h.Class(noticeClass)], [message("history.cleared")]));
  } else if (history.rounds.length > 0 && !keptForListed) {
    children.push(h.p([h.Role("status"), h.Class(noticeClass)], [message("history.noAnswersHere")]));
  }

  if (history.rounds.length === 0) {
    children.push(emptyState(message("history.empty"), h));
  } else {
    children.push(
      h.div(
        [h.Class("mt-6 flex flex-col gap-4")],
        history.rounds.map((round) => roundView(round, kept, h)),
      ),
    );
  }

  if (hasKept) {
    children.push(
      h.div(
        [h.Class("mt-8")],
        [
          appButton(
            {
              text: message("history.clear"),
              className: secondaryButtonClass,
              onClick: actions.onClear,
            },
            h,
          ),
        ],
      ),
    );
  }

  return h.section([h.Class("flex flex-col gap-2")], children);
};
