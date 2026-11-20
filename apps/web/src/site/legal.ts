import { Legal, Policy } from "@surveybeat/domain";
import type { Locale, LegalPage } from "@surveybeat/domain";
import { catalog } from "../messages/catalog.ts";
import { fill } from "../messages/index.ts";
import type { MessageKey } from "../messages/index.ts";
import { messagesFor } from "../messages/locale.ts";
import { APP_PATH, brandMark, escape, FAVICON, secondaryButton, siteFooter, wrap } from "./chrome.ts";

type LegalBlock =
  | { readonly kind: "p"; readonly text: string }
  | { readonly kind: "ul"; readonly items: readonly string[] }
  | {
      readonly kind: "table";
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

interface LegalSection {
  readonly title: string;
  readonly blocks: readonly LegalBlock[];
}

const legalParams = {
  email: Legal.privacyEmail,
  effective: Legal.effectiveDate,
  responseDays: Legal.responseDays,
  rawMonths: Legal.rawAnswerRetentionMonths,
  keptYears: Legal.keptAnswersYears,
  sessionDays: Policy.signIn.sessionDays,
  codeMinutes: Policy.signIn.codeMinutes,
  magicLinkMinutes: Policy.signIn.magicLinkMinutes,
  restoreDays: Policy.backupRetentionDays,
  groupSize: Policy.groupSize.defaultValue,
  minimum: Policy.groupSize.minimum,
} as const;

const legalText = (key: MessageKey): string => fill(catalog[key], legalParams);

const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(catalog, key);

const keyPattern = /^legal\.(?<page>[a-z]+)\.(?<section>s\d+)\.(?<kind>[a-z]+\d*)(?:\.(?<column>[a-z]+))?$/;

const messageKeys = Object.keys(catalog).filter(isMessageKey);

interface SectionDraft {
  title: string;
  blocks: LegalBlock[];
  head: string[];
  rows: Map<string, string[]>;
}

const emptyDraft = (): SectionDraft => ({ title: "", blocks: [], head: [], rows: new Map() });

const finishSection = (draft: SectionDraft): LegalSection => ({
  title: draft.title,
  blocks:
    draft.rows.size === 0
      ? draft.blocks
      : [...draft.blocks, { kind: "table", head: draft.head, rows: [...draft.rows.values()] }],
});

export const legalSections = (page: LegalPage): readonly LegalSection[] => {
  const drafts = new Map<string, SectionDraft>();

  for (const key of messageKeys) {
    const { page: keyPage, section: sectionId = "", kind = "" } = keyPattern.exec(key)?.groups ?? {};

    if (keyPage !== page) {
      continue;
    }

    const text = legalText(key);
    const draft = drafts.get(sectionId) ?? emptyDraft();
    drafts.set(sectionId, draft);

    if (kind === "title") {
      draft.title = text;
    } else if (kind.startsWith("p")) {
      draft.blocks.push({ kind: "p", text });
    } else if (kind.startsWith("li")) {
      const last = draft.blocks.at(-1);

      if (last?.kind === "ul") {
        draft.blocks[draft.blocks.length - 1] = { kind: "ul", items: [...last.items, text] };
      } else {
        draft.blocks.push({ kind: "ul", items: [text] });
      }
    } else if (kind === "th") {
      draft.head.push(text);
    } else {
      draft.rows.set(kind, [...(draft.rows.get(kind) ?? []), text]);
    }
  }

  return [...drafts.values()].map(finishSection);
};

const linkEmail = (html: string): string =>
  html.replaceAll(
    escape(Legal.privacyEmail),
    `<a href="mailto:${Legal.privacyEmail}" class="font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">${escape(Legal.privacyEmail)}</a>`,
  );

const prose = (text: string): string => linkEmail(escape(text));

const renderBlock = (block: LegalBlock): string => {
  switch (block.kind) {
    case "p": {
      return `<p class="mt-3 text-[16px] leading-relaxed text-muted">${prose(block.text)}</p>`;
    }

    case "ul": {
      return `<ul class="mt-3 list-disc space-y-1.5 pl-6 text-[16px] leading-relaxed text-muted">${block.items.map((item) => `<li>${prose(item)}</li>`).join("")}</ul>`;
    }

    case "table": {
      const head = block.head
        .map(
          (cell) =>
            `<th scope="col" class="px-4 py-3 text-[14px] font-semibold text-ink">${prose(cell)}</th>`,
        )
        .join("");

      const rows = block.rows
        .map(
          (row) =>
            `<tr class="border-t border-line align-top">${row
              .map(
                (cell, index) =>
                  `<td class="px-4 py-3 ${index === 0 ? "font-medium text-ink" : "text-muted"}">${prose(cell)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");

      return `<div class="mt-4 overflow-x-auto rounded-panel border border-line bg-surface"><table class="w-full min-w-[640px] border-collapse text-left text-[15px] leading-relaxed"><thead class="bg-subtle"><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
  }
};

const renderSection = (section: LegalSection): string =>
  `<section class="legal-section mt-10">
  <h2 class="font-display text-[26px] leading-tight font-normal tracking-tight">${escape(section.title)}</h2>
  ${section.blocks.map(renderBlock).join("\n  ")}
</section>`;

export const renderLegalPage = (locale: Locale, shell: string, page: LegalPage): string => {
  const { message } = messagesFor(locale);
  const t = (key: "app.title" | "site.signIn" | "site.skip" | "legal.home"): string => escape(message(key));
  const title = legalText(`legal.${page}.title`);
  const description = escape(legalText(`legal.${page}.description`));
  const pageTitle = escape(message("legal.pageTitle", { page: title }));

  const header = `<header class="border-b border-line bg-stone/90">
  <div class="${wrap} flex min-h-16 items-center gap-6">
    <a href="/" class="flex min-h-11 items-center gap-2.5" aria-label="${t("legal.home")}">${brandMark(28)}<span class="text-[17px] font-bold tracking-tight">${t("app.title")}</span></a>
    <div class="ml-auto"><a href="${APP_PATH}" class="${secondaryButton}">${t("site.signIn")}</a></div>
  </div>
</header>`;

  const body = `<a href="#main" class="sr-only z-50 rounded-control bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">${t("site.skip")}</a>
${header}
<main id="main" class="${wrap} max-w-[760px] py-12 sm:py-16">
  <h1 class="font-display text-[40px] leading-[1.05] font-normal tracking-tight sm:text-[52px]">${escape(title)}</h1>
  <p class="mt-4 text-[18px] leading-relaxed text-muted">${prose(legalText(`legal.${page}.lede`))}</p>
  <div class="legal-sections">
${legalSections(page).map(renderSection).join("\n")}
  </div>
  <p class="mt-12 border-t border-line pt-6 text-[16px] text-muted">${prose(message("legal.contact", { email: Legal.privacyEmail }))}</p>
</main>
${siteFooter(locale)}`;

  const head = `<meta name="description" content="${description}" />
    <link rel="canonical" href="${Legal.siteOrigin}${Legal.paths[page]}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${description}" />
    <meta name="theme-color" content="#f3f4f1" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0b1f1b" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="${FAVICON}" type="image/svg+xml" />`;

  return shell
    .replace('<html lang="en">', `<html lang="${locale}">`)
    .replace("<title></title>", `<title>${pageTitle}</title>`)
    .replace("<!--SITE_HEAD-->", head)
    .replace("<!--SITE_BODY-->", body);
};
