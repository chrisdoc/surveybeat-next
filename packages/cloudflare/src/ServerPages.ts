import { browserLocale, DEFAULT_LOCALE, type Locale, matchLocale } from "@surveybeat/domain";
import { type Messages, messagesFor } from "@surveybeat/emails";

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#39;"],
]);

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ESCAPES.get(char) ?? char);

export const pageLocale = (lang: string | null | undefined, acceptLanguage: string | undefined): Locale => {
  const explicit = lang === null || lang === undefined ? undefined : matchLocale(lang);
  if (explicit !== undefined) return explicit;
  const languages = (acceptLanguage ?? "").split(",").map((part) => part.split(";")[0] ?? "");
  return browserLocale(languages) ?? DEFAULT_LOCALE;
};

const TIME_ZONES = [
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "UTC",
] as const;

const DELIVERY_SCRIPT = `<script>
      try {
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (userTz) {
          const sel = document.getElementById("timeZone");
          let found = false;
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === userTz) { sel.selectedIndex = i; found = true; break; }
          }
          if (!found) {
            const opt = document.createElement("option");
            opt.value = userTz;
            opt.text = userTz;
            opt.selected = true;
            sel.prepend(opt);
          }
        }
      } catch (e) {}
    </script>`;

export const renderDeliveryPage = (token: string, locale: Locale): string => {
  const m: Messages = messagesFor(locale);
  const options = TIME_ZONES.map((zone) => `<option value="${zone}">${zone}</option>`).join("\n        ");
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(m.message("page.delivery.title"))}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
    select, button { width: 100%; padding: 0.625rem; border-radius: 0.375rem; font-size: 0.875rem; box-sizing: border-box; }
    select { background: #0f172a; border: 1px solid #334155; color: #f8fafc; margin-bottom: 1.25rem; }
    button { background: #3b82f6; color: white; border: none; font-weight: 500; cursor: pointer; }
    button:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(m.message("page.delivery.heading"))}</h1>
    <p>${escapeHtml(m.message("page.delivery.intro"))}</p>
    <form method="POST" action="/delivery">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <input type="hidden" name="lang" value="${locale}" />
      <label for="timeZone">${escapeHtml(m.message("page.delivery.timeZone"))}</label>
      <select name="timeZone" id="timeZone" required>
        ${options}
      </select>
      <button type="submit">${escapeHtml(m.message("page.delivery.save"))}</button>
    </form>
    ${DELIVERY_SCRIPT}
  </div>
</body>
</html>`;
};

export const renderDeliverySuccessPage = (timeZone: string, locale: Locale): string => {
  const m: Messages = messagesFor(locale);
  const placeholder = "{timeZone}";
  const [before = "", after = ""] = m
    .message("page.deliverySaved.body", { timeZone: placeholder })
    .split(placeholder);
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(m.message("page.deliverySaved.title"))}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; color: #34d399; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(m.message("page.deliverySaved.heading"))}</h1>
    <p>${escapeHtml(before)}<strong>${escapeHtml(timeZone)}</strong>${escapeHtml(after)}</p>
  </div>
</body>
</html>`;
};

export const renderUnsubscribePage = (token: string, locale: Locale): string => {
  const m: Messages = messagesFor(locale);
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(m.message("page.unsubscribe.title"))}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 420px; width: 100%; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { font-size: 1.25rem; font-weight: 600; margin-top: 0; }
    p { color: #94a3b8; font-size: 0.875rem; line-height: 1.5; }
    button { width: 100%; padding: 0.625rem; border-radius: 0.375rem; font-size: 0.875rem; box-sizing: border-box; background: #ef4444; color: white; border: none; font-weight: 500; cursor: pointer; }
    button:hover { background: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(m.message("page.unsubscribe.heading"))}</h1>
    <p>${escapeHtml(m.message("page.unsubscribe.body"))}</p>
    <form method="POST" action="/api/reminders/unsubscribe">
      <input type="hidden" name="t" value="${escapeHtml(token)}" />
      <input type="hidden" name="lang" value="${locale}" />
      <button type="submit">${escapeHtml(m.message("page.unsubscribe.button"))}</button>
    </form>
  </div>
</body>
</html>`;
};
