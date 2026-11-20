import { Legal, legalPages } from "@surveybeat/domain";
import type { Locale } from "@surveybeat/domain";
import type { KeysWithoutParams } from "../messages/index.ts";
import { messagesFor } from "../messages/locale.ts";

export const APP_PATH = "/app";

export const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const wrap = "mx-auto w-full max-w-[1120px] px-6 sm:px-8";

export const secondaryButton =
  "site-press inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 font-semibold text-ink hover:bg-subtle";

export const brandMark = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#0E2A24"/><path d="M6 14h4l2-5 4 10 2-5h4" fill="none" stroke="#9FD6CB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const FAVICON = `data:image/svg+xml,${encodeURIComponent(brandMark(28).replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"'))}`;

export const siteFooter = (locale: Locale): string => {
  const { message } = messagesFor(locale);
  const t = (key: KeysWithoutParams): string => escape(message(key));

  const links = legalPages
    .map(
      (page) =>
        `<a href="${Legal.paths[page]}" class="site-underline inline-flex min-h-11 items-center font-medium hover:text-ink">${t(`legal.link.${page}`)}</a>`,
    )
    .join("");

  return `<footer class="border-t border-line">
  <div class="${wrap} flex flex-col gap-4 py-8 text-[15px] text-muted sm:flex-row sm:items-center sm:justify-between">
    <span class="flex items-center gap-2.5">${brandMark(22)}<span>${t("site.footer.copyright")}</span></span>
    <nav aria-label="${t("site.footer.label")}" class="flex flex-wrap gap-x-6">${links}</nav>
  </div>
</footer>`;
};
