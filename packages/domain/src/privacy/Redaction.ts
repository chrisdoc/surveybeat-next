export type RosterItem =
  | string
  | {
      readonly name?: string | null | undefined;
      readonly firstName?: string | null | undefined;
      readonly lastName?: string | null | undefined;
      readonly email?: string | null | undefined;
    };

export type Roster = ReadonlyArray<RosterItem>;

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'()[\]{},]+(?<![.,!?:;])/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;
const HANDLE_PATTERN = /(?:^|(?<=[^\w@]))@[A-Za-z0-9_]+(?=[^\w]|$)/g;

const GERMAN_PHONE_PATTERN =
  /(?<![\w+])(?:(?:\+|00)49[ /-]?(?:\(0\) ?)?|\(?0)(?:1[5-7]\d|[2-9]\d{1,4})\)?(?:(?: [-/] |[ /-])?\d{1,6}){1,6}(?!\w|[.,]\d)/g;

const PHONE_PATTERN =
  /(?:^|(?<=[^\w+]))(?<!\d[./-])((?:\+\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)(?:\d{2,5}[-.\s]?){1,4}\d{2,5})(?=[^\w]|$)/g;

const DATE_OR_YEAR_RANGE_PREFIX =
  /^(?:\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4} ?[-–] ?\d{4})(?!\d)/;

const PHONE_SEPARATOR = /[-.\s()+]/;

const LONE_DIGIT_BEFORE = /(?:^|(?<=[^\w+.,]))\d $/;

const THOUSANDS_GROUPED = /^[1-9]\d{0,2}([ \u00a0\u202f.,])\d{3}(?:\1\d{3})*$/;

const CURRENCY_BEFORE = /(?:[€$£]|(?<!\w)(?:EUR|USD|CHF|GBP)) ?$/i;

const CURRENCY_AFTER = /^(?:[.,]\d{1,2})? ?(?:[€$£]|Euros?|EUR|USD|Dollars?|CHF|Franken|GBP)(?!\w)/;

const PHONE_CUE_BEFORE =
  /(?<!\w)(?:tel|telefon|phone|ruf|anrufen|call|fax|mobil|mobile|handy|nr|nummer|number)\.?:? ?(?:[€$£]|EUR|USD|CHF|GBP)? ?$/i;

const isCurrencyAmount = (candidate: string, before: string, after: string): boolean =>
  THOUSANDS_GROUPED.test(candidate) &&
  !PHONE_CUE_BEFORE.test(before) &&
  (CURRENCY_BEFORE.test(before) || CURRENCY_AFTER.test(after));

const redactGenericPhones = (text: string): string => {
  const pattern = new RegExp(PHONE_PATTERN.source, "g");
  let result = "";
  let kept = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const candidate = match[1] ?? "";
    const start = match.index + match[0].indexOf(candidate);
    const end = start + candidate.length;
    const date = DATE_OR_YEAR_RANGE_PREFIX.exec(candidate)?.[0];
    if (date !== undefined) {
      pattern.lastIndex = start + date.length;
    } else if (
      (candidate.match(/\d/g) ?? []).length >= 7 &&
      PHONE_SEPARATOR.test(candidate) &&
      !isCurrencyAmount(candidate, text.slice(0, start), text.slice(end))
    ) {
      const lone = LONE_DIGIT_BEFORE.exec(text.slice(0, start));
      const from = lone !== null && start - 2 >= kept ? start - 2 : start;
      result += text.slice(kept, from) + "[phone]";
      kept = end;
    }
  }
  return result + text.slice(kept);
};

const INTERNATIONAL_GERMAN_PREFIX = /^(?:\+|00)49/;

const germanSignificantDigits = (match: string): number => {
  const international = INTERNATIONAL_GERMAN_PREFIX.test(match);
  const body = match.replace(INTERNATIONAL_GERMAN_PREFIX, "").replace("(0)", "");
  const digits = (body.match(/\d/g) ?? []).length;
  return international ? digits : digits - 1;
};

const PHONE_SPLIT_CHARACTER = /[ /-]/;

const GERMAN_NUMBER_START = /^(?: [-/] |[ /-])\(?(?:(?:\+|00)49|0)/;

const redactGermanPhones = (text: string): string => {
  const pattern = new RegExp(GERMAN_PHONE_PATTERN.source, "g");
  let result = "";
  let kept = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const start = match.index;
    const digits = germanSignificantDigits(match[0]);
    if (digits < 7) continue;
    let end = start + match[0].length;
    if (digits > 12) {
      let cut: number | undefined;
      for (let i = 1; i < match[0].length; i++) {
        if (!PHONE_SPLIT_CHARACTER.test(match[0].charAt(i))) continue;
        const prefixDigits = germanSignificantDigits(match[0].slice(0, i));
        if (prefixDigits > 12) break;
        if (prefixDigits < 7) continue;
        cut ??= i;
        if (GERMAN_NUMBER_START.test(match[0].slice(i))) {
          cut = i;
          break;
        }
      }
      if (cut !== undefined) {
        end = start + cut;
        pattern.lastIndex = end;
      }
    }
    result += text.slice(kept, start) + "[phone]";
    kept = end;
  }
  return result + text.slice(kept);
};

const stripDiacritics = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

interface CandidateName {
  readonly norm: string;
  readonly words: ReadonlyArray<string>;
  readonly wordCount: number;
}

const extractCandidateNames = (roster: Roster): ReadonlyArray<CandidateName> => {
  const rawNames = new Set<string>();

  for (const item of roster) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.includes("@")) {
        const localPart = trimmed.split("@")[0] ?? "";
        if (localPart) {
          rawNames.add(localPart);
          for (const sub of localPart.split(/[._-]/)) {
            if (sub) rawNames.add(sub);
          }
        }
      } else {
        rawNames.add(trimmed);
        for (const sub of trimmed.split(/\s+/)) {
          if (sub) rawNames.add(sub);
        }
      }
    } else if (item && typeof item === "object") {
      if (item.name) {
        rawNames.add(item.name.trim());
        for (const sub of item.name.trim().split(/\s+/)) {
          if (sub) rawNames.add(sub);
        }
      }
      if (item.firstName) rawNames.add(item.firstName.trim());
      if (item.lastName) rawNames.add(item.lastName.trim());
      if (item.email) {
        const localPart = item.email.trim().split("@")[0] ?? "";
        if (localPart) {
          rawNames.add(localPart);
          for (const sub of localPart.split(/[._-]/)) {
            if (sub) rawNames.add(sub);
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  const candidates: Array<CandidateName> = [];

  for (const name of rawNames) {
    const norm = stripDiacritics(name.trim());
    if (norm.length < 2 || seen.has(norm)) continue;
    seen.add(norm);

    const words = norm.split(/\s+/).filter((w) => w.length > 0);
    if (words.length > 0) {
      candidates.push({
        norm,
        words,
        wordCount: words.length,
      });
    }
  }

  return candidates.sort((a, b) => b.wordCount - a.wordCount || b.norm.length - a.norm.length);
};

const redactNames = (text: string, candidates: ReadonlyArray<CandidateName>): string => {
  if (candidates.length === 0) return text;

  const segmenter = new Intl.Segmenter("en", { granularity: "word" });
  const segments = [...segmenter.segment(text)];

  let result = "";
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];
    if (seg === undefined) break;

    if (!seg.isWordLike) {
      result += seg.segment;
      i++;
      continue;
    }

    let matched = false;

    for (const candidate of candidates) {
      if (candidate.wordCount > 1) {
        let wordIdx = i;
        let matchedCount = 0;
        let spanEnd = i;
        const collectedWords: Array<string> = [];
        let possessiveSuffix = "";

        while (wordIdx < segments.length && matchedCount < candidate.wordCount) {
          const nextSeg = segments[wordIdx];
          if (nextSeg === undefined) break;
          if (nextSeg.isWordLike) {
            let segWord = nextSeg.segment;
            if (matchedCount === candidate.wordCount - 1) {
              if (segWord.endsWith("'s") || segWord.endsWith("’s")) {
                possessiveSuffix = segWord.slice(-2);
                segWord = segWord.slice(0, -2);
              }
            }
            collectedWords.push(stripDiacritics(segWord));
            matchedCount++;
            spanEnd = wordIdx;
          }
          wordIdx++;
        }

        if (matchedCount === candidate.wordCount && collectedWords.join(" ") === candidate.words.join(" ")) {
          result += "[name]" + possessiveSuffix;
          i = spanEnd + 1;
          matched = true;
          break;
        }
      } else {
        let word = seg.segment;
        let suffix = "";
        if (word.endsWith("'s") || word.endsWith("’s")) {
          suffix = word.slice(-2);
          word = word.slice(0, -2);
        }

        if (stripDiacritics(word) === candidate.norm) {
          result += "[name]" + suffix;
          i++;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      result += seg.segment;
      i++;
    }
  }

  return result;
};

export const redact = (text: string, roster: Roster): string => {
  if (!text) return "";

  const normalized = text.normalize("NFC");
  const bounded = normalized.length > 1000 ? normalized.slice(0, 1000) : normalized;

  let result = bounded.replace(URL_PATTERN, "[link]");

  result = result.replace(EMAIL_PATTERN, "[email]");

  result = result.replace(HANDLE_PATTERN, "[handle]");

  result = redactGermanPhones(result);

  result = redactGenericPhones(result);

  const candidates = extractCandidateNames(roster);
  result = redactNames(result, candidates);

  return result;
};
