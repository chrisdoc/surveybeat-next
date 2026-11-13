import type { Locale } from "@surveybeat/domain";
import type { KeysWithoutParams } from "../messages/index.ts";
import { messagesFor } from "../messages/locale.ts";

/** Where each locale's page is served. `en` is the default at the root. */
const pathFor = (locale: Locale): string => (locale === "en" ? "/" : `/${locale}/`);

/** The Site Worker redirects this to the stage's app, which shows sign-in when signed out. */
const APP_PATH = "/app";

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wrap = "mx-auto w-full max-w-[1120px] px-6 sm:px-8";
const primaryButton =
  "site-press inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 py-2 font-semibold text-on-primary hover:bg-primary-hover";
const secondaryButton =
  "site-press inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 font-semibold text-ink hover:bg-subtle";
const textLink =
  "site-underline inline-flex min-h-11 items-center font-semibold text-primary hover:text-primary-hover";
const sectionTitle = "font-display text-[36px] leading-[1.08] font-normal tracking-tight sm:text-[48px]";

const brandMark = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="#0E2A24"/><path d="M6 14h4l2-5 4 10 2-5h4" fill="none" stroke="#9FD6CB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const FAVICON = `data:image/svg+xml,${encodeURIComponent(brandMark(28).replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"'))}`;

/** Line icons for the privacy cards, drawn on a 24px grid in the current colour. */
const icons = {
  storage:
    '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  groupSize:
    '<circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3.5 19c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3"/><path d="M11.5 19c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3"/>',
  redaction:
    '<path d="M4 7h16"/><rect x="4" y="11" width="9" height="3.5" rx="1" fill="currentColor"/><path d="M16 12.75h4"/><path d="M4 18h10"/>',
  admins:
    '<path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2Z"/><path d="m9.2 12.2 2 2 3.8-4"/>',
} as const;

const icon = (paths: string): string =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const renderSitePage = (locale: Locale, shell: string): string => {
  const { message } = messagesFor(locale);
  const t = (key: KeysWithoutParams): string => escape(message(key));
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const other: Locale = locale === "en" ? "de" : "en";
  const otherLabel = escape(message(other === "de" ? "language.de" : "language.en"));
  const home = pathFor(locale);

  const languageLink = (className: string) =>
    `<a href="${pathFor(other)}" hreflang="${other}" lang="${other}" class="${className}">${otherLabel}</a>`;

  const header = `<header class="sticky top-0 z-20 border-b border-line bg-stone/90 backdrop-blur-md">
  <div class="${wrap} flex min-h-16 items-center gap-6">
    <a href="${home}" class="flex min-h-11 items-center gap-2.5">${brandMark(28)}<span class="text-[17px] font-bold tracking-tight">${t("app.title")}</span></a>
    <nav aria-label="${t("site.nav.label")}" class="hidden gap-7 text-[15px] md:flex">
      <a href="#loop" class="site-underline inline-flex min-h-11 items-center font-medium text-muted hover:text-ink">${t("site.nav.loop")}</a>
      <a href="#privacy" class="site-underline inline-flex min-h-11 items-center font-medium text-muted hover:text-ink">${t("site.nav.privacy")}</a>
      <a href="#results" class="site-underline inline-flex min-h-11 items-center font-medium text-muted hover:text-ink">${t("site.nav.results")}</a>
    </nav>
    <div class="ml-auto flex items-center gap-3 sm:gap-4">
      ${languageLink("site-underline hidden min-h-11 items-center text-[15px] font-medium text-muted hover:text-ink sm:inline-flex")}
      <a href="${APP_PATH}" class="${secondaryButton}">${t("site.signIn")}</a>
    </div>
  </div>
</header>`;

  const scale = [1, 2, 3, 4, 5]
    .map(
      (value) =>
        `<span class="site-scale${value === 4 ? " site-scale-chosen" : ""} flex h-11 flex-1 items-center justify-center rounded-control border text-[17px] font-semibold tabular-nums">${value}</span>`,
    )
    .join("");

  const sparkline = [3.2, 3.4, 3.1, 3.5, 3.9]
    .map((value, index, all) => {
      const height = Math.round((value - 2.5) * 22);
      const last = index === all.length - 1;
      return `<span class="w-full rounded-sm ${last ? "bg-mint" : "bg-mint/35"}" style="height:${height}px"></span>`;
    })
    .join("");

  const heroMock = `<div class="site-enter-late relative mx-auto w-full max-w-[520px] lg:mx-0 lg:ml-auto" role="img" aria-label="${t("site.mock.label")}">
  <div class="rounded-panel border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(14_42_36/0.06),0_24px_48px_-24px_rgb(14_42_36/0.28)] sm:p-7">
    <div class="flex items-center gap-2.5 text-[13px] font-semibold text-muted">${brandMark(20)}<span>${t("site.mock.from")}</span></div>
    <p class="mt-5 font-display text-[24px] leading-[1.2] text-ink sm:text-[26px]">${t("site.mock.question")}</p>
    <div class="mt-5 flex gap-2">${scale}</div>
    <div class="mt-2 flex justify-between text-[13px] text-muted"><span>${t("site.mock.low")}</span><span>${t("site.mock.high")}</span></div>
    <p class="mt-5 flex items-start gap-2 rounded-control bg-primary-soft px-3 py-2.5 text-[14px] leading-snug text-ink"><span class="mt-px shrink-0 text-primary">${icon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>').replace('width="24" height="24"', 'width="18" height="18"')}</span>${t("site.mock.anonymity")}</p>
  </div>
  <div class="relative z-10 -mt-6 ml-auto w-[86%] rounded-panel bg-evergreen p-6 text-white shadow-[0_24px_48px_-20px_rgb(8_24_20/0.55)] sm:-mt-10 sm:w-[78%]">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-[14px] font-semibold text-mint-text">${t("site.mock.result")}</p>
        <p class="mt-1 font-display text-[52px] leading-none text-mint tabular-nums">${decimal.format(3.9)}</p>
      </div>
      <div class="flex h-14 w-24 items-end gap-1.5" aria-hidden="true">${sparkline}</div>
    </div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-mint-text">
      <span>${t("site.mock.answered")}</span><span class="font-semibold text-mint">${t("site.mock.change")}</span>
    </div>
    <div class="mt-4 border-t border-white/10 pt-4">
      <p class="text-[12px] font-semibold tracking-wide text-mint-text uppercase">${t("site.mock.themeLabel")}</p>
      <p class="mt-1 text-[15px] font-medium">${t("site.mock.theme")}</p>
    </div>
  </div>
</div>`;

  const hero = `<section class="${wrap} grid min-h-[calc(100svh-4rem)] items-center gap-12 py-14 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20">
  <div class="site-enter max-w-[600px]">
    <p class="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[14px] font-semibold text-primary"><span class="site-beat h-1.5 w-1.5 rounded-full bg-primary"></span>${t("site.hero.eyebrow")}</p>
    <h1 class="mt-6 font-display text-[44px] leading-[1.02] font-normal tracking-tight text-balance sm:text-[60px] lg:text-[68px]">${t("site.hero.title")}</h1>
    <p class="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-muted sm:text-[19px]">${t("site.hero.lede")}</p>
    <div class="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
      <a href="${APP_PATH}" class="${primaryButton} min-h-12 px-6 text-[17px]">${t("site.start")}</a>
      <a href="#privacy" class="${textLink} justify-center sm:justify-start">${t("site.hero.privacyLink")}</a>
    </div>
  </div>
  ${heroMock}
</section>`;

  const steps = (["ask", "answer", "understand", "act"] as const)
    .map(
      (step, index) => `<li class="site-lift relative rounded-panel border border-line bg-stone p-6">
      <p class="font-display text-[40px] leading-none text-primary tabular-nums">${String(index + 1).padStart(2, "0")}</p>
      <h3 class="mt-5 text-[19px] leading-snug font-semibold">${t(`site.loop.${step}.title`)}</h3>
      <p class="mt-2 text-[16px] leading-relaxed text-muted">${t(`site.loop.${step}.body`)}</p>
    </li>`,
    )
    .join("");

  const loop = `<section id="loop" class="scroll-mt-16 border-y border-line bg-surface">
  <div class="${wrap} py-20 sm:py-28">
    <div class="max-w-[640px]">
      <h2 class="${sectionTitle}">${t("site.loop.title")}</h2>
      <p class="mt-4 text-[18px] leading-relaxed text-muted">${t("site.loop.lede")}</p>
    </div>
    <ol class="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${steps}</ol>
  </div>
</section>`;

  const guarantees = (["storage", "groupSize", "redaction", "admins"] as const)
    .map(
      (key) => `<li class="rounded-panel border border-white/10 bg-evergreen-raised p-6 sm:p-7">
      <span class="inline-flex h-11 w-11 items-center justify-center rounded-control bg-mint/15 text-mint">${icon(icons[key])}</span>
      <h3 class="mt-5 text-[19px] leading-snug font-semibold text-white">${t(`site.privacy.${key}.title`)}</h3>
      <p class="mt-2 text-[16px] leading-relaxed text-mint-text">${t(`site.privacy.${key}.body`)}</p>
    </li>`,
    )
    .join("");

  const privacy = `<section id="privacy" class="scroll-mt-16 bg-evergreen text-white [&_:focus-visible]:outline-mint">
  <div class="${wrap} grid gap-12 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
    <div class="lg:sticky lg:top-28 lg:self-start">
      <h2 class="${sectionTitle} text-white">${t("site.privacy.title")}</h2>
      <p class="mt-5 max-w-[30rem] text-[18px] leading-relaxed text-mint-text">${t("site.privacy.lede")}</p>
    </div>
    <ul class="grid gap-4 sm:grid-cols-2">${guarantees}</ul>
  </div>
</section>`;

  const dimensions = (
    [
      ["site.mock.result", 3.9],
      ["site.mock.results.dim.safety", 4.2],
      ["site.mock.results.dim.clarity", 3.4],
      ["site.mock.results.dim.recognition", 3.8],
    ] as const
  )
    .map(
      ([
        key,
        value,
      ]) => `<li class="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 sm:grid-cols-[9rem_1fr_auto]">
        <span class="truncate text-[15px] font-medium">${t(key)}</span>
        <span class="h-2.5 overflow-hidden rounded-full bg-line-soft"><span class="block h-full rounded-full bg-primary" style="width:${Math.round((value / 5) * 100)}%"></span></span>
        <span class="w-9 text-right text-[15px] font-semibold tabular-nums">${decimal.format(value)}</span>
      </li>`,
    )
    .join("");

  const resultsMock = `<div class="rounded-panel border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(14_42_36/0.06),0_24px_48px_-28px_rgb(14_42_36/0.25)] sm:p-8" role="img" aria-label="${t("site.mock.results.label")}">
  <div class="flex items-center justify-between gap-4 text-[14px]">
    <span class="font-semibold text-muted">${t("site.mock.results.round")}</span>
    <span class="rounded-full bg-subtle px-2.5 py-0.5 font-semibold text-muted tabular-nums">${t("site.mock.results.n")}</span>
  </div>
  <ul class="mt-6 grid gap-4">${dimensions}</ul>
  <div class="mt-7 rounded-control bg-brass-soft p-4">
    <p class="text-[12px] font-semibold tracking-wide text-brass uppercase">${t("site.mock.themeLabel")}</p>
    <p class="mt-1 text-[15px] font-medium text-ink">${t("site.mock.theme")}</p>
  </div>
  <div class="mt-3 flex items-start gap-3 rounded-control border border-line p-4">
    <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-primary" aria-hidden="true"></span>
    <div>
      <p class="text-[15px] font-semibold">${t("site.mock.results.action")}</p>
      <p class="mt-0.5 text-[14px] text-muted">${t("site.mock.results.actionMeta")}</p>
    </div>
  </div>
</div>`;

  const features = (["themes", "guide", "note", "actions"] as const)
    .map(
      (key) => `<li class="border-t border-line py-5 first:border-t-0 first:pt-0">
      <h3 class="text-[19px] leading-snug font-semibold">${t(`site.results.${key}.title`)}</h3>
      <p class="mt-1.5 text-[16px] leading-relaxed text-muted">${t(`site.results.${key}.body`)}</p>
    </li>`,
    )
    .join("");

  const results = `<section id="results" class="scroll-mt-16">
  <div class="${wrap} py-20 sm:py-28">
    <div class="max-w-[640px]">
      <h2 class="${sectionTitle}">${t("site.results.title")}</h2>
      <p class="mt-4 text-[18px] leading-relaxed text-muted">${t("site.results.lede")}</p>
    </div>
    <div class="mt-12 grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
      ${resultsMock}
      <ul>${features}</ul>
    </div>
  </div>
</section>`;

  const close = `<section class="${wrap} pb-20 sm:pb-28">
  <div class="relative overflow-hidden rounded-panel bg-primary-soft px-6 py-14 sm:px-12 sm:py-20">
    <svg class="pointer-events-none absolute top-1/2 right-12 hidden h-[180px] w-[360px] -translate-y-1/2 text-primary/25 lg:block" viewBox="0 0 260 130" fill="none" aria-hidden="true"><path d="M0 65h70l18-48 36 96 18-48h118" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="relative max-w-[560px]">
      <h2 class="${sectionTitle}">${t("site.close.title")}</h2>
      <p class="mt-4 text-[18px] leading-relaxed text-muted">${t("site.close.lede")}</p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <a href="${APP_PATH}" class="${primaryButton} min-h-12 px-6 text-[17px]">${t("site.start")}</a>
        <a href="${APP_PATH}" class="${textLink} justify-center sm:justify-start">${t("site.signIn")}</a>
      </div>
    </div>
  </div>
</section>`;

  const footer = `<footer class="border-t border-line">
  <div class="${wrap} flex flex-col gap-4 py-8 text-[15px] text-muted sm:flex-row sm:items-center sm:justify-between">
    <span class="flex items-center gap-2.5">${brandMark(22)}<span>${t("site.footer.copyright")}</span></span>
    <span class="flex items-center gap-2"><span>${t("site.footer.language")}</span>${languageLink("site-underline inline-flex min-h-11 items-center font-semibold text-ink")}</span>
  </div>
</footer>`;

  const body = `<a href="#main" class="sr-only z-50 rounded-control bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">${t("site.skip")}</a>
${header}
<main id="main">
${hero}
${loop}
${privacy}
${results}
${close}
</main>
${footer}`;

  const head = `<meta name="description" content="${t("site.description")}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${t("site.title")}" />
    <meta property="og:description" content="${t("site.description")}" />
    <meta property="og:locale" content="${locale === "en" ? "en_GB" : "de_DE"}" />
    <meta name="theme-color" content="#f3f4f1" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0b1f1b" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="${FAVICON}" type="image/svg+xml" />`;

  return shell
    .replace('<html lang="en">', `<html lang="${locale}">`)
    .replace("<title></title>", `<title>${t("site.title")}</title>`)
    .replace("<!--SITE_HEAD-->", head)
    .replace("<!--SITE_BODY-->", body);
};
