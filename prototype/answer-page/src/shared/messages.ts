// Flat message dictionary keyed by id. English only; German ships in R2.
export const messages = {
  "scale.legend": "How do you rate this?",
  "scale.1": "Very poor",
  "scale.2": "Poor",
  "scale.3": "Okay",
  "scale.4": "Good",
  "scale.5": "Very good",
  "save": "Save and continue",
  "next": "Next",
  "loading": "Loading your question…",
  "comment.label": "Want to say more?",
  "comment.hint": "Optional. Names, emails and links are removed.",
  "comment.leadSees": "Your Lead will see: {text}",
  "thanks.title": "Thank you!",
  "thanks.body": "Your answer is saved. Here is what you can do next:",
  "error": "Something went wrong. Please try again.",
  "step": "Question {n} of {m}",
} as const
export type MessageId = keyof typeof messages
export const t = (id: MessageId, vars?: Record<string, string | number>) => {
  let s: string = messages[id]
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]))
  return s
}
