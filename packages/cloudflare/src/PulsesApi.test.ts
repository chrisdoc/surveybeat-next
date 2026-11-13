import { describe, expect, it } from "@effect/vitest";
import { SendId, type SendState, weeklyTeamHealth } from "@surveybeat/domain";
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
    ["POST", "/api/teams/t/pulses/p/test-invitation", undefined],
    ["GET", "/api/teams/t/pulses/p/test-invitations/s", undefined],
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

/** The test Invitations sent so far, across every Organization (ADR 0021). */
const testSends = (world: SignInWorld) =>
  [...world.durable.organizations.values()]
    .flatMap(({ sends }) => [...sends.values()])
    .filter(({ email }) => email._tag === "TestInvitationEmail");

describe("sending a test of a Pulse (ADR 0021)", () => {
  const testPath = (teamId: string, pulseId: string) =>
    `/api/teams/${teamId}/pulses/${pulseId}/test-invitation`;

  it("sends a Lead the test to their own address, and nobody else", async () => {
    const { world, lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    expect(await lead.call("POST", testPath(teamId, pulse.id))).toMatchObject({
      status: 200,
      body: { email: "grace@example.com", sendId: expect.any(String) },
    });
    expect(testSends(world).map(({ recipient, email }) => [recipient, email._tag])).toEqual([
      ["grace@example.com", "TestInvitationEmail"],
    ]);
  });

  it("sends an Organization admin the test to their own address", async () => {
    const { admin, teamId } = await setup();
    const pulse = await createPulse(admin, teamId);
    expect(await admin.call("POST", testPath(teamId, pulse.id))).toMatchObject({
      status: 200,
      body: { email: "admin@example.com" },
    });
  });

  it("refuses a plain member, and sends nothing", async () => {
    const { world, lead, member, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    expect((await member.call("POST", testPath(teamId, pulse.id))).status).toBe(403);
    expect(testSends(world)).toEqual([]);
  });

  it("refuses a Lead of another Team, and a Pulse of another Team", async () => {
    const { world, lead, otherLead, teamId, otherTeamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    expect((await otherLead.call("POST", testPath(teamId, pulse.id))).status).toBe(403);
    expect((await otherLead.call("POST", testPath(otherTeamId, pulse.id))).status).toBe(404);
    expect(testSends(world)).toEqual([]);
  });

  it("refuses a sixth test in the hour, with the limit", async () => {
    const { lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await lead.call("POST", testPath(teamId, pulse.id))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(await lead.call("POST", testPath(teamId, pulse.id))).toMatchObject({
      status: 429,
      body: { _tag: "TestSendLimitReached", perHour: 5 },
    });
  });

  it("refuses a test from another origin, and sends nothing", async () => {
    const { world, lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const response = await lead.send(
      "POST",
      testPath(teamId, pulse.id),
      undefined,
      "https://pr-1.submit.surveybeat.app",
    );
    expect(response.status).toBe(403);
    expect(testSends(world)).toEqual([]);
  });
});

/** The state the sender reads back for one test send: the editor's poll (ADR 0021). */
describe("reading a test send's state (issue 147)", () => {
  const testPath = (teamId: string, pulseId: string) =>
    `/api/teams/${teamId}/pulses/${pulseId}/test-invitation`;
  const statePath = (teamId: string, pulseId: string, sendId: string) =>
    `/api/teams/${teamId}/pulses/${pulseId}/test-invitations/${sendId}`;

  /** Sets a test send's email state by hand: the fake never delivers, so a test decides how it ends. */
  const setState = (world: SignInWorld, sendId: string, state: SendState) => {
    for (const organization of world.durable.organizations.values()) {
      const send = organization.sends.get(SendId.make(sendId));
      if (send !== undefined) organization.sends.set(SendId.make(sendId), { ...send, state });
    }
  };

  /** Sends a test as the Lead, and returns its id. */
  const sendTest = async (lead: Browser, teamId: string, pulseId: string) =>
    ((await lead.call("POST", testPath(teamId, pulseId))).body as { readonly sendId: string }).sendId;

  it("is Queued from the send, with no message, token, or address in it", async () => {
    const { lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const sendId = await sendTest(lead, teamId, pulse.id);
    const status = await lead.call("GET", statePath(teamId, pulse.id, sendId));
    expect(status).toMatchObject({
      status: 200,
      body: {
        queuedAt: expect.any(Number),
        checkedAt: expect.any(Number),
        state: { _tag: "Queued", attempts: 0, lastCode: null },
      },
    });
    expect(Object.keys(status.body as object).sort()).toEqual(["checkedAt", "queuedAt", "state"]);
  });

  it("follows the send through each state the queue can put it in", async () => {
    const { world, lead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const sendId = await sendTest(lead, teamId, pulse.id);
    const path = statePath(teamId, pulse.id, sendId);

    setState(world, sendId, { _tag: "Sending", attempt: 2, leaseExpiresAt: 99 });
    expect((await lead.call("GET", path)).body).toMatchObject({ state: { _tag: "Sending", attempt: 2 } });

    setState(world, sendId, { _tag: "Sent", messageId: "provider-7", sentAt: 4 });
    const sent = await lead.call("GET", path);
    expect(sent.body).toMatchObject({ state: { _tag: "Sent", sentAt: 4 } });
    expect(JSON.stringify(sent.body)).not.toContain("provider-7");

    setState(world, sendId, {
      _tag: "Failed",
      reason: "rejected",
      code: "E_SENDER_NOT_VERIFIED",
      failedAt: 9,
    });
    expect((await lead.call("GET", path)).body).toMatchObject({
      state: { _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: 9 },
    });
  });

  it("is not found to anyone but the sender, for another Pulse, or for a send that never was", async () => {
    const { admin, lead, otherLead, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const other = await createPulse(lead, teamId);
    const sendId = await sendTest(lead, teamId, pulse.id);

    // An admin may edit the Team's Pulses, but this send is the Lead's own.
    expect(await admin.call("GET", statePath(teamId, pulse.id, sendId))).toMatchObject({
      status: 404,
      body: { _tag: "TestSendNotFound" },
    });
    expect(await lead.call("GET", statePath(teamId, other.id, sendId))).toMatchObject({
      status: 404,
      body: { _tag: "TestSendNotFound" },
    });
    expect(await lead.call("GET", statePath(teamId, pulse.id, "no-such-send"))).toMatchObject({
      status: 404,
      body: { _tag: "TestSendNotFound" },
    });
    expect((await otherLead.call("GET", statePath(teamId, pulse.id, sendId))).status).toBe(403);
  });

  it("is refused to a plain member, even for their own send", async () => {
    const { lead, member, teamId } = await setup();
    const pulse = await createPulse(lead, teamId);
    const sendId = await sendTest(lead, teamId, pulse.id);
    expect((await member.call("GET", statePath(teamId, pulse.id, sendId))).status).toBe(403);
  });
});
