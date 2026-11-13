import type { Page } from "@playwright/test";

/**
 * The signed-in screens without a session: every read `/auth/session` and `/api` answer is stubbed
 * from the values below, so a test can open a settings, Teams, or Rounds screen on a stage where
 * the only session is WorkOS's (SPEC §7's flow is still `test.fixme`). Nothing here changes what
 * the screens do; it only supplies the reads they make.
 *
 * The Team is one the caller leads, so the Rounds screen shows its Lead controls, and the two
 * People are one Member and one Organization admin. The stubbed clock-free dates keep the copy
 * stable: `2026-03-02` reads as a Medium date in whichever locale the app is in.
 */
const ORGANIZATION = { id: "org-1", name: "Acme" };

const TEAM = {
  id: "team-1",
  name: "Platform",
  timeZone: "Europe/Berlin",
  yourRole: "lead" as const,
  memberCount: 5,
  nextRoundDate: "2026-03-02",
};

const PULSE = {
  id: "pulse-1",
  name: "Weekly Pulse",
  cadence: { _tag: "Weekly" as const, day: "monday" as const, time: "09:00" },
  questionCount: 3,
  estimatedSeconds: 60,
  paused: false,
  nextRoundDate: "2026-03-02",
};

const ROUND = {
  id: "round-1",
  pulseId: "pulse-1",
  teamId: "team-1",
  status: "ready" as const,
  plannedOpenDate: "2026-03-02",
  plannedOpenAt: 1772442000000,
  openedAt: 1772442000000,
  plannedCloseAt: 1772528400000,
  closedAt: 1772528400000,
  pulseName: "Weekly Pulse",
};

const SETTINGS = {
  name: "Acme",
  minimumGroupSize: 4,
  aiProcessing: false,
  defaultLocale: "en" as const,
  people: [
    { personId: "person-1", email: "ada@example.com", organizationAdmin: false, linked: true },
    { personId: "person-2", email: "grace@example.com", organizationAdmin: true, linked: true },
  ],
};

const SESSION = {
  _tag: "SignedIn" as const,
  organization: ORGANIZATION,
  personId: "person-1",
  organizationAdmin: true,
  locale: "en" as const,
  detectedLocale: "en" as const,
  organizationLocale: "en" as const,
};

/** What a path answers: a body for the reads above, or 404 for anything else (and the Round's rate). */
const answerFor = (pathname: string): unknown => {
  if (pathname === "/auth/session") return SESSION;
  if (pathname === "/api/organization") return SETTINGS;
  if (pathname === "/api/organization/failed-emails") return { emails: [] };
  if (pathname === "/api/teams") return [TEAM];
  if (pathname === "/api/teams/team-1")
    return {
      team: TEAM,
      roster: [{ personId: "person-1", email: "ada@example.com", role: "lead", since: 1767225600000 }],
      may: {
        update: true,
        manageLeads: true,
        manageMembers: true,
        managePulses: true,
        viewResults: true,
      },
    };
  if (pathname === "/api/teams/team-1/pulses") return { team: TEAM, pulses: [PULSE] };
  if (pathname === "/api/teams/team-1/pulses/pulse-1/rounds")
    return { pulseId: "pulse-1", paused: false, rounds: [ROUND] };
  if (pathname === "/api/teams/team-1/actions") return { teamId: "team-1", actions: [] };
  return undefined;
};

export const stubSignedIn = async (page: Page): Promise<void> => {
  // One handler for both routes so a new read is one line above, not another `page.route`.
  await page.route("**/auth/session", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SESSION),
    });
  });
  await page.route("**/api/**", (route) => {
    const body = answerFor(new URL(route.request().url()).pathname);
    void route.fulfill({
      status: body === undefined ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify(body ?? {}),
    });
  });
};
