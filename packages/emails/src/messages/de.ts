import type { Mismatched, Translation } from "./index.ts";

/** German (informal "du"). Keys follow `catalog.ts` in the same order; `{placeholder}` names stay English. */
export const de = {
  "layout.brand": "SurveyBeat",
  "layout.signature":
    "SurveyBeat hilft Teams, in kurzen Check-ins mit wenigen Fragen auf einmal zu erfahren, wie es allen geht.",

  "addedToTeam.subject": "Du wurdest zu {team} hinzugefügt",
  "addedToTeam.preview": "{lead} hat dich bei SurveyBeat zu {team} hinzugefügt.",
  "addedToTeam.heading": "Du wurdest zu {team} hinzugefügt",
  "addedToTeam.body":
    "{lead} hat dich bei SurveyBeat zu {team} hinzugefügt. Das Team nutzt SurveyBeat für kurze, regelmäßige Check-ins darüber, wie es allen geht.",
  "addedToTeam.action": "SurveyBeat öffnen",
  "addedToTeam.link": "Falls die Schaltfläche nicht funktioniert, öffne diesen Link:",
  "addedToTeam.reason": "Du hast diese E-Mail erhalten, weil {lead} dich zu {team} hinzugefügt hat.",

  "invitation.subject": "{pulse}",
  "invitation.preview": "Dein Check-in für {pulse} ist offen.",
  "invitation.anonymity":
    "Deine Teamleitung sieht nur gesammelte Antworten von mindestens {n} Personen, aber nie, wer was geantwortet hat. Dein Name wird nie zusammen mit deinen Antworten gespeichert.",
  "invitation.openCheckIn": "Check-in öffnen",
  "invitation.changeWhen": "Zustellzeit ändern",
  "invitation.personalNotice": "Dieser Link ist persönlich. Bitte nicht weiterleiten.",
  "invitation.reason": "Du hast diese E-Mail erhalten, weil du Mitglied des Teams bist.",
  "privacy.aiNotice":
    "Kommentare werden von einem KI-Dienst in der EU zusammengefasst, nachdem Namen, E-Mail-Adressen, Telefonnummern, Handles und Links entfernt wurden. Er speichert nichts.",
  "invitation.actionsHeading": "Laufende Maßnahmen im Team",

  "reminder.subject": "Erinnerung: {pulse}",
  "reminder.preview": "Du hast noch Zeit, deinen Check-in für {pulse} abzuschließen.",
  "reminder.heading": "Erinnerung: {pulse}",
  "reminder.body":
    "Dein Check-in wartet noch auf dich. Nimm dir einen Moment und teile mit, wie es gerade läuft.",
  "reminder.unsubscribe": "Erinnerungen für diesen Pulse ausschalten",

  "resultsReady.subject": "Ergebnisse sind da: {pulse}",
  "resultsReady.preview": "Die Ergebnisse für {pulse} sind jetzt verfügbar.",
  "resultsReady.heading": "Die Ergebnisse für {pulse} sind da",
  "resultsReady.body":
    "Der Check-in ist abgeschlossen, die Rücklaufquote lag bei {responseRate} %. Sieh dir an, was sich verändert hat und wie es im Team läuft.",
  "resultsReady.action": "Ergebnisse ansehen",
  "resultsReady.link": "Falls die Schaltfläche nicht funktioniert, öffne diesen Link:",
  "resultsReady.reason": "Du hast diese E-Mail erhalten, weil du Mitglied von {team} bist.",
} as const satisfies Translation;

// Fails to compile, naming the key, when a German string's {placeholders} differ from English.
const placeholdersMatch: [Mismatched<typeof de>] extends [never] ? true : Mismatched<typeof de> = true;
void placeholdersMatch;
