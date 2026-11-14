import { describe, expect, it } from "vitest";
import { keepAnswer, keptAnswersLifetimeMs, keptAnswersPrefix } from "./kept-answers.ts";

const now = 1_800_000_000_000;
const oneYear = 365 * 24 * 60 * 60 * 1000;

const fakeStorage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      getItem: (key: string): string | null => map.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        map.set(key, value);
      },
    },
  };
};

const read = (map: Map<string, string>, roundId: string) => {
  const raw = map.get(`${keptAnswersPrefix}${roundId}`);
  return raw === undefined ? undefined : JSON.parse(raw);
};

describe("keepAnswer", () => {
  it("uses the documented key prefix and a one-year lifetime", () => {
    expect(keptAnswersPrefix).toBe("sb_answers_");
    expect(keptAnswersLifetimeMs).toBe(oneYear);
  });

  it("first write creates the entry with expiresAt one year from now", () => {
    const { map, storage } = fakeStorage();
    keepAnswer(() => storage, "round-1", "qv-1", { value: 4 }, now);

    expect(read(map, "round-1")).toEqual({
      expiresAt: now + oneYear,
      answers: { "qv-1": { value: 4 } },
    });
  });

  it("merges value then comment for the same Question field-wise", () => {
    const { map, storage } = fakeStorage();
    keepAnswer(() => storage, "round-1", "qv-1", { value: 3 }, now);
    keepAnswer(() => storage, "round-1", "qv-1", { comment: "x" }, now);

    expect(read(map, "round-1").answers).toEqual({ "qv-1": { value: 3, comment: "x" } });
  });

  it("keeps other Questions alongside the one being written", () => {
    const { map, storage } = fakeStorage();
    keepAnswer(() => storage, "round-1", "qv-1", { value: 2 }, now);
    keepAnswer(() => storage, "round-1", "qv-2", { comment: "hello" }, now);

    expect(read(map, "round-1").answers).toEqual({
      "qv-1": { value: 2 },
      "qv-2": { comment: "hello" },
    });
  });

  it("a later write extends expiresAt", () => {
    const { map, storage } = fakeStorage();
    keepAnswer(() => storage, "round-1", "qv-1", { value: 1 }, now);
    const later = now + 60_000;
    keepAnswer(() => storage, "round-1", "qv-1", { value: 5 }, later);

    expect(read(map, "round-1").expiresAt).toBe(later + oneYear);
  });

  it("replaces unparsable JSON instead of throwing", () => {
    const { map, storage } = fakeStorage({ [`${keptAnswersPrefix}round-1`]: "{not json" });
    expect(() => keepAnswer(() => storage, "round-1", "qv-1", { value: 2 }, now)).not.toThrow();

    expect(read(map, "round-1")).toEqual({
      expiresAt: now + oneYear,
      answers: { "qv-1": { value: 2 } },
    });
  });

  it.each([
    ["a JSON null", "null"],
    ["a bare number", "42"],
    ["an array", "[1,2]"],
    ["an object without answers", '{"expiresAt":1}'],
    ["answers that is a string", '{"expiresAt":1,"answers":"nope"}'],
    ["answers that is null", '{"expiresAt":1,"answers":null}'],
  ])("replaces a wrong shape (%s) instead of throwing", (_label, raw) => {
    const { map, storage } = fakeStorage({ [`${keptAnswersPrefix}round-1`]: raw });
    expect(() => keepAnswer(() => storage, "round-1", "qv-1", { comment: "y" }, now)).not.toThrow();

    expect(read(map, "round-1")).toEqual({
      expiresAt: now + oneYear,
      answers: { "qv-1": { comment: "y" } },
    });
  });

  it("replaces a non-object Question entry rather than merging into it", () => {
    const stored = JSON.stringify({ expiresAt: 1, answers: { "qv-1": "garbage" } });
    const { map, storage } = fakeStorage({ [`${keptAnswersPrefix}round-1`]: stored });
    keepAnswer(() => storage, "round-1", "qv-1", { value: 4 }, now);

    expect(read(map, "round-1").answers).toEqual({ "qv-1": { value: 4 } });
  });

  it("does not throw when getItem throws", () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {},
    };
    expect(() => keepAnswer(() => storage, "round-1", "qv-1", { value: 1 }, now)).not.toThrow();
  });

  it("does not throw when setItem throws (quota)", () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => keepAnswer(() => storage, "round-1", "qv-1", { value: 1 }, now)).not.toThrow();
  });

  it("keeps each Round under its own key", () => {
    const { map, storage } = fakeStorage();
    keepAnswer(() => storage, "round-1", "qv-1", { value: 1 }, now);
    keepAnswer(() => storage, "round-2", "qv-9", { value: 5 }, now);

    expect(map.has(`${keptAnswersPrefix}round-1`)).toBe(true);
    expect(map.has(`${keptAnswersPrefix}round-2`)).toBe(true);
    expect(read(map, "round-1").answers).toEqual({ "qv-1": { value: 1 } });
    expect(read(map, "round-2").answers).toEqual({ "qv-9": { value: 5 } });
  });

  it("does not throw when reading localStorage itself throws (blocked storage)", () => {
    const blocked = (): Storage => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(() => keepAnswer(blocked, "round-1", "qv-1", { value: 3 }, now)).not.toThrow();
  });
});
