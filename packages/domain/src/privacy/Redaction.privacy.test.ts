import { describe, expect, it } from "vitest";
import { redact, type Roster } from "./Redaction.ts";

describe("redact", () => {
  const roster: Roster = [
    "Anna",
    "Mary Ann Lee",
    "will",
    "may",
    { name: "John Doe", email: "john.doe@example.com" },
    { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  ];

  it("redacts case and accents: anna, ANNA, Ánna", () => {
    expect(redact("Talked to anna yesterday.", roster)).toBe("Talked to [name] yesterday.");
    expect(redact("Talked to ANNA yesterday.", roster)).toBe("Talked to [name] yesterday.");
    expect(redact("Talked to Ánna yesterday.", roster)).toBe("Talked to [name] yesterday.");
  });

  it("redacts possessives: Anna's, Anna’s", () => {
    expect(redact("That was Anna's presentation.", roster)).toBe("That was [name]'s presentation.");
    expect(redact("That was Anna’s presentation.", roster)).toBe("That was [name]’s presentation.");
  });

  it("redacts multi-word names: Mary Ann Lee", () => {
    expect(redact("Mary Ann Lee led the meeting.", roster)).toBe("[name] led the meeting.");
    expect(redact("Mary Ann Lee's project was great.", roster)).toBe("[name]'s project was great.");
  });

  it("redacts ordinary words that are roster names: will, may", () => {
    expect(redact("This will happen soon.", roster)).toBe("This [name] happen soon.");
    expect(redact("We may need more time.", roster)).toBe("We [name] need more time.");
  });

  it("redacts an email address, 5 phone formats, an @handle, and a URL containing a name", () => {
    // 1. Email address
    expect(redact("Contact me at someone@domain.com for info.", roster)).toBe(
      "Contact me at [email] for info.",
    );

    // 2. Five phone formats
    expect(redact("Call +1 (555) 234-5678 today.", roster)).toBe("Call [phone] today.");
    expect(redact("Call 555-234-5678 today.", roster)).toBe("Call [phone] today.");
    expect(redact("Call (555) 234-5678 today.", roster)).toBe("Call [phone] today.");
    expect(redact("Call 555.234.5678 today.", roster)).toBe("Call [phone] today.");
    expect(redact("Call +49 30 1234567 today.", roster)).toBe("Call [phone] today.");

    // Plain numbers stay
    expect(redact("We served 1000000 customers in 2026 with 50000 items.", roster)).toBe(
      "We served 1000000 customers in 2026 with 50000 items.",
    );

    // 3. @handle
    expect(redact("Ping @chrisdoc or @anna on chat.", roster)).toBe("Ping [handle] or [handle] on chat.");

    // 4. URL containing a name
    expect(redact("See https://example.com/anna/profile for details.", roster)).toBe(
      "See [link] for details.",
    );
  });

  it("redacts names glued to punctuation: (Anna), Anna,, Anna!", () => {
    expect(redact("Great idea (Anna)!", roster)).toBe("Great idea ([name])!");
    expect(redact("Thanks, Anna, for your help.", roster)).toBe("Thanks, [name], for your help.");
    expect(redact("Anna! What a surprise.", roster)).toBe("[name]! What a surprise.");
  });

  it("keeps 'Ann' inside 'annual'", () => {
    expect(redact("Our annual planning is next week.", roster)).toBe("Our annual planning is next week.");
  });

  it("extracts and redacts names from object roster items and email local parts", () => {
    expect(redact("Reviewed by John Doe.", roster)).toBe("Reviewed by [name].");
    expect(redact("Reviewed by John.", roster)).toBe("Reviewed by [name].");
    expect(redact("Sent by ada.", roster)).toBe("Sent by [name].");
  });

  it("ignores names shorter than 2 characters", () => {
    const singleLetterRoster: Roster = ["A", "x", "Bob"];
    expect(redact("A quick test with Bob and x.", singleLetterRoster)).toBe(
      "A quick test with [name] and x.",
    );
  });

  it("enforces 1,000-character limit after Unicode normalisation", () => {
    const longText = "a".repeat(1050) + " Anna";
    const result = redact(longText, roster);
    expect(result.length).toBeLessThanOrEqual(1000);
    expect(result).not.toContain("Anna");
  });

  it("property test: no roster name survives in random sentences", () => {
    const names = ["Alice", "Bob", "Charlie", "Daphne", "Edward"];
    const testRoster: Roster = names;

    const words = [
      "the",
      "quick",
      "brown",
      "fox",
      "jumped",
      "over",
      "lazy",
      "dog",
      "meeting",
      "today",
      "review",
      "shared",
      "code",
      "project",
    ];

    // Seeded-style pseudo random generator
    let seed = 42;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < 50; i++) {
      const sentenceLength = Math.floor(rnd() * 15) + 5;
      const sentenceWords: Array<string> = [];

      for (let j = 0; j < sentenceLength; j++) {
        if (rnd() < 0.3) {
          // Insert a roster name with possible punctuation or possessive
          const name = names[Math.floor(rnd() * names.length)]!;
          const variant = rnd();
          if (variant < 0.25) sentenceWords.push(name.toLowerCase());
          else if (variant < 0.5) sentenceWords.push(name.toUpperCase());
          else if (variant < 0.75) sentenceWords.push(`${name}'s`);
          else sentenceWords.push(`(${name})`);
        } else {
          sentenceWords.push(words[Math.floor(rnd() * words.length)]!);
        }
      }

      const sentence = sentenceWords.join(" ") + ".";
      const redacted = redact(sentence, testRoster);

      // Verify no whole word in redacted text matches any of the roster names
      const segmenter = new Intl.Segmenter("en", { granularity: "word" });
      for (const seg of segmenter.segment(redacted)) {
        if (seg.isWordLike) {
          let word = seg.segment.toLowerCase();
          if (word.endsWith("'s") || word.endsWith("’s")) word = word.slice(0, -2);
          for (const name of names) {
            expect(word).not.toBe(name.toLowerCase());
          }
        }
      }
    }
  });
});
