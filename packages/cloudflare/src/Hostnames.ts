import type { WorkerDomainConfig } from "@alchemy.run/cloudflare";

export const ZONE = "surveybeat.app";
export const ZONE_ID = "228eec30edf283bf8eb7a628283720f1";

export const hostnameFor = (stage: string, host: "app" | "submit"): string | undefined => {
  const prefix = host === "app" ? "dashboard" : "submit";
  if (stage === "production") return `${prefix}.${ZONE}`;
  if (stage === "staging") return `staging.${prefix}.${ZONE}`;
  if (/^pr-\d+$/.test(stage)) return `${stage}.${prefix}.${ZONE}`;
  return undefined;
};

export const mainWorkerDomainFor = (stage: string): string | WorkerDomainConfig | undefined => {
  const hostname = hostnameFor(stage, "app");
  if (hostname === undefined) return undefined;
  if (stage === "production") {
    return {
      name: hostname,
      redirects: [`app.${ZONE}`],
    };
  }
  return hostname;
};

export const APEX_SERVED_BY_SITE = true;

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
