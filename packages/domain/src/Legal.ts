export const Legal = {
  siteOrigin: "https://surveybeat.app",
  privacyEmail: "privacy@surveybeat.app",
  effectiveDate: "20 November 2026",
  responseDays: 30,
  rawAnswerRetentionMonths: 24,
  keptAnswersYears: 1,
  paths: {
    privacy: "/privacy",
    terms: "/terms",
    dpa: "/dpa",
    subprocessors: "/subprocessors",
  },
} as const;

export type LegalPage = keyof typeof Legal.paths;

export const legalPages = Object.keys(Legal.paths).filter((key): key is LegalPage =>
  Object.hasOwn(Legal.paths, key),
);

export const legalUrl = (page: LegalPage): string => `${Legal.siteOrigin}${Legal.paths[page]}`;
