import type { AnswerMessage } from "./answer-messages.ts";

export interface QuestionTypeRating {
  readonly _tag: "Rating";
  readonly lowLabel?: string;
  readonly highLabel?: string;
  readonly comment?: boolean;
}

export interface QuestionTypeSingleChoice {
  readonly _tag: "SingleChoice";
  readonly options: readonly string[];
}

export interface QuestionTypeLongText {
  readonly _tag: "LongText";
}

export type QuestionType = QuestionTypeRating | QuestionTypeSingleChoice | QuestionTypeLongText;

export interface QuestionData {
  readonly id: string;
  readonly position: number;
  readonly text: string;
  readonly type: QuestionType;
}

export interface ActionData {
  readonly id: string;
  readonly title: string;
}

export interface RoundContextData {
  readonly roundId: string;
  readonly pulseName: string;
  readonly minimumGroupSize: number;
  readonly questions: readonly QuestionData[];
  readonly actions: readonly ActionData[];
  readonly closeTime: number;
  readonly state: string;
  readonly hasAnswered: boolean;
  readonly aiProcessing: boolean;

  readonly test: boolean;
}

export function anonymityStatement(context: RoundContextData, message: AnswerMessage): string {
  const anonymity = message("answer.anonymity", { n: context.minimumGroupSize });

  return context.aiProcessing ? `${anonymity} ${message("answer.aiNotice")}` : anonymity;
}

export function parseRoundContext(data: unknown): RoundContextData | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  if (!("roundId" in data) || typeof data.roundId !== "string") {
    return null;
  }

  if (!("pulseName" in data) || typeof data.pulseName !== "string") {
    return null;
  }

  if (!("minimumGroupSize" in data) || typeof data.minimumGroupSize !== "number") {
    return null;
  }

  if (!("closeTime" in data) || typeof data.closeTime !== "number") {
    return null;
  }

  if (!("state" in data) || typeof data.state !== "string") {
    return null;
  }

  if (!("hasAnswered" in data) || typeof data.hasAnswered !== "boolean") {
    return null;
  }

  const aiProcessing = "aiProcessing" in data && data.aiProcessing === true;

  const test = "test" in data && data.test === true;

  if (!("questions" in data) || !Array.isArray(data.questions)) {
    return null;
  }

  const questions: QuestionData[] = [];

  for (const item of data.questions) {
    if (
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      typeof item.id === "string" &&
      "text" in item &&
      typeof item.text === "string" &&
      "position" in item &&
      typeof item.position === "number"
    ) {
      let qType: QuestionType = { _tag: "Rating", comment: true };

      if ("type" in item && typeof item.type === "object" && item.type !== null && "_tag" in item.type) {
        if (item.type._tag === "Rating") {
          qType = {
            _tag: "Rating",
            lowLabel:
              "lowLabel" in item.type && typeof item.type.lowLabel === "string"
                ? item.type.lowLabel
                : undefined,
            highLabel:
              "highLabel" in item.type && typeof item.type.highLabel === "string"
                ? item.type.highLabel
                : undefined,
            comment:
              "comment" in item.type && typeof item.type.comment === "boolean" ? item.type.comment : true,
          };
        } else if (
          item.type._tag === "SingleChoice" &&
          "options" in item.type &&
          Array.isArray(item.type.options)
        ) {
          const opts: string[] = [];

          for (const opt of item.type.options) {
            if (typeof opt === "string") {
              opts.push(opt);
            }
          }

          qType = { _tag: "SingleChoice", options: opts };
        } else if (item.type._tag === "LongText") {
          qType = { _tag: "LongText" };
        }
      }

      questions.push({ id: item.id, position: item.position, text: item.text, type: qType });
    }
  }

  const actions: ActionData[] = [];

  if ("actions" in data && Array.isArray(data.actions)) {
    for (const act of data.actions) {
      if (
        typeof act === "object" &&
        act !== null &&
        "id" in act &&
        typeof act.id === "string" &&
        "title" in act &&
        typeof act.title === "string"
      ) {
        actions.push({ id: act.id, title: act.title });
      }
    }
  }

  return {
    roundId: data.roundId,
    pulseName: data.pulseName,
    minimumGroupSize: data.minimumGroupSize,
    questions,
    actions,
    closeTime: data.closeTime,
    state: data.state,
    hasAnswered: data.hasAnswered,
    aiProcessing,
    test,
  };
}
