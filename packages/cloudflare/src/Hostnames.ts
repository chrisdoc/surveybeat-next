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
  if (/^pr-\d+$/.test(stage)) return `${stage}.${host}.${ZONE}`;
  return undefined;
};
