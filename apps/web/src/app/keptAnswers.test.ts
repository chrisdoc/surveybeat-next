import { describe, expect, it } from "vitest";
import { clearKeptAnswers, readKeptAnswers } from "./keptAnswers.ts";

const now = Date.parse("2026-11-10T12:00:00Z");
const later = now + 60_000;

/** A Map-backed Storage: enough of the Storage surface for the reader and the clearer. */
const fakeStorage = (entries: Record<string, string>) => {
  const map = new Map(Object.entries(entries));
  const storage = {
    get length() {
      return map.size;
    },
    key: (index: number): string | null => [...map.keys()][index] ?? null,
    getItem: (key: string): string | null => map.get(key) ?? null,
    removeItem: (key: string): void => {
      map.delete(key);
    },
  };
  return { storage, map };
};

const stored = (expiresAt: number, answers: Record<string, unknown>) =>
  JSON.stringify({ expiresAt, answers });

describe("readKeptAnswers", () => {
  it("returns a valid entry keyed by roundId", () => {
    const { storage, map } = fakeStorage({
      sb_answers_round1: stored(now + 1000, {
        q1: { value: 4 },
        q2: { comment: "Too many meetings" },
      }),
    });

    expect(readKeptAnswers(storage, now)).toEqual({
      round1: { q1: { value: 4 }, q2: { comment: "Too many meetings" } },
    });
    expect(map.has("sb_answers_round1")).toBe(true);
  });

  it("prunes an expired entry and removes it from storage", () => {
    const { storage, map } = fakeStorage({
      sb_answers_old: stored(now - 1, { q1: { value: 2 } }),
      sb_answers_edge: stored(now, { q1: { value: 2 } }),
      sb_answers_fresh: stored(now + 1, { q1: { value: 5 } }),
    });

    expect(readKeptAnswers(storage, now)).toEqual({ fresh: { q1: { value: 5 } } });
    expect(map.has("sb_answers_old")).toBe(false);
    expect(map.has("sb_answers_edge")).toBe(false);
    expect(map.has("sb_answers_fresh")).toBe(true);
  });

  it("removes malformed entries from storage", () => {
    const { storage, map } = fakeStorage({
      sb_answers_notJson: "{not json",
      sb_answers_noAnswers: JSON.stringify({ expiresAt: now + 1000 }),
      sb_answers_badValue: stored(now + 1000, { q1: { value: "four" } }),
      sb_answers_noExpiry: JSON.stringify({ answers: {} }),
      sb_answers_good: stored(now + 1000, { q1: { value: 3 } }),
    });

    expect(readKeptAnswers(storage, now)).toEqual({ good: { q1: { value: 3 } } });
    expect([...map.keys()]).toEqual(["sb_answers_good"]);
  });

  it("leaves unrelated keys untouched", () => {
    const { storage, map } = fakeStorage({
      sb_edit_r1: "{not json",
      other: "anything",
      sb_answers_round1: stored(now - 1, {}),
    });

    readKeptAnswers(storage, now);

    expect(map.get("sb_edit_r1")).toBe("{not json");
    expect(map.get("other")).toBe("anything");
    expect(map.has("sb_answers_round1")).toBe(false);
  });

  it("returns nothing for an empty storage", () => {
    const { storage } = fakeStorage({});
    expect(readKeptAnswers(storage, now)).toEqual({});
  });

  it("returns nothing when storage throws", () => {
    const storage = {
      length: 1,
      key: (): string | null => {
        throw new Error("storage denied");
      },
      getItem: (): string | null => null,
      removeItem: (): void => undefined,
    };

    expect(readKeptAnswers(storage, later)).toEqual({});
  });
});

describe("clearKeptAnswers", () => {
  it("removes every kept answer and nothing else", () => {
    const { storage, map } = fakeStorage({
      sb_answers_round1: stored(now + 1000, { q1: { value: 1 } }),
      sb_answers_round2: stored(now + 1000, { q1: { comment: "Hi" } }),
      sb_edit_r1: "edit draft",
      other: "anything",
    });

    clearKeptAnswers(storage);

    expect([...map.keys()].sort()).toEqual(["other", "sb_edit_r1"]);
    expect(readKeptAnswers(storage, now)).toEqual({});
  });

  it("never throws when storage throws", () => {
    const storage = {
      length: 1,
      key: (): string | null => {
        throw new Error("storage denied");
      },
      removeItem: (): void => undefined,
    };

    expect(() => clearKeptAnswers(storage)).not.toThrow();
  });
});
