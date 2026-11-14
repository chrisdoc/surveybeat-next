/**
 * The English answer-page strings, kept apart from the app's catalog so the answer page ships only these
 * (ADR 0008 budget). `catalog.ts` spreads them in. The runtime `message` lives in `src/answer/answer-messages.ts`,
 * which keeps this module out of the German page's bundle.
 */
export const answerCatalog = {
  "answer.mark": "SurveyBeat",
  "answer.title": "Your answer",
  "answer.placeholder": "Your Question will appear here.",
  "answer.remaining.one": "{count} Question left",
  "answer.remaining.other": "{count} Questions left",
  "answer.closes": "Closes on {date}",
  "answer.save": "Save and continue",
  "answer.next": "Next",
  "answer.finish": "Finish",
  "answer.loading": "Loading your question\u2026",
  "answer.anonymity":
    "Your Lead only sees combined answers from at least {n} people. Your name is never stored.",
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
  "answer.test.banner": "This is a test. Your answers aren't saved.",
  "answer.test.thanks": "This was a test. Your answers weren't saved.",
  "answer.error": "Something went wrong. Please try again.",
  "answer.state.closed": "This check-in is closed.",
  "answer.state.alreadyAnswered": "You've already answered this check-in.",
  "answer.state.otherBrowser":
    "You answered this check-in in another browser. Your answers are anonymous and can only be changed from the browser you used to submit them.",
  "answer.noscript": "JavaScript is required to answer this check-in anonymously.",
} as const;

type AnswerCatalog = typeof answerCatalog;
export type AnswerKey = keyof AnswerCatalog;

/** Every answer key mapped to a translated string; each answer table must satisfy it. */
export type AnswerTranslation = { readonly [K in AnswerKey]: string };

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** Keys whose `{placeholders}` differ from English; `never` when the translation is consistent. */
export type AnswerMismatched<T extends AnswerTranslation> = {
  [K in AnswerKey]: Same<Placeholders<AnswerCatalog[K]>, Placeholders<T[K]>> extends true ? never : K;
}[AnswerKey];
