import { describe, expect, it } from "vitest";
import { answerCatalog } from "../messages/answer.ts";
import { answerDe } from "../messages/answer.de.ts";
import { answerMessages } from "./answer-messages.ts";
import { anonymityStatement, parseRoundContext } from "./round-context.ts";

const roundContext = (overrides: Record<string, unknown> = {}) => ({
  roundId: "round-1",
  pulseName: "Weekly Pulse",
  minimumGroupSize: 4,
  questions: [{ id: "qv-1", position: 1, text: "How was your week?", type: { _tag: "LongText" } }],
  actions: [],
  closeTime: 1_800_000_000_000,
  state: "open",
  hasAnswered: false,
  ...overrides,
});

const aiNotice =
  "Comments are summarised by an AI service in the EU after names, emails, phone numbers, handles and links are removed. It keeps nothing.";
const anonymity =
  "Your lead only sees combined answers from at least 4 people, never who answered what. Your name is never stored with your answers.";

const en = answerMessages(answerCatalog);

describe("answer page anonymity statement", () => {
  it("adds the AI notice right after the anonymity statement when AI processing is on", () => {
    const context = parseRoundContext(roundContext({ aiProcessing: true }));
    expect(context).not.toBeNull();
    expect(anonymityStatement(context!, en)).toBe(`${anonymity} ${aiNotice}`);
    expect(anonymityStatement(context!, en)).toBe(`${anonymity} ${en("answer.aiNotice")}`);
  });

  it("uses the German table when the German answer page passes it", () => {
    const context = parseRoundContext(roundContext({ aiProcessing: true }));
    const de = answerMessages(answerDe);
    expect(anonymityStatement(context!, de)).toBe(
      `${de("answer.anonymity", { n: 4 })} ${de("answer.aiNotice")}`,
    );
    expect(anonymityStatement(context!, de)).not.toBe(anonymityStatement(context!, en));
  });

  it("shows only the anonymity statement when AI processing is off", () => {
    const context = parseRoundContext(roundContext({ aiProcessing: false }));
    expect(context).not.toBeNull();
    expect(anonymityStatement(context!, en)).toBe(anonymity);
  });

  it("treats a context without the flag as AI processing off", () => {
    const context = parseRoundContext(roundContext());
    expect(context).not.toBeNull();
    expect(context?.aiProcessing).toBe(false);
    expect(anonymityStatement(context!, en)).toBe(anonymity);
  });

  it("rejects a context that is not an object", () => {
    expect(parseRoundContext("nope")).toBeNull();
  });
});
