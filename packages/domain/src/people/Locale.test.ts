import { describe, expect, it } from "vitest";
import { browserLocale, matchLocale, resolveLocale } from "./Locale.ts";

describe("Locale", () => {
  it("matches a tag by its primary subtag", () => {
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("EN_us")).toBe("en");
    expect(matchLocale("fr-FR")).toBeUndefined();
  });

  it("takes the first browser language SurveyBeat has", () => {
    expect(browserLocale(["fr-FR", "de-CH", "en"])).toBe("de");
    expect(browserLocale(["fr", "it"])).toBeUndefined();
  });

  it("prefers the Person, then the browser, then the Organization", () => {
    expect(resolveLocale({ person: "en", browser: "de", organization: "de" })).toBe("en");
    expect(resolveLocale({ person: null, browser: "de", organization: "en" })).toBe("de");
    expect(resolveLocale({ person: null, browser: undefined, organization: "de" })).toBe("de");
  });
});
