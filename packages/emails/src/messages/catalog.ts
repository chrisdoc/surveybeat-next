/**
 * Every user-facing string of the emails, in English: the source of the keys and placeholders. German
 * lives in `de.ts`, checked against these keys at compile time. Same conventions as `apps/web/src/messages`:
 * flat keys, `{placeholder}` templates.
 */
export const catalog = {
  "layout.brand": "SurveyBeat",
  "layout.signature": "SurveyBeat helps teams check in on how they are doing, a few questions at a time.",

  "addedToTeam.subject": "You've been added to {team}",
  "addedToTeam.preview": "{lead} added you to {team} on SurveyBeat.",
  "addedToTeam.heading": "You've been added to {team}",
  "addedToTeam.body":
    "{lead} added you to {team} on SurveyBeat. The team uses it for short, regular check-ins on how everyone is doing.",
  "addedToTeam.action": "Open SurveyBeat",
  "addedToTeam.link": "If the button does not work, open this link:",
  "addedToTeam.reason": "You received this email because {lead} added you to {team}.",

  "invitation.subject": "{pulse}",
  "invitation.preview": "Your check-in for {pulse} is open.",
  "invitation.anonymity":
    "Your lead only sees combined answers from at least {n} people, never who answered what. Your name is never stored with your answers.",
  "invitation.openCheckIn": "Open check-in",
  "invitation.changeWhen": "Change when I get this",
  "invitation.personalNotice": "This link is personal. Don't forward it.",
  "invitation.reason": "You received this email because you are a member of the team.",
  "privacy.aiNotice":
    "Comments are summarised by an AI service in the EU after names, emails, phone numbers, handles and links are removed. It keeps nothing.",
  "invitation.actionsHeading": "Team actions in progress",

  "reminder.subject": "Reminder: {pulse}",
  "reminder.preview": "There is still time to complete your check-in for {pulse}.",
  "reminder.heading": "Reminder: {pulse}",
  "reminder.body": "Your check-in is still waiting. Take a moment to share how things are going.",
  "reminder.unsubscribe": "Turn off reminders for this Pulse",

  "resultsReady.subject": "Results are in: {pulse}",
  "resultsReady.preview": "The results for {pulse} are ready to view.",
  "resultsReady.heading": "Results are in for {pulse}",
  "resultsReady.body":
    "The check-in has closed with a {responseRate}% response rate. See what changed and how the team is doing.",
  "resultsReady.action": "View results",
  "resultsReady.link": "If the button does not work, open this link:",
  "resultsReady.reason": "You received this email because you are a member of {team}.",
} as const;
