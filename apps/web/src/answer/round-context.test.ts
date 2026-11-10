import { describe, expect, it } from "vitest";
import { message } from "../messages/answer.ts";
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

describe("answer page anonymity statement", () => {
  it("adds the AI notice right after the anonymity statement when AI processing is on", () => {
    const context = parseRoundContext(roundContext({ aiProcessing: true }));
    expect(context).not.toBeNull();
    expect(anonymityStatement(context!)).toBe(`${anonymity} ${aiNotice}`);
    expect(anonymityStatement(context!)).toBe(`${anonymity} ${message("answer.aiNotice")}`);
  });

  it("shows only the anonymity statement when AI processing is off", () => {
    const context = parseRoundContext(roundContext({ aiProcessing: false }));
    expect(context).not.toBeNull();
    expect(anonymityStatement(context!)).toBe(anonymity);
  });

  it("treats a context without the flag as AI processing off", () => {
    const context = parseRoundContext(roundContext());
    expect(context).not.toBeNull();
    expect(context?.aiProcessing).toBe(false);
    expect(anonymityStatement(context!)).toBe(anonymity);
  });

  it("rejects a context that is not an object", () => {
    expect(parseRoundContext("nope")).toBeNull();
  });
});
