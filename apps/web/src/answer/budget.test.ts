// @effect-diagnostics globalConsole:off -- the budget check prints its measurements to the test log; it never runs an Effect program.
// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

const distDir = resolve(import.meta.dirname, "../../dist");

// One prerendered shell per locale (ADR 0018). Each must load only its own catalog.
const pages = [
  {
    name: "en",
    html: "answer.html",
    lang: "en",
    title: "Your answer",
    ownSave: "Save and continue",
    otherSave: "Speichern und weiter",
    copies: ["a/index.html", "a.html"],
  },
  {
    name: "de",
    html: "de/answer.html",
    lang: "de",
    title: "Deine Antwort",
    ownSave: "Speichern und weiter",
    otherSave: "Save and continue",
    copies: ["de/a/index.html", "de/a.html"],
  },
] as const;

beforeAll(() => {
  const allBuilt = pages.every((page) => existsSync(resolve(distDir, page.html)));
  if (!allBuilt) {
    execSync("pnpm --filter @surveybeat/web build", {
      cwd: resolve(import.meta.dirname, "../../../.."),
      stdio: "ignore",
    });
  }
}, 300_000);

describe.each(pages)("answer page performance budget ($name)", (page) => {
  it("satisfies HTML, CSS, and JS critical path budgets", () => {
    const htmlPath = resolve(distDir, page.html);
    expect(existsSync(htmlPath), `apps/web/dist/${page.html} should exist`).toBe(true);

    const html = readFileSync(htmlPath, "utf8");
    const htmlGz = gzipSync(Buffer.from(html), { level: 9 }).length;

    // Budget: HTML ≤ 8 KB (raw and gzip)
    expect(
      html.length,
      `HTML raw size (${(html.length / 1024).toFixed(2)} KB) should be ≤ 8 KB`,
    ).toBeLessThanOrEqual(8 * 1024);
    expect(htmlGz, `HTML gzip size (${(htmlGz / 1024).toFixed(2)} KB) should be ≤ 8 KB`).toBeLessThanOrEqual(
      8 * 1024,
    );

    // Budget: CSS ≤ 2 KB inline (measured as gzip in prototype RESULTS.md, raw also kept minimal)
    const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
    expect(styleMatch, `${page.html} should have inline <style>`).not.toBeNull();
    const inlineCss = styleMatch ? (styleMatch[1] ?? "") : "";
    const inlineCssGz = gzipSync(Buffer.from(inlineCss), { level: 9 }).length;
    expect(
      inlineCssGz,
      `Inline CSS gzip size (${(inlineCssGz / 1024).toFixed(2)} KB) should be ≤ 2 KB`,
    ).toBeLessThanOrEqual(2 * 1024);

    // Budget: JS ≤ 10 KB gzip on critical path
    const scriptSrcMatches = Array.from(html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)).map(
      (m) => m[1] ?? "",
    );
    expect(scriptSrcMatches.length).toBeGreaterThan(0);

    // Count each entry script and every chunk it imports statically; dynamic import() is off the critical path.
    const assetsDir = resolve(distDir, "assets");
    const counted = new Set<string>();
    const pending = scriptSrcMatches.map((src) => src.split("/").pop() ?? "");
    let criticalPathJsGz = 0;
    let criticalPathSource = "";
    while (pending.length > 0) {
      const fileName = pending.pop() ?? "";
      if (!fileName.endsWith(".js") || counted.has(fileName) || !existsSync(resolve(assetsDir, fileName))) {
        continue;
      }
      counted.add(fileName);
      const fileContent = readFileSync(resolve(assetsDir, fileName));
      criticalPathJsGz += gzipSync(fileContent, { level: 9 }).length;
      const source = fileContent.toString("utf8");
      criticalPathSource += source;
      for (const m of source.matchAll(
        /(?:^|[;\s}])(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g,
      )) {
        pending.push(m[1] ?? "");
      }
    }
    expect(counted.size).toBeGreaterThanOrEqual(scriptSrcMatches.length);
    // Every imported chunk is preloaded, so the browser fetches the whole graph in one round trip.
    const preloaded = Array.from(
      html.matchAll(/<link rel="modulepreload"[^>]*href="\/assets\/([^"]+)"/g),
    ).map((m) => m[1] ?? "");
    const entries = new Set(scriptSrcMatches.map((src) => src.split("/").pop() ?? ""));
    expect(preloaded.sort()).toEqual([...counted].filter((name) => !entries.has(name)).sort());
    // The app's full catalog must stay off the answer page's critical path.
    expect([...counted].some((name) => name.startsWith("messages-"))).toBe(false);
    // Each page loads its own locale's answer strings, and not the other's.
    expect(criticalPathSource, `${page.name} critical path should carry its own save label`).toContain(
      page.ownSave,
    );
    expect(criticalPathSource, `${page.name} critical path should not carry the other locale`).not.toContain(
      page.otherSave,
    );

    expect(
      criticalPathJsGz,
      `Critical path JS (${(criticalPathJsGz / 1024).toFixed(2)} KB gzip in ${[...counted].join(", ")}) should be ≤ 10 KB gzip`,
    ).toBeLessThanOrEqual(10 * 1024);

    // The shell is locale-correct: language and prerendered title.
    expect(html).toContain(`<html lang="${page.lang}">`);
    expect(html).toContain(`<title>${page.title}</title>`);

    // The generic scale words are gone: the ends of the scale carry the Question's own labels.
    for (const generic of ["Very poor", "Very good", "Sehr schlecht", "Sehr gut"]) {
      expect(html, `${page.name} shell should not carry the generic scale label "${generic}"`).not.toContain(
        generic,
      );
    }

    console.info(
      `[budget ${page.name}] HTML ${(html.length / 1024).toFixed(2)} KB raw, ${(htmlGz / 1024).toFixed(2)} KB gzip; ` +
        `CSS ${(inlineCssGz / 1024).toFixed(2)} KB gzip; ` +
        `critical JS ${(criticalPathJsGz / 1024).toFixed(2)} KB gzip in ${[...counted].join(", ")}`,
    );
  });

  it("writes the /a and /de/a copies of the shell", () => {
    for (const copy of page.copies) {
      expect(existsSync(resolve(distDir, copy)), `dist/${copy} should exist`).toBe(true);
    }
  });
});
