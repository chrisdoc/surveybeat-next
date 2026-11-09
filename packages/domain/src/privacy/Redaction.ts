/**
 * Rule-based comment redaction (ADR 0001, ADR 0009).
 * Runs at store time in the Submission Worker so that no raw comment is ever kept at rest.
 */

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

// 7+ digits with common separators (+, -, ., space, parentheses, slash)
const PHONE_PATTERN =
  /(?:^|(?<=[^\w+]))((?:\+\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)(?:\d{2,5}[-.\s]?){1,4}\d{2,5})(?=[^\w]|$)/g;

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

  // Greedy match: multi-word names first, then longer names
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
        // Multi-word name lookahead
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
        // Single word candidate
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

/**
 * Pure function to redact identifying info (URLs, emails, handles, phone numbers, and roster names)
 * from comments according to ADR 0001 and ADR 0009.
 */
export const redact = (text: string, roster: Roster): string => {
  if (!text) return "";

  // 1,000-character limit counted after Unicode normalization
  const normalized = text.normalize("NFC");
  const bounded = normalized.length > 1000 ? normalized.slice(0, 1000) : normalized;

  // 1. Redact URLs
  let result = bounded.replace(URL_PATTERN, "[link]");

  // 2. Redact Email addresses
  result = result.replace(EMAIL_PATTERN, "[email]");

  // 3. Redact @handles
  result = result.replace(HANDLE_PATTERN, "[handle]");

  // 4. Redact Phone numbers (7+ digits with separators, keeping plain numbers)
  result = result.replace(PHONE_PATTERN, (match, p1: string) => {
    const digits = (p1.match(/\d/g) ?? []).length;
    const hasSeparators = /[-.\s()+]/.test(p1);
    if (digits >= 7 && hasSeparators) {
      return match.replace(p1, "[phone]");
    }
    return match;
  });

  // 5. Redact roster names
  const candidates = extractCandidateNames(roster);
  result = redactNames(result, candidates);

  return result;
};
