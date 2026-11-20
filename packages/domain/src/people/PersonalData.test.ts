import { describe, expect, it } from "@effect/vitest";
import { personalDataTransparency } from "./PersonalData.ts";

const text = JSON.stringify(personalDataTransparency);

describe("personal data transparency", () => {
  it("states the session, removal, email, browser and AI limits that the code actually implements", () => {
    expect(text).toContain("Signing out deletes that session");
    expect(text).toContain("Nothing deletes expired sessions on a schedule yet");
    expect(text).toContain("erasing it is not available yet");
    expect(text).toContain("deletes their Participation records and test sends");
    expect(text).toContain("Erasing the remaining records is not available yet");
    expect(text).toContain("The sign-in route to that Organization stays");
    expect(text).toContain("An older stored Invitation or reminder email can still hold the raw token");
    expect(text).toContain("leaves out the payload, the message body, and any token");
    expect(text).toContain("zdr: true");
    expect(text).toContain(
      "OpenRouter may still retain content it flags as child sexual abuse material, including traffic sent with a zero data retention request (zdr: true).",
    );
    expect(text.match(/child sexual abuse material/g)?.length).toBe(1);
    expect(text).not.toContain("The provider can still retain");
    expect(text).toContain("sb_answers_");
    expect(text).toContain("sb_edit_");
    expect(text).toContain("/history does not show them or clear them");
    expect(text).toContain("SHA-256 hash of an Edit key");
    expect(text).toContain("privacy@surveybeat.app");
    expect(text).not.toContain("zero-retention endpoint");
    expect(text).not.toContain("never the link");
    expect(text).not.toContain("until it is deleted after that");
    expect(text).not.toContain("never on SurveyBeat's servers. View or clear them on /history");
  });
});
