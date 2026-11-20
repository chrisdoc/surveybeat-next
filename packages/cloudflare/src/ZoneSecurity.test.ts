import { describe, expect, it } from "@effect/vitest";
import { ZONE_SECURITY_SETTINGS, managesZoneSecurity } from "./ZoneSecurity.ts";

describe("managesZoneSecurity", () => {
  it("runs only on production so preview and dev stages leave zone defaults untouched", () => {
    expect(managesZoneSecurity("production")).toBe(true);
    expect(managesZoneSecurity("staging")).toBe(false);
    expect(managesZoneSecurity("pr-324")).toBe(false);
    expect(managesZoneSecurity("dev-alice")).toBe(false);
  });
});

describe("ZONE_SECURITY_SETTINGS", () => {
  it("pins Full (strict) SSL, TLS >= 1.2, Always Use HTTPS, and 6-month HSTS with nosniff", () => {
    const byId = new Map<string, unknown>(
      ZONE_SECURITY_SETTINGS.map((entry) => [entry.settingId, entry.value]),
    );

    expect(byId.get("ssl")).toBe("strict");
    expect(byId.get("min_tls_version")).toBe("1.2");
    expect(byId.get("always_use_https")).toBe("on");
    expect(byId.get("security_header")).toEqual({
      strict_transport_security: {
        enabled: true,
        max_age: 15_552_000,
        include_subdomains: false,
        preload: false,
        nosniff: true,
      },
    });
  });
});
