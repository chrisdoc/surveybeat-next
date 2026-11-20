import { describe, expect, it } from "@effect/vitest";
import { Legal, legalPages, legalUrl } from "./Legal.ts";

describe("Legal", () => {
  it("lists every legal page with an absolute URL on the site origin", () => {
    expect(legalPages).toEqual(["privacy", "terms", "dpa", "subprocessors"]);
    expect(legalUrl("privacy")).toBe("https://surveybeat.app/privacy");
    expect(legalUrl("dpa")).toBe("https://surveybeat.app/dpa");

    for (const page of legalPages) {
      expect(legalUrl(page).startsWith(Legal.siteOrigin)).toBe(true);
    }
  });
});
