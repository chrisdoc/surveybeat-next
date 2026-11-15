import { prop } from "@effect/vitest";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { redact, type Roster } from "./Redaction.ts";

const ROSTER_NAMES = ["Alice", "Bob", "Charlie", "Daphne", "Edward"] as const;

const Part = Schema.Struct({
  kind: Schema.Literals(["word", "lower", "upper", "possessive", "parenthesised"]),
  index: Schema.Int,
  word: Schema.Literals([
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
  ]),
});

const Digit = Schema.Literals(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const AreaDigit = Schema.Literals(["2", "3", "4", "5", "6", "7", "8", "9"]);

const GermanNumber = Schema.Struct({
  prefix: Schema.Literals(["+49 ", "+49", "0049 ", "+49 (0)", "0"]),
  mobile: Schema.Boolean,
  area: Schema.Array(AreaDigit),
  subscriber: Schema.Array(Digit),
  separators: Schema.Array(Schema.Literals([" ", "-", "/", " / ", ""])),
});

const digits = (values: ReadonlyArray<string>, atLeast: number, atMost: number): string =>
  values.join("").slice(0, atMost).padEnd(atLeast, "5");

const germanNumber = (number: typeof GermanNumber.Type): string => {
  const area = digits(number.area, 2, 3);
  const national = number.mobile ? `1${"567"[area.charCodeAt(0) % 3]}${area.slice(0, 1)}` : area;
  const subscriber = digits(number.subscriber, 6, 8);
  const separatorOf = (index: number) => number.separators[index % number.separators.length] ?? " ";
  let groups = "";
  for (let index = 0, group = 0; index < subscriber.length; group += 1) {
    const size = 2 + (group % 2);
    groups += `${separatorOf(group)}${subscriber.slice(index, index + size)}`;
    index += size;
  }
  return `${number.prefix}${national}${groups}`;
};

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

  it("prefers the longest roster name, so a shorter name inside it never leaves the rest visible", () => {
    const overlapping: Roster = ["Ann", "Mary Ann Lee"];
    expect(redact("Mary Ann Lee led it.", overlapping)).toBe("[name] led it.");
    expect(redact("Mary Ann Lee's project.", overlapping)).toBe("[name]'s project.");
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

  prop(
    "no roster name survives a sentence, whatever case, possessive or punctuation wraps it",
    { parts: Schema.Array(Part) },
    ({ parts }) => {
      const roster: Roster = [...ROSTER_NAMES];
      const text =
        parts
          .slice(0, 40)
          .map((part, position) => {
            const name = ROSTER_NAMES[Math.abs(part.index + position) % ROSTER_NAMES.length] ?? "Alice";
            switch (part.kind) {
              case "word":
                return part.word;
              case "lower":
                return name.toLowerCase();
              case "upper":
                return name.toUpperCase();
              case "possessive":
                return `${name}'s`;
              case "parenthesised":
                return `(${name})`;
            }
          })
          .join(" ") + ".";
      const redacted = redact(text, roster);
      const segmenter = new Intl.Segmenter("en", { granularity: "word" });
      for (const segment of segmenter.segment(redacted)) {
        if (!segment.isWordLike) continue;
        let word = segment.segment.toLowerCase();
        if (word.endsWith("'s") || word.endsWith("\u2019s")) word = word.slice(0, -2);
        if (ROSTER_NAMES.some((name) => name.toLowerCase() === word)) return false;
      }
      return true;
    },
  );
});

describe("redact German phone numbers", () => {
  const sentence = (number: string): string => `Ruf mich an: ${number} danke.`;
  const redacted = "Ruf mich an: [phone] danke.";

  it.each([
    "+49 30 12345678",
    "+49 (0)30 12345678",
    "+49 (0) 30 1234 5678",
    "+49-30-12345678",
    "+49/30/12345678",
    "+4930123456",
    "+49 170 1234567",
    "+491701234567",
    "0049 30 12345678",
    "0049 170 1234567",
    "004930123456",
    "030 12345678",
    "030/12345678",
    "030-12345678",
    "(030) 12345678",
    "030 / 123 456 78",
    "0170 1234567",
    "0170/1234567",
    "0170-123 45 67",
    "01701234567",
    "0151 23456789",
    "0160 9876543",
    "0176 12345678",
    "089 123456",
    "0221 / 123 45 67",
    "06221 123456",
    "040 - 123 456 7",
  ])("redacts German phone number %s", (number) => {
    expect(redact(sentence(number), [])).toBe(redacted);
  });

  it.each([
    "12.11.2026",
    "am 12.11.2026 um 10:30",
    "01.12.2026",
    "12.11.26",
    "2026",
    "2025-2026",
    "2026-11-12",
    "Raum 3/12",
    "Raum 03/12",
    "3/12/2026",
    "Version 1.2.3.4",
    "PLZ 10115 Berlin",
    "Ticket 12345678",
    "Ticket 012345678",
    "1000000",
    "Seite 0815",
    "Kosten: 1.250.000 Euro",
    "10:30 Uhr",
    "KW 46",
  ])("keeps non-phone text unchanged: %s", (text) => {
    expect(redact(text, [])).toBe(text);
  });

  it.each([
    ["Am 12.11.2026 12 34 56 78", "Am 12.11.2026 [phone]"],
    ["12.11.2026 555-234-5678", "12.11.2026 [phone]"],
    ["1.2.2024 5551234 99", "1.2.2024 [phone]"],
    ["2026-11-10 0170 1234567", "2026-11-10 [phone]"],
  ])("keeps a date but redacts the phone number after it: %s", (text, expected) => {
    expect(redact(text, [])).toBe(expected);
  });

  it.each(["0 30 12 34 56", "0 30 1234567", "1 800 555 1234", "612 345 678", "10 000 000"])(
    "redacts a spaced number of 7+ digits, including a stray leading digit: %s",
    (number) => {
      expect(redact(sentence(number), [])).toBe(redacted);
    },
  );

  it.each([
    ["Call 0 30 1234567 today.", "Call [phone] today."],
    ["Call 0 30 12 34 56 today.", "Call [phone] today."],
  ])("redacts a phone number with a stray leading digit inside a sentence: %s", (text, expected) => {
    expect(redact(text, [])).toBe(expected);
  });

  it("redacts a thousands-grouped number without a currency marker (accepted false positive)", () => {
    // Accepted false positive: without a currency marker, 10 000 000 may be a phone number.
    // Privacy beats false positives.
    expect(redact("10 000 000 Menschen", [])).toBe("[phone] Menschen");
  });

  it.each([
    "10 000 000 Euro",
    "Budget 10.000.000 €",
    "€ 10.000.000,50",
    "€10 000 000",
    "$ 25,000,000",
    "1.500.000 EUR",
    "2 500 000 CHF",
    "Kosten: 12.500.000,00 Euro",
  ])("keeps a currency amount unchanged: %s", (text) => {
    expect(redact(text, [])).toBe(text);
  });

  it.each([
    ["Tel 612 345 678 Euro", "Tel [phone] Euro"],
    ["Ruf 612 345 678 an, kostet 10 Euro", "Ruf [phone] an, kostet 10 Euro"],
    ["Telefon: 123 456 789 €", "Telefon: [phone] €"],
    ["12.11.2026 0 30 12 34 56", "12.11.2026 [phone]"],
    ["0 30 12 34 56 0 40 98 76 54", "[phone] [phone]"],
  ])("redacts a phone number next to a phone cue, a date or another number: %s", (text, expected) => {
    expect(redact(text, [])).toBe(expected);
  });

  it.each([
    ["3 0301234567 4 0301234567", "3 [phone] [phone]"],
    ["0301234567 4 0301234567", "[phone] [phone]"],
    ["030 1234 5678 030 9876 5432", "[phone] [phone]"],
    ["Ruf 0170 1234567 0170 7654321 an", "Ruf [phone] [phone] an"],
    ["0301234567/0301234567", "[phone]/[phone]"],
    ["0301234567890123", "[phone]"],
    ["040 - 123 456 7 040 - 765 432 1", "[phone] [phone]"],
    ["030 / 123 456 78 030 / 987 654 32", "[phone] [phone]"],
    ["+49 30 1234 5678 +49 30 8765 4321", "[phone] [phone]"],
  ])("redacts German numbers written next to each other: %s", (text, expected) => {
    const result = redact(text, []);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/\d{2}/);
  });

  it("keeps a currency amount with a phone-shaped 3-3-3 grouping (accepted false negative)", () => {
    // Accepted risk: a 9-digit 3-3-3 phone number written directly next to a currency marker and
    // without a phone cue reads as an amount and is kept.
    expect(redact("612 345 678 Euro", [])).toBe("612 345 678 Euro");
  });

  it("still redacts a phone number that follows a currency amount", () => {
    expect(redact("10 000 000 Euro, ruf 0170 1234567 an", [])).toBe("10 000 000 Euro, ruf [phone] an");
  });

  prop(
    "a generated German number is redacted, whatever its prefix, grouping and separators",
    { number: GermanNumber },
    ({ number }) => {
      const phone = germanNumber(number);
      return redact(sentence(phone), []) === redacted;
    },
  );

  prop(
    "a generated date is kept, in both the long and the short format",
    { day: Schema.Int, month: Schema.Int, year: Schema.Int, short: Schema.Boolean },
    ({ day, month, year, short }) => {
      const pad = (value: number) => String(value).padStart(2, "0");
      const validDay = (((day % 28) + 28) % 28) + 1;
      const validMonth = (((month % 12) + 12) % 12) + 1;
      const validYear = 1990 + (((year % 110) + 110) % 110);
      const date = short ? pad(validYear % 100) : `${pad(validDay)}.${pad(validMonth)}.${validYear}`;
      const text = `Am ${date} um 10:30 Uhr danke.`;
      return redact(text, []) === text;
    },
  );
});
