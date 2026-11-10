import { message } from "../messages/index.ts";

export interface QuestionTypeRating {
  readonly _tag: "Rating";
  readonly lowLabel?: string;
  readonly highLabel?: string;
  readonly comment?: boolean;
}

export interface QuestionTypeSingleChoice {
  readonly _tag: "SingleChoice";
  readonly options: ReadonlyArray<string>;
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
  readonly questions: ReadonlyArray<QuestionData>;
  readonly actions: ReadonlyArray<ActionData>;
  readonly closeTime: number;
  readonly state: string;
  readonly hasAnswered: boolean;
  readonly aiProcessing: boolean;
}

/**
 * What the lead will and will not see (SPEC 5.2). When the Organization processes comments with AI, the
 * answer page says so right after it (ADR 0015).
 */
export function anonymityStatement(context: RoundContextData): string {
  const anonymity = message("answer.anonymity", { n: context.minimumGroupSize });
  return context.aiProcessing ? `${anonymity} ${message("answer.aiNotice")}` : anonymity;
}

export function parseRoundContext(data: unknown): RoundContextData | null {
  if (typeof data !== "object" || data === null) return null;
  if (!("roundId" in data) || typeof data.roundId !== "string") return null;
  if (!("pulseName" in data) || typeof data.pulseName !== "string") return null;
  if (!("minimumGroupSize" in data) || typeof data.minimumGroupSize !== "number") return null;
  if (!("closeTime" in data) || typeof data.closeTime !== "number") return null;
  if (!("state" in data) || typeof data.state !== "string") return null;
  if (!("hasAnswered" in data) || typeof data.hasAnswered !== "boolean") return null;
  // Absent means off: the flag is new, and a context without it is a context for an Organization without AI processing.
  const aiProcessing = "aiProcessing" in data && data.aiProcessing === true;
  if (!("questions" in data) || !Array.isArray(data.questions)) return null;

  const questions: Array<QuestionData> = [];
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
          const opts: Array<string> = [];
          for (const opt of item.type.options) {
            if (typeof opt === "string") opts.push(opt);
          }
          qType = { _tag: "SingleChoice", options: opts };
        } else if (item.type._tag === "LongText") {
          qType = { _tag: "LongText" };
        }
      }
      questions.push({ id: item.id, position: item.position, text: item.text, type: qType });
    }
  }

  const actions: Array<ActionData> = [];
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
  };
}
