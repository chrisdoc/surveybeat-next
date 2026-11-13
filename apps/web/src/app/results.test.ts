import { assert, describe, it } from "@effect/vitest";
import type { DiscussionGuide } from "@surveybeat/domain";
import { discussionGuideText } from "./results.ts";

const full: DiscussionGuide = {
  whatStoodOut: ["Workload moved more than usual."],
  whatPeopleRaised: ["Priorities came up in several comments.", "Handovers are slow."],
  actionsToCheckOn: ["Review the planning rhythm."],
  questions: ["What would make busy weeks easier?", "What should we stop doing?"],
};

describe("discussionGuideText", () => {
  it("writes the title, then each section with a heading and bulleted or numbered items", () => {
    assert.strictEqual(
      discussionGuideText(full),
      [
        "Discussion guide",
        "What stood out\n- Workload moved more than usual.",
        "What people raised\n- Priorities came up in several comments.\n- Handovers are slow.",
        "Actions to check on\n- Review the planning rhythm.",
        "Questions to ask the Team\n1. What would make busy weeks easier?\n2. What should we stop doing?",
      ].join("\n\n"),
    );
  });

  it("skips sections whose lists are empty", () => {
    const sparse: DiscussionGuide = {
      whatStoodOut: [],
      whatPeopleRaised: [],
      actionsToCheckOn: ["Review the planning rhythm."],
      questions: [],
    };
    assert.strictEqual(
      discussionGuideText(sparse),
      ["Discussion guide", "Actions to check on\n- Review the planning rhythm."].join("\n\n"),
    );
  });

  it("numbers questions from 1 even when earlier sections are empty", () => {
    const onlyQuestions: DiscussionGuide = {
      whatStoodOut: [],
      whatPeopleRaised: [],
      actionsToCheckOn: [],
      questions: ["First?", "Second?", "Third?"],
    };
    assert.strictEqual(
      discussionGuideText(onlyQuestions),
      ["Discussion guide", "Questions to ask the Team\n1. First?\n2. Second?\n3. Third?"].join("\n\n"),
    );
  });
});
