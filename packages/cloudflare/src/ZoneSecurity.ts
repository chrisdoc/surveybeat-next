import * as Cloudflare from "@alchemy.run/cloudflare";
import { AdoptPolicy, RemovalPolicy } from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import { ZONE_ID } from "./Hostnames.ts";

export const managesZoneSecurity = (stage: string): boolean => stage === "production";

export const ZONE_SECURITY_SETTINGS = [
  { id: "ZoneSslMode", settingId: "ssl", value: "strict" },
  { id: "ZoneMinTlsVersion", settingId: "min_tls_version", value: "1.2" },
  { id: "ZoneAlwaysUseHttps", settingId: "always_use_https", value: "on" },
  {
    id: "ZoneHstsHeader",
    settingId: "security_header",
    value: {
      strict_transport_security: {
        enabled: true,
        max_age: 15_552_000,
        include_subdomains: false,
        preload: false,
        nosniff: true,
      },
    },
  },
] as const;

export const ZoneSecurity = Effect.gen(function* () {
  const { stage } = yield* Stack;

  if (!managesZoneSecurity(stage)) {
    return;
  }

  for (const setting of ZONE_SECURITY_SETTINGS) {
    yield* Cloudflare.Zone.Setting(setting.id, {
      zoneId: ZONE_ID,
      settingId: setting.settingId,
      value: setting.value,
    });
  }

  return yield* Cloudflare.DNS.Dnssec("ZoneDnssec", {
    zoneId: ZONE_ID,
    status: "active",
  });
}).pipe(AdoptPolicy.adopt(), RemovalPolicy.retain());
