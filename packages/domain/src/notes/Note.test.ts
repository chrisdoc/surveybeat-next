import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { noteChange, SaveNote } from "./Note.ts";

describe("noteChange", () => {
  it("stores the trimmed text", () => {
    expect(noteChange("  Shipping slipped a week.\n")).toEqual({
      _tag: "Upsert",
      text: "Shipping slipped a week.",
    });
  });

  it.each(["", "   ", "\n\t "])("deletes the Note for blank text %j", (text) => {
    expect(noteChange(text)).toEqual({ _tag: "Delete" });
  });
});

describe("SaveNote", () => {
  const decode = Schema.decodeUnknownSync(SaveNote);

  it("accepts a Note of 2,000 characters", () => {
    expect(decode({ text: "a".repeat(2000) }).text).toHaveLength(2000);
  });

  it("rejects a Note of 2,001 characters", () => {
    expect(() => decode({ text: "a".repeat(2001) })).toThrow();
  });

  it("accepts blank text, which clears the Note", () => {
    expect(decode({ text: "   " }).text).toBe("   ");
  });
});
