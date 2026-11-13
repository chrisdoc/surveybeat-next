import { describe, expect, it } from "@effect/vitest";
import { TeamId } from "@surveybeat/domain";
import { Browser, SignInWorld } from "./auth/testing.ts";

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
  const teamId = (created.body as { readonly team: { readonly id: string } }).team.id;

  const other = await admin.call("POST", "/api/teams", {
    name: "Design",
    timeZone: "UTC",
    leadEmail: "linus@example.com",
  });
  const otherTeamId = (other.body as { readonly team: { readonly id: string } }).team.id;

  const lead = await as("grace@example.com");
  const addedMember = await lead.call("POST", `/api/teams/${teamId}/members`, { email: "ada@example.com" });
  expect(addedMember.status).toBe(204);

  const member = await as("ada@example.com");
  const otherLead = await as("linus@example.com");

  // The Note is written against a Round of the Team; the fake seeds it (the Pulse-to-Round path is tested elsewhere).
  const roundId = world.addRound(acme.id, TeamId.make(teamId));

  return { world, acmeId: acme.id, admin, lead, member, otherLead, teamId, otherTeamId, roundId };
};

interface NoteBody {
  readonly roundId: string;
  readonly note: { readonly roundId: string; readonly text: string; readonly updatedAt: number } | null;
}

describe("Round Note API (R2 04, ADR 0003)", () => {
  it("lets the Lead write the Note and the Team read it", async () => {
    const { lead, member, teamId, roundId } = await setup();
    const path = `/api/teams/${teamId}/rounds/${roundId}/note`;

    const before = await lead.call("GET", path);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ roundId, note: null });

    const saved = await lead.call("PUT", path, { text: "Shipping slipped a week; we agreed to cut scope." });
    expect(saved.status).toBe(200);
    const savedBody = saved.body as NoteBody;
    expect(savedBody.roundId).toBe(roundId);
    expect(savedBody.note?.text).toBe("Shipping slipped a week; we agreed to cut scope.");
    expect(typeof savedBody.note?.updatedAt).toBe("number");

    const memberView = await member.call("GET", path);
    expect(memberView.status).toBe(200);
    expect((memberView.body as NoteBody).note?.text).toBe("Shipping slipped a week; we agreed to cut scope.");
  });

  it("refuses a member's write, an organization admin outside the Team, and another Team's Lead", async () => {
    const { admin, member, otherLead, teamId, roundId } = await setup();
    const path = `/api/teams/${teamId}/rounds/${roundId}/note`;

    expect((await member.call("PUT", path, { text: "Member note" })).status).toBe(403);
    expect((await admin.call("GET", path)).status).toBe(403);
    expect((await admin.call("PUT", path, { text: "Admin note" })).status).toBe(403);
    expect((await otherLead.call("GET", path)).status).toBe(403);
    expect((await otherLead.call("PUT", path, { text: "Other Team note" })).status).toBe(403);
  });

  it("rejects a Note over 2,000 characters", async () => {
    const { lead, teamId, roundId } = await setup();
    const path = `/api/teams/${teamId}/rounds/${roundId}/note`;

    expect((await lead.call("PUT", path, { text: "a".repeat(2000) })).status).toBe(200);
    expect((await lead.call("PUT", path, { text: "a".repeat(2001) })).status).toBe(400);
  });

  it("deletes the Note when the text is blank after trimming", async () => {
    const { lead, teamId, roundId } = await setup();
    const path = `/api/teams/${teamId}/rounds/${roundId}/note`;

    await lead.call("PUT", path, { text: "Something to keep" });
    const cleared = await lead.call("PUT", path, { text: "   " });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ roundId, note: null });

    const later = await lead.call("GET", path);
    expect(later.body).toEqual({ roundId, note: null });
  });

  it("replaces the text on a second save and moves updatedAt forward", async () => {
    const { lead, member, teamId, roundId } = await setup();
    const path = `/api/teams/${teamId}/rounds/${roundId}/note`;

    const first = (await lead.call("PUT", path, { text: "First draft" })).body as NoteBody;
    const second = await lead.call("PUT", path, { text: "  Second draft  " });
    expect(second.status).toBe(200);
    const note = (second.body as NoteBody).note!;
    expect(note.text).toBe("Second draft");
    expect(note.updatedAt).toBeGreaterThanOrEqual(first.note!.updatedAt);

    const memberView = (await member.call("GET", path)).body as NoteBody;
    expect(memberView.note?.text).toBe("Second draft");
  });

  it("answers 404 for a Round of another Team, and that Team's Lead still sees its own Round", async () => {
    const { world, acmeId, lead, otherLead, teamId, otherTeamId } = await setup();
    const otherRoundId = world.addRound(acmeId, TeamId.make(otherTeamId));
    const path = `/api/teams/${teamId}/rounds/${otherRoundId}/note`;

    expect((await lead.call("GET", path)).status).toBe(404);
    expect((await lead.call("PUT", path, { text: "Wrong Team" })).status).toBe(404);

    const ownPath = `/api/teams/${otherTeamId}/rounds/${otherRoundId}/note`;
    const own = await otherLead.call("GET", ownPath);
    expect(own.status).toBe(200);
    expect(own.body).toEqual({ roundId: otherRoundId, note: null });
  });

  it("answers 404 for a Round that does not exist in the Team", async () => {
    const { lead, teamId } = await setup();
    const path = `/api/teams/${teamId}/rounds/no-such-round/note`;

    expect((await lead.call("GET", path)).status).toBe(404);
    expect((await lead.call("PUT", path, { text: "Orphan" })).status).toBe(404);
  });
});
