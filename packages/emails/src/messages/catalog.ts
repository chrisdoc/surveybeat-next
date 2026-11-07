/**
 * Every user-facing string of the emails. English only. Same conventions as `apps/web/src/messages`:
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
} as const;
