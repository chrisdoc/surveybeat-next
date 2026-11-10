import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import type { DirectoryState } from "../people/Directory.ts";
import { EmailAddress } from "../email/Email.ts";
import type { SendState } from "../email/SendState.ts";
import { PersonId } from "../people/Identity.ts";
import type { Locale } from "../people/Locale.ts";
import { MembershipId, TeamId, TimeZone } from "../people/Team.ts";
import {
  applyPulseChanges,
  decidePulse,
  decideTestSend,
  defaultPulseSettings,
  EMPTY_PULSE_STATE,
  estimateSeconds,
  hasAnswers,
  type PulseCommand,
  type PulseState,
  pulseView,
  pulsesView,
  pulseWarnings,
  testSendStatusOf,
  testSendView,
} from "./Editor.ts";
import { MAX_QUESTIONS, PulseId, PulseSettings, SendTime, testInvitationLifetimeMs } from "./Pulse.ts";
import { firstVersionId, type QuestionContent, QuestionId, QuestionType } from "./Question.ts";
import { TemplateQuestionKey, weeklyTeamHealth } from "./Template.ts";

const team = TeamId.make("platform");
const otherTeam = TeamId.make("design");
const admin = PersonId.make("admin");
const lead = PersonId.make("lead");
const member = PersonId.make("member");
const pulseId = PulseId.make("pulse");

const person = (id: PersonId, organizationAdmin = false) => ({
  id,
  email: EmailAddress.make(`${id}@example.com`),
  workosUserId: null,
  organizationAdmin,
  removedAt: null,
  locale: null,
  detectedLocale: null,
});

const membership = (personId: PersonId, role: "lead" | "member", teamId = team) => ({
  id: MembershipId.make(`${teamId}-${personId}`),
  teamId,
  personId,
  role,
  startedAt: 0,
  endedAt: null,
});

const directory: DirectoryState = {
  organizationName: "Acme",
  minimumGroupSize: 4,
  aiProcessing: false,
  defaultLocale: "en",
  people: [person(admin, true), person(lead), person(member)],
  teams: [
    { id: team, name: "Platform", timeZone: TimeZone.make("Europe/Berlin") },
    { id: otherTeam, name: "Design", timeZone: TimeZone.make("UTC") },
  ],
  memberships: [
    membership(lead, "lead"),
    membership(member, "member"),
    membership(member, "lead", otherTeam),
  ],
};

/** Runs commands in order, each against the state the previous ones left, failing on a refusal. */
const run = (
  commands: ReadonlyArray<PulseCommand>,
  by = lead,
  state = EMPTY_PULSE_STATE,
  dir: DirectoryState = directory,
): PulseState =>
  commands.reduce((current, command) => {
    const decision = decidePulse(dir, current, by, command, 1);
    if (decision._tag === "Rejected") throw new Error(`${command._tag}: ${decision.rejection._tag}`);
    return applyPulseChanges(current, decision.changes);
  }, state);

const create: PulseCommand = { _tag: "CreatePulse", teamId: team, pulseId };
const created = () => run([create]);

const detail = (state: PulseState, by = lead, dir: DirectoryState = directory) => {
  const view = pulseView(dir, state, by, team, pulseId);
  if (view._tag === "Rejected") throw new Error(view.rejection._tag);
  return view.value;
};

const rejection = (state: PulseState, command: PulseCommand, by = lead) => {
  const decision = decidePulse(directory, state, by, command, 2);
  return decision._tag === "Rejected" ? decision.rejection._tag : "Accepted";
};

const key = (value: string) => TemplateQuestionKey.make(value);
const written: QuestionContent = {
  text: "How was the offsite?",
  type: { _tag: "Rating", lowLabel: "Poor", highLabel: "Great", comment: false },
  dimension: null,
};
const addWritten = (n: number): PulseCommand => ({
  _tag: "AddQuestion",
  teamId: team,
  pulseId,
  questionId: QuestionId.make(`written-${n}`),
  question: { _tag: "Written", ...written, text: `Question ${n}?` },
});
const questions = () => weeklyTeamHealth("en").questions;
const ids = (state: PulseState) => detail(state).questions.map((question) => question.questionId);

describe("creating a Pulse", () => {
  it("copies every Template Question in order, with the default settings", () => {
    const view = detail(created());
    expect(view.settings).toEqual(defaultPulseSettings("en"));
    expect(view.settings).toMatchObject({
      cadence: { _tag: "Weekly", day: "monday", time: "09:00" },
      answerWindowDays: 3,
      reminders: 1,
      anonymityMode: "anonymous",
      distribution: "invitation",
    });
    expect(view.questions.map((question) => question.templateKey)).toEqual(questions().map(({ key }) => key));
    expect(view.questions.map((question) => question.text)).toEqual(questions().map(({ text }) => text));
    expect(view.templateQuestions).toEqual([]);
    expect(view.questions.every((question) => !question.hasAnswers)).toBe(true);
  });

  it("is idempotent for the same id", () => {
    const state = run([create, create]);
    expect(state.pulses).toHaveLength(1);
    expect(state.questions).toHaveLength(questions().length);
  });

  it("is open to the Team's Leads and Organization admins only", () => {
    expect(rejection(EMPTY_PULSE_STATE, create, lead)).toBe("Accepted");
    expect(rejection(EMPTY_PULSE_STATE, create, admin)).toBe("Accepted");
    expect(rejection(EMPTY_PULSE_STATE, create, member)).toBe("Forbidden");
    // A Lead elsewhere is no Lead here.
    expect(rejection(EMPTY_PULSE_STATE, { ...create, teamId: otherTeam }, lead)).toBe("Forbidden");
    expect(rejection(EMPTY_PULSE_STATE, { ...create, teamId: otherTeam }, member)).toBe("Accepted");
    expect(rejection(EMPTY_PULSE_STATE, create, PersonId.make("stranger"))).toBe("Forbidden");
  });

  it("says Forbidden before TeamNotFound, so a refusal never reveals a Team", () => {
    const missing = { ...create, teamId: TeamId.make("missing") };
    expect(rejection(EMPTY_PULSE_STATE, missing, lead)).toBe("Forbidden");
    expect(rejection(EMPTY_PULSE_STATE, missing, admin)).toBe("TeamNotFound");
  });
});

/** The test directory with the Lead's language settings set (ADR 0018). */
const withLeadLocale = (
  locale: Locale | null,
  detectedLocale: Locale | null = null,
  defaultLocale: Locale = "en",
): DirectoryState => ({
  ...directory,
  defaultLocale,
  people: directory.people.map((each) => (each.id === lead ? { ...each, locale, detectedLocale } : each)),
});
const german = withLeadLocale("de");

describe("the language of a Pulse (ADR 0018)", () => {
  it("copies the Template in the Lead's language, with the Pulse's name", () => {
    const view = detail(run([create], lead, EMPTY_PULSE_STATE, german), lead, german);
    expect(view.settings).toEqual(defaultPulseSettings("de"));
    expect(view.settings.name).toBe("Wöchentlicher Team-Check");
    expect(view.questions.map((question) => question.text)).toEqual(
      weeklyTeamHealth("de").questions.map(({ text }) => text),
    );
    expect(view.questions.map((question) => question.templateKey)).toEqual(questions().map(({ key }) => key));
  });

  it.each([
    ["the Lead's own choice", withLeadLocale("de", "en")],
    ["the browser language seen at sign-in", withLeadLocale(null, "de", "en")],
    ["the Organization's default", withLeadLocale(null, null, "de")],
  ])("is German when the Lead's language comes from %s", (_, dir) => {
    const view = detail(run([create], lead, EMPTY_PULSE_STATE, dir), lead, dir);
    expect(view.settings.name).toBe("Wöchentlicher Team-Check");
    expect(view.questions[0]?.text).toBe(weeklyTeamHealth("de").questions[0]?.text);
  });

  it("is English when the Lead chose English, even with a German browser and Organization", () => {
    const dir = withLeadLocale("en", "de", "de");
    expect(detail(run([create], lead, EMPTY_PULSE_STATE, dir), lead, dir).settings.name).toBe(
      "Weekly team health",
    );
  });

  it("copies a Template Question added by a German Lead in German", () => {
    const start = run([create], lead, EMPTY_PULSE_STATE, german);
    const [original] = detail(start, lead, german).questions.map(({ questionId }) => questionId);
    if (original === undefined) throw new Error("no Questions");
    const state = run(
      [
        { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: original },
        {
          _tag: "AddQuestion",
          teamId: team,
          pulseId,
          questionId: QuestionId.make("again"),
          question: { _tag: "FromTemplate", key: key("workload-manageable") },
        },
      ],
      lead,
      start,
      german,
    );
    expect(detail(state, lead, german).questions.at(-1)).toMatchObject({
      templateKey: "workload-manageable",
      text: weeklyTeamHealth("de").questions[0]?.text,
    });
  });

  it("lists the Template Questions a Pulse lacks in the viewer's language", () => {
    const start = run([create]);
    const [original] = detail(start).questions.map(({ questionId }) => questionId);
    if (original === undefined) throw new Error("no Questions");
    const state = run([{ _tag: "RemoveQuestion", teamId: team, pulseId, questionId: original }], lead, start);
    expect(detail(state, lead, german).templateQuestions).toEqual([weeklyTeamHealth("de").questions[0]]);
    expect(detail(state).templateQuestions).toEqual([weeklyTeamHealth("en").questions[0]]);
  });

  it("keeps the English text of a Pulse made in English after the Lead switches to German", () => {
    const start = run([create]);
    const englishTexts = questions().map(({ text }) => text);
    const before = detail(start, lead, german);
    expect(before.settings.name).toBe("Weekly team health");
    expect(before.questions.map((question) => question.text)).toEqual(englishTexts);

    const [original] = before.questions.map(({ questionId }) => questionId);
    if (original === undefined) throw new Error("no Questions");
    const state = run(
      [
        { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: original },
        {
          _tag: "AddQuestion",
          teamId: team,
          pulseId,
          questionId: QuestionId.make("again"),
          question: { _tag: "FromTemplate", key: key("workload-manageable") },
        },
      ],
      lead,
      start,
      german,
    );
    const after = detail(state, lead, german);
    expect(after.settings.name).toBe("Weekly team health");
    expect(after.questions.slice(0, -1).map((question) => question.text)).toEqual(englishTexts.slice(1));
  });
});

describe("the Pulse editor", () => {
  it("removes and reorders Questions", () => {
    const [first, second, ...rest] = ids(created());
    if (first === undefined || second === undefined) throw new Error("no Questions");
    const state = run(
      [
        { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: first },
        { _tag: "ReorderQuestions", teamId: team, pulseId, order: [...rest, second] },
      ],
      lead,
      created(),
    );
    expect(ids(state)).toEqual([...rest, second]);
    // The removed Question stays in the library, and is offered again from the Template.
    expect(state.questions.map(({ id }) => id)).toContain(first);
    expect(detail(state).templateQuestions.map(({ key }) => key)).toEqual([questions()[0]?.key]);
  });

  it("adds a Template Question as a new library Question, and never twice", () => {
    const workload = key("workload-manageable");
    const [original] = ids(created());
    if (original === undefined) throw new Error("no Questions");
    const add: PulseCommand = {
      _tag: "AddQuestion",
      teamId: team,
      pulseId,
      questionId: QuestionId.make("again"),
      question: { _tag: "FromTemplate", key: workload },
    };
    expect(rejection(created(), add)).toBe("QuestionAlreadyInPulse");
    const state = run(
      [{ _tag: "RemoveQuestion", teamId: team, pulseId, questionId: original }, add],
      lead,
      created(),
    );
    expect(detail(state).questions.at(-1)).toMatchObject({
      questionId: "again",
      versionId: firstVersionId(QuestionId.make("again")),
      templateKey: workload,
      text: questions()[0]?.text,
    });
    expect(
      rejection(state, { ...add, question: { _tag: "FromTemplate", key: key("no-such-question") } }),
    ).toBe("QuestionNotFound");
  });

  it("detaches an edited Template Question, so the Template's original can be added again", () => {
    const [original] = ids(created());
    if (original === undefined) throw new Error("no Questions");
    const workload = key("workload-manageable");
    const state = run(
      [
        { _tag: "EditQuestion", teamId: team, pulseId, questionId: original, content: written },
        {
          _tag: "AddQuestion",
          teamId: team,
          pulseId,
          questionId: QuestionId.make("again"),
          question: { _tag: "FromTemplate", key: workload },
        },
      ],
      lead,
      created(),
    );
    expect(detail(state).questions.map(({ templateKey, text }) => [templateKey, text])).toEqual([
      [null, written.text],
      ...questions()
        .slice(1)
        .map(({ key: each, text }) => [each, text]),
      [workload, questions()[0]?.text],
    ]);
  });

  it("adds a written Question at the end as a new library Question with its first version", () => {
    const state = run([addWritten(1)], lead, created());
    const added = detail(state).questions.at(-1);
    expect(added).toMatchObject({
      questionId: "written-1",
      versionId: firstVersionId(QuestionId.make("written-1")),
      templateKey: null,
      text: "Question 1?",
      dimension: null,
    });
  });

  it("keeps at least one Question", () => {
    const all = ids(created());
    const [last, ...others] = all;
    if (last === undefined) throw new Error("no Questions");
    const state = run(
      others.map((questionId) => ({ _tag: "RemoveQuestion", teamId: team, pulseId, questionId })),
      lead,
      created(),
    );
    expect(rejection(state, { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: last })).toBe(
      "PulseNeedsAQuestion",
    );
  });

  it(`holds at most ${MAX_QUESTIONS} Questions`, () => {
    const room = MAX_QUESTIONS - questions().length;
    const state = run(
      Array.from({ length: room }, (_, n) => addWritten(n)),
      lead,
      created(),
    );
    expect(ids(state)).toHaveLength(MAX_QUESTIONS);
    expect(rejection(state, addWritten(99))).toBe("PulseFull");
  });

  it("refuses a reorder that does not list each Question exactly once", () => {
    const all = ids(created());
    const [first, ...rest] = all;
    if (first === undefined) throw new Error("no Questions");
    const reorder = (order: ReadonlyArray<QuestionId>): PulseCommand => ({
      _tag: "ReorderQuestions",
      teamId: team,
      pulseId,
      order,
    });
    expect(rejection(created(), reorder(rest))).toBe("OrderMismatch");
    expect(rejection(created(), reorder([...rest, rest[0] ?? first]))).toBe("OrderMismatch");
    expect(rejection(created(), reorder([...rest, QuestionId.make("elsewhere")]))).toBe("OrderMismatch");
    expect(rejection(created(), reorder([...all].reverse()))).toBe("Accepted");
  });

  it("updates the settings", () => {
    const settings = Schema.decodeSync(PulseSettings)({
      name: "Friday check-in",
      cadence: { _tag: "Weekly", day: "friday", time: "15:30" },
      answerWindowDays: 1,
      reviewWindowDays: 3,
      reminders: 0,
      anonymityMode: "anonymous",
      distribution: "invitation",
    });
    const state = run([{ _tag: "UpdatePulseSettings", teamId: team, pulseId, settings }], admin, created());
    expect(detail(state).settings).toEqual(settings);
  });

  it("finds a Pulse only through its own Team", () => {
    const state = run([{ _tag: "CreatePulse", teamId: otherTeam, pulseId: PulseId.make("theirs") }], member);
    const theirs = { _tag: "RemoveQuestion", teamId: team, pulseId: PulseId.make("theirs") } as const;
    expect(rejection(state, { ...theirs, questionId: QuestionId.make("x") }, admin)).toBe("PulseNotFound");
    expect(pulseView(directory, state, admin, team, PulseId.make("theirs"))).toMatchObject({
      rejection: { _tag: "PulseNotFound" },
    });
  });

  it("lists a Team's Pulses to its Leads and admins, not to members", () => {
    const state = created();
    expect(pulsesView(directory, state, lead, team)).toMatchObject({
      _tag: "Viewed",
      value: {
        team: { id: team, yourRole: "lead" },
        pulses: [{ id: pulseId, name: "Weekly team health", questionCount: questions().length }],
      },
    });
    expect(pulsesView(directory, state, admin, team)).toMatchObject({ _tag: "Viewed" });
    expect(pulsesView(directory, state, member, team)).toMatchObject({ rejection: { _tag: "Forbidden" } });
    expect(pulseView(directory, state, member, team, pulseId)).toMatchObject({
      rejection: { _tag: "Forbidden" },
    });
  });
});

describe("Question versions", () => {
  const editCommand = (questionId: QuestionId, content: QuestionContent = written): PulseCommand => ({
    _tag: "EditQuestion",
    teamId: team,
    pulseId,
    questionId,
    content,
  });

  it("keep exactly one version per Question through every command", () => {
    const [first, second] = ids(created());
    if (first === undefined || second === undefined) throw new Error("no Questions");
    const state = run(
      [
        addWritten(1),
        editCommand(first),
        editCommand(QuestionId.make("written-1"), { ...written, type: { _tag: "LongText" } }),
        { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: second },
        {
          _tag: "AddQuestion",
          teamId: team,
          pulseId,
          questionId: QuestionId.make("unused"),
          question: { _tag: "FromTemplate", key: key("safe-to-speak-up") },
        },
      ],
      lead,
      created(),
    );
    for (const question of state.questions) {
      const versions = state.versions.filter((version) => version.questionId === question.id);
      expect(versions.map(({ id, number }) => ({ id, number }))).toEqual([
        { id: firstVersionId(question.id), number: 1 },
      ]);
    }
    // A Pulse points at versions, each of a Question it asks once.
    const pulse = state.pulses[0];
    expect(pulse?.questions.every((versionId) => state.versions.some(({ id }) => id === versionId))).toBe(
      true,
    );
    expect(new Set(pulse?.questions).size).toBe(pulse?.questions.length);
  });

  it("rewrite a Question without Answers in place", () => {
    const [first] = ids(created());
    if (first === undefined) throw new Error("no Questions");
    const state = run([editCommand(first)], lead, created());
    expect(detail(state).questions[0]).toMatchObject({
      questionId: first,
      versionId: firstVersionId(first),
      text: written.text,
    });
  });

  it("refuse to edit a Question that has Answers, but still let it be removed", () => {
    const [first] = ids(created());
    if (first === undefined) throw new Error("no Questions");
    const answered: PulseState = { ...created(), answered: [firstVersionId(first)] };
    expect(hasAnswers(answered, first)).toBe(true);
    expect(detail(answered).questions[0]?.hasAnswers).toBe(true);
    expect(rejection(answered, editCommand(first))).toBe("QuestionHasAnswers");
    expect(rejection(answered, { _tag: "RemoveQuestion", teamId: team, pulseId, questionId: first })).toBe(
      "Accepted",
    );
  });

  it("have no Answers anywhere until Answers are stored", () => {
    const state = created();
    expect(state.questions.some(({ id }) => hasAnswers(state, id))).toBe(false);
  });

  it("refuse to edit a Question the Pulse does not ask", () => {
    expect(rejection(created(), editCommand(QuestionId.make("elsewhere")))).toBe("QuestionNotFound");
  });
});

describe("the estimate and the warnings", () => {
  const rating: QuestionContent = written;
  const choice: QuestionContent = {
    ...written,
    type: { _tag: "SingleChoice", options: ["Yes", "No"] },
  };
  const longText: QuestionContent = { ...written, type: { _tag: "LongText" } };

  it("sums seconds by type: 6 for a rating, 10 for a single choice, 30 for long text", () => {
    expect(estimateSeconds([rating, choice, longText])).toBe(46);
    expect(
      estimateSeconds([
        { ...rating, type: { _tag: "Rating", lowLabel: "Poor", highLabel: "Great", comment: true } },
      ]),
    ).toBe(6);
    expect(estimateSeconds([])).toBe(0);
  });

  it("warns above 7 Questions, not at 7", () => {
    expect(pulseWarnings(Array(7).fill(rating), 5, 4)).toEqual([]);
    expect(pulseWarnings(Array(8).fill(rating), 5, 4)).toEqual([
      { _tag: "TooManyQuestions", count: 8, recommended: 7 },
    ]);
  });

  it("warns above 90 seconds, not at 90", () => {
    expect(pulseWarnings([rating, longText, longText, ...Array(4).fill(choice)], 5, 4)).toEqual([
      { _tag: "TooLong", seconds: 106, recommended: 90 },
    ]);
    expect(pulseWarnings([...Array(5).fill(rating), longText, longText], 5, 4)).toEqual([]);
  });

  it("notes that one-tap needs a rating Question first", () => {
    expect(pulseWarnings([choice, rating], 5, 4)).toEqual([{ _tag: "NoOneTap" }]);
    expect(pulseWarnings([rating, choice], 5, 4)).toEqual([]);
  });

  it("warns, without refusing, when the Team has fewer members than N", () => {
    expect(pulseWarnings([rating], 3, 4)).toEqual([
      { _tag: "TeamBelowMinimumGroupSize", members: 3, minimumGroupSize: 4 },
    ]);
    // The test directory's Team has a Lead and a member, below N = 4; the Pulse is still created.
    expect(detail(created()).warnings).toEqual([
      { _tag: "TeamBelowMinimumGroupSize", members: 2, minimumGroupSize: 4 },
    ]);
  });

  it("are part of the editor's view after each change", () => {
    const state = run([addWritten(1), addWritten(2)], lead, created());
    expect(detail(state).warnings.map(({ _tag }) => _tag)).toEqual([
      "TooManyQuestions",
      "TeamBelowMinimumGroupSize",
    ]);
    expect(detail(state).estimatedSeconds).toBe(estimateSeconds(detail(state).questions));
  });
});

describe("the settings schema", () => {
  const decode = Schema.decodeUnknownOption(PulseSettings);
  const valid = {
    name: "Weekly",
    cadence: { _tag: "Weekly", day: "monday", time: "09:00" },
    answerWindowDays: 3,
    reviewWindowDays: 3,
    reminders: 1,
    anonymityMode: "anonymous",
    distribution: "invitation",
  };

  it.each([
    ["the earliest send time", { cadence: { _tag: "Weekly", day: "monday", time: "06:00" } }],
    ["the latest send time", { cadence: { _tag: "Weekly", day: "sunday", time: "21:00" } }],
    ["a one-day window and no reminders", { answerWindowDays: 1, reminders: 0 }],
    ["a six-day window and two reminders", { answerWindowDays: 6, reminders: 2 }],
    ["no Review window", { reviewWindowDays: 0 }],
    ["a seven-day Review window", { reviewWindowDays: 7 }],
  ])("accepts %s", (_, patch) => {
    expect(decode({ ...valid, ...patch })._tag).toBe("Some");
  });

  it.each([
    ["a send time before 06:00", { cadence: { _tag: "Weekly", day: "monday", time: "05:59" } }],
    ["a send time after 21:00", { cadence: { _tag: "Weekly", day: "monday", time: "21:01" } }],
    ["a malformed time", { cadence: { _tag: "Weekly", day: "monday", time: "9:00" } }],
    ["an unknown day", { cadence: { _tag: "Weekly", day: "someday", time: "09:00" } }],
    ["another cadence", { cadence: { _tag: "Monthly", day: "monday", time: "09:00" } }],
    ["no answer window", { answerWindowDays: 0 }],
    ["a seven-day window", { answerWindowDays: 7 }],
    ["an eight-day Review window", { reviewWindowDays: 8 }],
    ["a negative Review window", { reviewWindowDays: -1 }],
    ["three reminders", { reminders: 3 }],
    ["attributed mode", { anonymityMode: "attributed" }],
    ["a shared link", { distribution: "link" }],
    ["an empty name", { name: "" }],
  ])("refuses %s", (_, patch) => {
    expect(decode({ ...valid, ...patch })._tag).toBe("None");
  });

  it("accepts any HH:MM in range as a SendTime", () => {
    expect(SendTime.make("13:45")).toBe("13:45");
  });
});

describe("the Question type schema", () => {
  const decode = Schema.decodeUnknownOption(QuestionType);
  it.each([
    ["a rating with labelled ends", { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true }],
    ["a single choice", { _tag: "SingleChoice", options: ["A", "B"] }],
    ["long text", { _tag: "LongText" }],
  ])("accepts %s", (_, type) => {
    expect(decode(type)._tag).toBe("Some");
  });
  it.each([
    ["a rating without labels", { _tag: "Rating", lowLabel: "", highLabel: "High", comment: false }],
    ["a single choice with one option", { _tag: "SingleChoice", options: ["A"] }],
    ["a single choice with a repeated option", { _tag: "SingleChoice", options: ["A", "A"] }],
    ["a type not in Release 1", { _tag: "Enps" }],
  ])("refuses %s", (_, type) => {
    expect(decode(type)._tag).toBe("None");
  });
});

describe("a test of a Pulse (ADR 0021)", () => {
  const outcome = (state: PulseState, by: PersonId, teamId = team) => {
    const decision = decideTestSend(directory, state, by, teamId, pulseId);
    return decision._tag === "Allowed" ? decision.person.email : decision.rejection._tag;
  };
  const withPulse = created();

  it("is open to Organization admins and the Team's Leads, to their own address", () => {
    expect(outcome(withPulse, admin)).toBe("admin@example.com");
    expect(outcome(withPulse, lead)).toBe("lead@example.com");
  });

  it("is refused to a plain member of the Team", () => {
    expect(outcome(withPulse, member)).toBe("Forbidden");
  });

  it("is refused to a Lead of another Team", () => {
    const otherLead = PersonId.make("other-lead");
    const dir: DirectoryState = {
      ...directory,
      people: [...directory.people, { ...person(otherLead), email: EmailAddress.make("other@example.com") }],
      memberships: [...directory.memberships, membership(otherLead, "lead", otherTeam)],
    };
    const decision = decideTestSend(dir, withPulse, otherLead, team, pulseId);
    expect(decision).toMatchObject({ _tag: "Rejected", rejection: { _tag: "Forbidden" } });
  });

  it("finds the Pulse only through its own Team", () => {
    expect(outcome(withPulse, admin, otherTeam)).toBe("PulseNotFound");
    expect(outcome(EMPTY_PULSE_STATE, admin)).toBe("PulseNotFound");
  });

  it("refuses a Pulse with no Questions", () => {
    const empty: PulseState = {
      ...withPulse,
      pulses: withPulse.pulses.map((pulse) => ({ ...pulse, questions: [] })),
    };
    expect(outcome(empty, admin)).toBe("PulseNeedsAQuestion");
  });
});

describe("the state of a test send (ADR 0021, issue 147)", () => {
  it("shows a queued send with its attempts and last code", () => {
    expect(testSendStatusOf({ _tag: "Pending", attempts: 0, lastCode: null }, 100, 150)).toEqual({
      queuedAt: 100,
      checkedAt: 150,
      state: { _tag: "Queued", attempts: 0, lastCode: null },
    });
    expect(
      testSendStatusOf({ _tag: "Pending", attempts: 2, lastCode: "E_RATE_LIMIT" }, 100, 150).state,
    ).toEqual({ _tag: "Queued", attempts: 2, lastCode: "E_RATE_LIMIT" });
  });

  it("shows a send being delivered by its attempt number, without the lease", () => {
    const sending: SendState = { _tag: "Sending", attempt: 3, leaseExpiresAt: 9_999 };
    expect(testSendStatusOf(sending, 100, 150)).toEqual({
      queuedAt: 100,
      checkedAt: 150,
      state: { _tag: "Sending", attempt: 3 },
    });
  });

  it("shows a sent send by when it was sent, without its message id", () => {
    const sent: SendState = { _tag: "Sent", messageId: "provider-message-1", sentAt: 120 };
    expect(testSendStatusOf(sent, 100, 150)).toEqual({
      queuedAt: 100,
      checkedAt: 150,
      state: { _tag: "Sent", sentAt: 120 },
    });
  });

  it("shows a failed send with its reason, code, and time", () => {
    const failed: SendState = {
      _tag: "Failed",
      reason: "rejected",
      code: "E_SENDER_NOT_VERIFIED",
      failedAt: 130,
    };
    expect(testSendStatusOf(failed, 100, 150)).toEqual({
      queuedAt: 100,
      checkedAt: 150,
      state: { _tag: "Failed", reason: "rejected", code: "E_SENDER_NOT_VERIFIED", failedAt: 130 },
    });
  });
});

describe("reading a test send (ADR 0021, issue 147)", () => {
  const now = 1_000_000_000;
  const sentAt = now - 1_000;
  const own = (by: PersonId, state: SendState = { _tag: "Pending", attempts: 0, lastCode: null }) => ({
    personId: by,
    pulseId,
    sentAt,
    state,
  });
  const read = (
    found: Parameters<typeof testSendView>[4],
    by: PersonId = lead,
    teamId = team,
    pulse = pulseId,
    at = now,
  ) => {
    const view = testSendView(directory, by, teamId, pulse, found, at);
    return view._tag === "Viewed" ? view.value : view.rejection._tag;
  };

  it("shows the sender their own send", () => {
    expect(read(own(lead))).toEqual({
      queuedAt: sentAt,
      checkedAt: now,
      state: { _tag: "Queued", attempts: 0, lastCode: null },
    });
  });

  it("hides another Person's send, a send of another Pulse, an unknown send, and an expired one", () => {
    expect(read(own(admin))).toEqual("TestSendNotFound");
    expect(read({ ...own(lead), pulseId: PulseId.make("other") })).toEqual("TestSendNotFound");
    expect(read(null)).toEqual("TestSendNotFound");
    expect(read(own(lead), lead, team, pulseId, sentAt + testInvitationLifetimeMs)).toEqual(
      "TestSendNotFound",
    );
    expect(read(own(lead), lead, team, pulseId, sentAt + testInvitationLifetimeMs - 1)).toMatchObject({
      state: { _tag: "Queued" },
    });
  });

  it("is refused a plain member, and a Lead of another Team, before anything is looked at", () => {
    expect(read(own(member), member)).toEqual("Forbidden");
    expect(read(own(lead), lead, otherTeam)).toEqual("Forbidden");
  });

  it("reports the send's state as it stands", () => {
    expect(read(own(lead, { _tag: "Failed", reason: "unknown", code: null, failedAt: now }))).toMatchObject({
      state: { _tag: "Failed", reason: "unknown", code: null, failedAt: now },
    });
  });
});
