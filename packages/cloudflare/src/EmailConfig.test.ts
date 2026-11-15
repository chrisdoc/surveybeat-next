import { describe, expect, it } from "@effect/vitest";
import { FROM, SENDING_DOMAIN, sendsRealEmail } from "./Email.ts";
import { ZONE } from "./Hostnames.ts";
import { isAppRedirect, siteAssetsDirectory } from "./SiteWorker.ts";

describe("sendsRealEmail", () => {
  it("sends only from production, so every other stage records email instead", () => {
    expect(sendsRealEmail("production")).toBe(true);
    expect(sendsRealEmail("staging")).toBe(false);
    expect(sendsRealEmail("dev-alice")).toBe(false);
    expect(sendsRealEmail("test_ci")).toBe(false);
  });
});

describe("the sending identity", () => {
  it("sends from a subdomain, so the apex keeps its own mail, SPF and DMARC records", () => {
    expect(SENDING_DOMAIN).toBe(`notify.${ZONE}`);
    expect(SENDING_DOMAIN.startsWith("notify.")).toBe(true);
    expect(FROM.email).toBe(`team@${SENDING_DOMAIN}`);
  });
});

describe("the site Worker", () => {
  it("redirects /app to the app, on a GET only", () => {
    expect(isAppRedirect("GET", "/app")).toBe(true);
    expect(isAppRedirect("GET", "/app/")).toBe(true);
    expect(isAppRedirect("POST", "/app")).toBe(false);
    expect(isAppRedirect("GET", "/pricing")).toBe(false);
  });

  it("serves the prerendered landing page from an absolute path", () => {
    expect(siteAssetsDirectory.startsWith("/")).toBe(true);
    expect(siteAssetsDirectory.endsWith("/apps/web/dist-site")).toBe(true);
  });
});
