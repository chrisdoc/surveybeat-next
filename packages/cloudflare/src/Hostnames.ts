import type { WorkerDomainConfig } from "@alchemy.run/cloudflare";

export const ZONE = "surveybeat.app";
/** The `surveybeat.app` zone. Not a secret: it appears in every zone API URL. */
export const ZONE_ID = "228eec30edf283bf8eb7a628283720f1";

/**
 * The custom hostname a Worker is served on in a stage, or undefined for workers.dev.
 *
 * `production` serves `<host>.surveybeat.app`, a PR stage `pr-<n>.<host>.surveybeat.app`.
 * Every other stage (personal dev, tests) stays on workers.dev, so it adds no DNS record.
 */
export const hostnameFor = (stage: string, host: "app" | "submit"): string | undefined => {
  if (stage === "production") return `${host}.${ZONE}`;
  if (stage === "staging") return `staging.${host}.${ZONE}`;
  if (/^pr-\d+$/.test(stage)) return `${stage}.${host}.${ZONE}`;
  return undefined;
};

/**
 * Whether the Site Worker serves the apex `surveybeat.app` (and redirects `www` to it) in production.
 * Still false: the apex and `www` point at the old app on Vercel, and production deploys on every merge
 * to main, so claiming them now would collide with those records. Flip it only after the cutover in
 * docs/infra.md.
 */
export const APEX_SERVED_BY_SITE = false;

/**
 * The custom hostname the Site Worker (the landing page) is served on in a stage, or undefined for
 * workers.dev. `production` gets the apex only once {@link APEX_SERVED_BY_SITE} is on.
 */
export const siteDomainFor = (
  stage: string,
  apexServedBySite: boolean = APEX_SERVED_BY_SITE,
): string | WorkerDomainConfig | undefined => {
  if (stage === "production") {
    return apexServedBySite ? { name: ZONE, redirects: [`www.${ZONE}`] } : undefined;
  }
  if (stage === "staging") return `staging.${ZONE}`;
  if (/^pr-\d+$/.test(stage)) return `${stage}.${ZONE}`;
  return undefined;
};
