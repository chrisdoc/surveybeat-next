import type { AnswerMismatched, AnswerTranslation } from "./answer.ts";

/**
 * German answer-page strings (ADR 0018). Same keys, same order as `answerCatalog`. Kept apart from `de.ts`
 * so the German answer page ships only these (ADR 0008 budget); `de.ts` spreads them in.
 */
export const answerDe = {
  "answer.mark": "SurveyBeat",
  "answer.title": "Deine Antwort",
  "answer.placeholder": "Deine Frage erscheint hier.",
  "answer.remaining.one": "Noch {count} Frage",
  "answer.remaining.other": "Noch {count} Fragen",
  "answer.closes": "Schließt am {date}",
  "answer.save": "Speichern und weiter",
  "answer.next": "Weiter",
  "answer.finish": "Abschließen",
  "answer.loading": "Deine Frage wird geladen…",
  "answer.anonymity":
    "Deine Teamleitung sieht nur zusammengefasste Antworten von mindestens {n} Personen. Dein Name wird nie gespeichert.",
  "answer.aiNotice":
    "Kommentare werden nach dem Entfernen von Namen, E-Mail-Adressen, Telefonnummern, Handles und Links von einem KI-Dienst in der EU zusammengefasst. Er speichert nichts.",
  "answer.comment.label": "Möchtest du noch etwas sagen?",
  "answer.comment.hint": "Optional. Namen, E-Mail-Adressen und Links werden entfernt.",
  "answer.comment.disclosure":
    "Deine Teamleitung liest Kommentare wörtlich, sobald mindestens 4 Personen geantwortet haben. Wir entfernen Namen von Personen in deiner Organisation, E-Mail-Adressen, Telefonnummern, Handles und Links. Andere Details entfernen wir nicht, also lass alles weg, was dich identifiziert.",
  "answer.comment.leadSees": "Deine Teamleitung sieht: {text}",
  "answer.thanks.title": "Danke!",
  "answer.thanks.body": "Deine Antwort ist gespeichert. Das kannst du als Nächstes tun:",
  "answer.thanks.bodyNoActions": "Deine Antwort ist gespeichert.",
  "answer.test.banner": "Dies ist ein Test. Deine Antworten werden nicht gespeichert.",
  "answer.test.thanks": "Das war ein Test. Deine Antworten wurden nicht gespeichert.",
  "answer.error": "Etwas ist schiefgelaufen. Versuch es bitte noch einmal.",
  "answer.state.closed": "Dieser Check-in ist geschlossen.",
  "answer.state.alreadyAnswered": "Du hast diesen Check-in bereits beantwortet.",
  "answer.state.otherBrowser":
    "Du hast diesen Check-in in einem anderen Browser beantwortet. Deine Antworten sind anonym und können nur in dem Browser geändert werden, mit dem du sie abgeschickt hast.",
  "answer.noscript": "JavaScript wird benötigt, um diesen Check-in anonym zu beantworten.",
} as const satisfies AnswerTranslation;

// Fails to compile, naming the key, when a German string's {placeholders} differ from English.
const placeholdersMatch: [AnswerMismatched<typeof answerDe>] extends [never]
  ? true
  : AnswerMismatched<typeof answerDe> = true;
void placeholdersMatch;
