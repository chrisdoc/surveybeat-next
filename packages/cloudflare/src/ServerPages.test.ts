import { describe, expect, it } from "vitest";
import {
  pageLocale,
  renderDeliveryPage,
  renderDeliverySuccessPage,
  renderUnsubscribePage,
} from "./ServerPages.ts";

describe("server pages", () => {
  it("render English with the English title and heading", () => {
    const delivery = renderDeliveryPage("tok", "en");
    expect(delivery).toContain('<html lang="en">');
    expect(delivery).toContain("<title>Change delivery time · SurveyBeat</title>");
    expect(delivery).toContain("<h1>Change delivery time</h1>");
    expect(delivery).toContain('<input type="hidden" name="lang" value="en" />');

    const saved = renderDeliverySuccessPage("Europe/Berlin", "en");
    expect(saved).toContain('<html lang="en">');
    expect(saved).toContain("<h1>Preferences updated</h1>");
    expect(saved).toContain("Your delivery time zone has been set to <strong>Europe/Berlin</strong>.");

    const unsubscribe = renderUnsubscribePage("tok", "en");
    expect(unsubscribe).toContain('<html lang="en">');
    expect(unsubscribe).toContain("<title>Turn off reminders · SurveyBeat</title>");
    expect(unsubscribe).toContain("You will no longer receive reminders for this Pulse check-in.");
    expect(unsubscribe).toContain('<input type="hidden" name="lang" value="en" />');
  });

  it("escape a token that tries to break out of the hidden field", () => {
    const token = `"><script>x</script>`;

    for (const html of [renderDeliveryPage(token, "en"), renderUnsubscribePage(token, "en")]) {
      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&quot;&gt;&lt;script&gt;x&lt;/script&gt;");
    }
  });

  it("escapes the time zone inside the success page", () => {
    const html = renderDeliverySuccessPage("<img src=x onerror=alert(1)>", "en");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>");
  });
});

describe("pageLocale", () => {
  it.each([
    ["en", undefined, "en"],
    ["EN", undefined, "en"],
    ["de", undefined, "en"],
    ["fr", undefined, "en"],
    ["fr", "de", "en"],
    [null, "de-AT,en;q=0.8", "en"],
    [null, "fr,en", "en"],
    [null, undefined, "en"],
    [undefined, undefined, "en"],
  ] as const)(
    "lang %s with Accept-Language %s is %s (German is not shipped, ADR 0025)",
    (lang, acceptLanguage, expected) => {
      expect(pageLocale(lang, acceptLanguage)).toBe(expected);
    },
  );
});
