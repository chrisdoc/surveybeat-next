import { assert, describe, it } from "@effect/vitest";
import { hostnameFor, mainWorkerDomainFor, siteDomainFor } from "./Hostnames.ts";

describe("hostnameFor (app and submit hostnames)", () => {
  it("serves production, staging and PR stages on their subdomains", () => {
    assert.strictEqual(hostnameFor("production", "app"), "dashboard.surveybeat.app");
    assert.strictEqual(hostnameFor("staging", "submit"), "staging.submit.surveybeat.app");
    assert.strictEqual(hostnameFor("staging", "app"), "staging.dashboard.surveybeat.app");
    assert.strictEqual(hostnameFor("pr-12", "app"), "pr-12.dashboard.surveybeat.app");
  });

  it("leaves personal stages on workers.dev", () => {
    assert.strictEqual(hostnameFor("dev-christoph", "app"), undefined);
  });
});

describe("mainWorkerDomainFor (app domain configuration)", () => {
  it("serves dashboard.surveybeat.app with app.surveybeat.app redirect in production", () => {
    assert.deepStrictEqual(mainWorkerDomainFor("production"), {
      name: "dashboard.surveybeat.app",
      redirects: ["app.surveybeat.app"],
    });
  });

  it("serves staging.dashboard.surveybeat.app in staging", () => {
    assert.strictEqual(mainWorkerDomainFor("staging"), "staging.dashboard.surveybeat.app");
  });

  it("leaves personal stages undefined", () => {
    assert.strictEqual(mainWorkerDomainFor("dev-christoph"), undefined);
  });
});

describe("siteDomainFor (landing page hostnames)", () => {
  it("serves staging and PR stages on one-level subdomains", () => {
    assert.strictEqual(siteDomainFor("staging"), "staging.surveybeat.app");
    assert.strictEqual(siteDomainFor("pr-12"), "pr-12.surveybeat.app");
  });

  it("serves production on workers.dev when apexServedBySite is false", () => {
    assert.strictEqual(siteDomainFor("production", false), undefined);
  });

  it("serves the apex with www redirecting to it when the cutover is on", () => {
    assert.deepStrictEqual(siteDomainFor("production"), {
      name: "surveybeat.app",
      redirects: ["www.surveybeat.app"],
    });
    assert.deepStrictEqual(siteDomainFor("production", true), {
      name: "surveybeat.app",
      redirects: ["www.surveybeat.app"],
    });
  });

  it("leaves personal stages on workers.dev", () => {
    assert.strictEqual(siteDomainFor("dev-christoph"), undefined);
    assert.strictEqual(siteDomainFor("dev-christoph", true), undefined);
  });
});
