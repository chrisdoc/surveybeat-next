import { describe, expect, it } from "@effect/vitest";
import { weeklyTeamHealth } from "@surveybeat/domain";
import { Browser, SignInWorld } from "./auth/testing.ts";

/**
 * The Pulse editor API over HTTP: real handlers, the real editor rules and permission table, and
 * the in-memory Organization objects. Each role signs in through AuthKit (the fake).
 */

const setup = async () => {
  const world = new SignInWorld();
  const acme = world.addOrganization("Acme");
  world.addPerson(acme.id, "admin@example.com", true);
  const as = async (email: string) => {
    const browser = new Browser(world.handler());
    await browser.signIn(world.workos.addUser(email));
    await browser.session();
    return browser;
  };
  const admin = await as("admin@example.com");
  const created = await admin.call("POST", "/api/teams", {
    name: "Platform",
    timeZone: "Europe/Berlin",
    leadEmail: "grace@example.com",
  });
  const teamId = teamIdOf(created.body);
  const other = await admin.call("POST", "/api/teams", {
    name: "Design",
    timeZone: "UTC",
    leadEmail: "linus@example.com",
  });
  const otherTeamId = teamIdOf(other.body);
  const lead = await as("grace@example.com");
  await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" });
  const member = await as("ada@example.com");
  const otherLead = await as("linus@example.com");
  return { world, admin, lead, member, otherLead, teamId, otherTeamId };
};

const teamIdOf = (body: unknown): string => (body as { readonly team: { readonly id: string } }).team.id;

interface Detail {
  readonly id: string;
  readonly questions: ReadonlyArray<{
    readonly questionId: string;
    readonly templateKey: string | null;
    readonly text: string;
  }>;
  readonly estimatedSeconds: number;
  readonly warnings: ReadonlyArray<{ readonly _tag: string }>;
  readonly templateQuestions: ReadonlyArray<{ readonly key: string }>;
}

const createPulse = async (browser: Browser, teamId: string): Promise<Detail> => {
  const response = await browser.call("POST", `/api/teams/${teamId}/pulses`);
  expect(response.status).toBe(200);
  return response.body as Detail;
};

const settings = {
  name: "Friday check-in",
  cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
  answerWindowDays: 2,
  reviewWindowDays: 3,
  reminders: 2,
  anonymityMode: "anonymous",
  distribution: "invitation",
};

describe("a Lead", () => {
  it("creates a Pulse from the Template, with the default settings, the estimate, and the warnings", async () => {
    const { lead, teamId } = await setup();
    const response = await lead.call("POST", `/api/teams/${teamId}/pulses`);
    expect(response).toMatchObject({
      status: 200,
      body: {
        team: { id: teamId, yourRole: "lead" },
        settings: {
          name: "Weekly team health",
          cadence: { _tag: "Weekly", day: "monday", time: "09:00" },
          answerWindowDays: 3,
          reviewWindowDays: 3,
          reminders: 1,
          anonymityMode: "anonymous",
          distribution: "invitation",
        },
        questions: weeklyTeamHealth("en").questions.map(({ key, text }) => ({
          templateKey: key,
          text,
          hasAnswers: false,
        })),
        estimatedSeconds: 64,
        // Grace and Ada are two, below N = 4: a warning, and the Pulse exists anyway.
        warnings: [{ _tag: "TeamBelowMinimumGroupSize", members: 2, minimumGroupSize: 4 }],
        templateQuestions: [],
      },
    });
    expect(await lead.call("GET", `/api/teams/${teamId}/pulses`)).toMatchObject({
      status: 200,
      body: {
        team: { id: teamId },
        pulses: [
          {
            id: (response.body as Detail).id,
            name: "Weekly team health",
            questionCount: 6,
            estimatedSeconds: 64,
          },
        ],
      },
    });
  });

  it("removes, reorders, adds, and edits Questions, seeing the editor's view after each change", async () => {
    const { lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const base = `/api/teams/${teamId}/pulses/${pulse.id}`;
    const [first, ...rest] = pulse.questions.map(({ questionId }) => questionId);

    const removed = await lead.call("DELETE", `${base}/questions/${first}`);
    expect(removed.status).toBe(200);
    expect((removed.body as Detail).questions.map(({ questionId }) => questionId)).toEqual(rest);
    expect((removed.body as Detail).templateQuestions.map(({ key }) => key)).toEqual(["workload-manageable"]);

    const reordered = await lead.call("PUT", `${base}/order`, { order: [...rest].reverse() });
    expect((reordered.body as Detail).questions.map(({ questionId }) => questionId)).toEqual(
      [...rest].reverse(),
    );
    // The long text Question is first now: no one-tap from the email.
    expect((reordered.body as Detail).warnings.map(({ _tag }) => _tag)).toContain("NoOneTap");
    expect((await lead.call("PUT", `${base}/order`, { order: rest.slice(1) })).body).toMatchObject({
      _tag: "OrderMismatch",
    });

    const fromTemplate = await lead.call("POST", `${base}/questions`, {
      _tag: "FromTemplate",
      key: "workload-manageable",
    });
    // A new library Question, copied from the Template again.
    expect((fromTemplate.body as Detail).questions.at(-1)).toMatchObject({
      templateKey: "workload-manageable",
      text: weeklyTeamHealth("en").questions[0]?.text,
    });
    expect((fromTemplate.body as Detail).questions.at(-1)?.questionId).not.toBe(first);
    expect(
      await lead.call("POST", `${base}/questions`, { _tag: "FromTemplate", key: "workload-manageable" }),
    ).toMatchObject({ status: 409, body: { _tag: "QuestionAlreadyInPulse" } });

    const written = await lead.call("POST", `${base}/questions`, {
      _tag: "Written",
      text: "Which ritual should we drop?",
      dimension: null,
      type: { _tag: "SingleChoice", options: ["Stand-up", "Retro", "Planning"] },
    });
    expect(written.status).toBe(200);
    const added = (written.body as Detail).questions.at(-1);
    expect(added).toMatchObject({
      templateKey: null,
      text: "Which ritual should we drop?",
      estimatedSeconds: 10,
    });

    const edited = await lead.call("PUT", `${base}/questions/${added?.questionId}`, {
      text: "Anything else on your mind?",
      dimension: null,
      type: { _tag: "LongText" },
    });
    expect((edited.body as Detail).questions.at(-1)).toMatchObject({
      questionId: added?.questionId,
      text: "Anything else on your mind?",
      type: { _tag: "LongText" },
    });
    // Seven Questions: 4 ratings, a choice, two long texts → 94 s, over about 90.
    expect((edited.body as Detail).estimatedSeconds).toBe(94);
    expect((edited.body as Detail).warnings.map(({ _tag }) => _tag)).toEqual([
      "TooLong",
      "NoOneTap",
      "TeamBelowMinimumGroupSize",
    ]);
  });

  it("changes the settings within the Release 1 limits", async () => {
    const { lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const path = `/api/teams/${teamId}/pulses/${pulse.id}/settings`;
    expect(await lead.call("PUT", path, settings)).toMatchObject({ status: 200, body: { settings } });
    for (const patch of [
      { cadence: { _tag: "Weekly", day: "friday", time: "05:30" } },
      { cadence: { _tag: "Weekly", day: "friday", time: "21:30" } },
      { answerWindowDays: 7 },
      { answerWindowDays: 0 },
      { reviewWindowDays: 8 },
      { reviewWindowDays: -1 },
      { reminders: 3 },
      { anonymityMode: "attributed" },
      { distribution: "link" },
    ]) {
      expect((await lead.call("PUT", path, { ...settings, ...patch })).status, JSON.stringify(patch)).toBe(
        400,
      );
    }
    expect((await lead.call("GET", `/api/teams/${teamId}/pulses/${pulse.id}`)).body).toMatchObject({
      settings,
    });
  });

  it("refuses Questions the schemas do not allow", async () => {
    const { lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const path = `/api/teams/${teamId}/pulses/${pulse.id}/questions`;
    for (const question of [
      { _tag: "Written", text: "", dimension: null, type: { _tag: "LongText" } },
      { _tag: "Written", text: "Score?", dimension: null, type: { _tag: "Enps" } },
      { _tag: "Written", text: "Pick", dimension: null, type: { _tag: "SingleChoice", options: ["Only"] } },
      { _tag: "Written", text: "Rate", dimension: "mood", type: { _tag: "LongText" } },
    ]) {
      expect((await lead.call("POST", path, question)).status, JSON.stringify(question)).toBe(400);
    }
    expect(await lead.call("POST", path, { _tag: "FromTemplate", key: "no-such-question" })).toMatchObject({
      status: 404,
      body: { _tag: "QuestionNotFound" },
    });
  });

  it("may not see or change another Team's Pulses", async () => {
    const { lead, otherLead, otherTeamId, teamId } = await setup();
    const theirs = await createPulse(otherLead, otherTeamId);
    expect((await lead.call("GET", `/api/teams/${otherTeamId}/pulses`)).status).toBe(403);
    expect((await lead.call("POST", `/api/teams/${otherTeamId}/pulses`)).status).toBe(403);
    expect((await lead.call("GET", `/api/teams/${otherTeamId}/pulses/${theirs.id}`)).status).toBe(403);
    // Through their own Team, another Team's Pulse does not exist.
    expect(await lead.call("GET", `/api/teams/${teamId}/pulses/${theirs.id}`)).toMatchObject({
      status: 404,
      body: { _tag: "PulseNotFound" },
    });
    expect(
      (
        await lead.call(
          "DELETE",
          `/api/teams/${teamId}/pulses/${theirs.id}/questions/${theirs.questions[0]?.questionId}`,
        )
      ).status,
    ).toBe(404);
  });
});

describe("an Organization admin", () => {
  it("creates and edits a Team's Pulses without being in the Team", async () => {
    const { admin, teamId } = await setup();
    const pulse = await createPulse(admin, teamId);
    expect(
      await admin.call("PUT", `/api/teams/${teamId}/pulses/${pulse.id}/settings`, settings),
    ).toMatchObject({
      status: 200,
      body: { team: { yourRole: null }, settings },
    });
    expect((await admin.call("GET", `/api/teams/${teamId}/pulses`)).status).toBe(200);
    expect((await admin.call("GET", `/api/teams/${teamId}`)).body).toMatchObject({
      may: { managePulses: true },
    });
  });
});

describe("a member", () => {
  it("may not see or change the Team's Pulses", async () => {
    const { lead, member, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const base = `/api/teams/${teamId}/pulses/${pulse.id}`;
    const questionId = pulse.questions[0]?.questionId;
    for (const [method, path, body] of [
      ["GET", `/api/teams/${teamId}/pulses`, undefined],
      ["POST", `/api/teams/${teamId}/pulses`, undefined],
      ["GET", base, undefined],
      ["PUT", `${base}/settings`, settings],
      ["POST", `${base}/questions`, { _tag: "FromTemplate", key: "workload-manageable" }],
      ["PUT", `${base}/questions/${questionId}`, { text: "X?", dimension: null, type: { _tag: "LongText" } }],
      ["DELETE", `${base}/questions/${questionId}`, undefined],
      ["PUT", `${base}/order`, { order: [] }],
    ] as const) {
      expect((await member.call(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
  });
});

describe("every Pulse endpoint", () => {
  const ENDPOINTS: ReadonlyArray<readonly [string, string, unknown]> = [
    ["GET", "/api/teams/t/pulses", undefined],
    ["POST", "/api/teams/t/pulses", undefined],
    ["GET", "/api/teams/t/pulses/p", undefined],
    ["PUT", "/api/teams/t/pulses/p/settings", settings],
    ["POST", "/api/teams/t/pulses/p/questions", { _tag: "FromTemplate", key: "workload-manageable" }],
    ["PUT", "/api/teams/t/pulses/p/questions/q", { text: "X?", dimension: null, type: { _tag: "LongText" } }],
    ["DELETE", "/api/teams/t/pulses/p/questions/q", undefined],
    ["PUT", "/api/teams/t/pulses/p/order", { order: [] }],
  ];

  it.each(ENDPOINTS)("%s %s answers 401 without a session", async (method, path, body) => {
    const world = new SignInWorld();
    expect((await new Browser(world.handler()).send(method, path, body)).status).toBe(401);
  });

  it("refuses changes from another origin", async () => {
    const { world, lead, teamId } = await setup();
    const response = await lead.send(
      "POST",
      `/api/teams/${teamId}/pulses`,
      undefined,
      "https://pr-1.submit.surveybeat.app",
    );
    expect(response.status).toBe(403);
    expect([...world.durable.organizations.values()].every(({ pulses }) => pulses.pulses.length === 0)).toBe(
      true,
    );
  });

  it("never reaches another Organization's Teams", async () => {
    const { world, teamId } = await setup();
    const globex = world.addOrganization("Globex");
    world.addPerson(globex.id, "boss@example.com", true);
    const outsider = new Browser(world.handler());
    await outsider.signIn(world.workos.addUser("boss@example.com"));
    await outsider.session();
    expect((await outsider.call("GET", `/api/teams/${teamId}/pulses`)).status).toBe(404);
    expect((await outsider.call("POST", `/api/teams/${teamId}/pulses`)).status).toBe(404);
  });
});
