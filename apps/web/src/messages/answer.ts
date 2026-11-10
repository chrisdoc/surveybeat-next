/**
 * The answer page's strings, kept apart from the app's catalog so the answer page
 * ships only these (ADR 0008 budget). `catalog.ts` spreads them in.
 */
export const answerCatalog = {
  "answer.title": "Your answer",
  "answer.placeholder": "Your Question will appear here.",
  "answer.remaining.one": "{count} Question left",
  "answer.remaining.other": "{count} Questions left",
  "answer.closes": "Closes on {date}",
  "answer.scale.1": "Very poor",
  "answer.scale.2": "Poor",
  "answer.scale.3": "Okay",
  "answer.scale.4": "Good",
  "answer.scale.5": "Very good",
  "answer.save": "Save and continue",
  "answer.next": "Next",
  "answer.finish": "Finish",
  "answer.loading": "Loading your question\u2026",
  "answer.anonymity":
    "Your lead only sees combined answers from at least {n} people, never who answered what. Your name is never stored with your answers.",
  "answer.aiNotice":
    "Comments are summarised by an AI service in the EU after names, emails, phone numbers, handles and links are removed. It keeps nothing.",
  "answer.comment.label": "Want to say more?",
  "answer.comment.hint": "Optional. Names, emails and links are removed.",
  "answer.comment.disclosure":
    "Your Lead reads comments word for word, once at least 4 people answer. We remove names of people in your organization, email addresses, phone numbers, handles and links. We don't remove other details, so leave out anything that identifies you.",
  "answer.comment.leadSees": "Your Lead will see: {text}",
  "answer.thanks.title": "Thank you!",
  "answer.thanks.body": "Your answer is saved. Here is what you can do next:",
  "answer.thanks.bodyNoActions": "Your answer is saved.",
  "answer.error": "Something went wrong. Please try again.",
  "answer.state.closed": "This check-in is closed.",
  "answer.state.alreadyAnswered": "You've already answered this check-in.",
  "answer.state.otherBrowser":
    "You answered this check-in in another browser. Your answers are anonymous and can only be changed from the browser you used to submit them.",
  "answer.noscript": "JavaScript is required to answer this check-in anonymously.",
} as const;

type AnswerCatalog = typeof answerCatalog;
type Key = keyof AnswerCatalog;
type Value = string | number;
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;
type KeysWithoutParams = {
  [K in Key]: [Placeholders<AnswerCatalog[K]>] extends [never] ? K : never;
}[Key];
type KeysWithParams = Exclude<Key, KeysWithoutParams>;

/** Fills `{placeholder}` templates. */
function fill(template: string, params: Readonly<Record<string, Value>>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/** Looks up an answer-page message; placeholders are checked at compile time. */
export function message<K extends KeysWithoutParams>(key: K): string;
export function message<K extends KeysWithParams>(
  key: K,
  params: Readonly<Record<Placeholders<AnswerCatalog[K]>, Value>>,
): string;
export function message(key: Key, params: Readonly<Record<string, Value>> = {}): string {
  return fill(answerCatalog[key], params);
}
