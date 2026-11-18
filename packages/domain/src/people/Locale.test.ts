import { describe, expect, it } from "vitest";
import { browserLocale, localeOr, localeOrNull, matchLocale, resolveLocale } from "./Locale.ts";

describe("Locale", () => {
  it("matches a tag by its primary subtag", () => {
    expect(matchLocale("en-GB")).toBe("en");
    expect(matchLocale("EN_us")).toBe("en");
    expect(matchLocale("fr-FR")).toBeUndefined();
  });

  it("does not match German, which is not shipped (ADR 0025)", () => {
    expect(matchLocale("de-AT")).toBeUndefined();
    expect(browserLocale(["de-DE", "de"])).toBeUndefined();
  });

  it("takes the first browser language SurveyBeat has", () => {
    expect(browserLocale(["fr-FR", "de-CH", "en"])).toBe("en");
    expect(browserLocale(["fr", "it"])).toBeUndefined();
  });

  it("prefers the Person, then the browser, then the Organization", () => {
    expect(resolveLocale({ person: "en", browser: null, organization: "en" })).toBe("en");
    expect(resolveLocale({ person: null, browser: "en", organization: "en" })).toBe("en");
    expect(resolveLocale({ person: null, browser: undefined, organization: "en" })).toBe("en");
  });

  it("reads a stored value this build does not ship as unset (ADR 0025)", () => {
    expect(localeOrNull("de")).toBeNull();
    expect(localeOrNull(null)).toBeNull();
    expect(localeOrNull("en")).toBe("en");
    expect(localeOr("de", "en")).toBe("en");
    expect(localeOr("en", "en")).toBe("en");
  });
});
