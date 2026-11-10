import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const distDir = resolve(import.meta.dirname, "../../dist");

describe("answer page performance budget", () => {
  it("satisfies HTML, CSS, and JS critical path budgets", () => {
    const htmlPath = resolve(distDir, "answer.html");
    if (!existsSync(htmlPath)) {
      execSync("pnpm --filter @surveybeat/web build", {
        cwd: resolve(import.meta.dirname, "../../../.."),
        stdio: "ignore",
      });
    }
    expect(existsSync(htmlPath), "apps/web/dist/answer.html should exist").toBe(true);

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
    expect(styleMatch, "answer.html should have inline <style>").not.toBeNull();
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
    while (pending.length > 0) {
      const fileName = pending.pop() ?? "";
      if (!fileName.endsWith(".js") || counted.has(fileName) || !existsSync(resolve(assetsDir, fileName))) {
        continue;
      }
      counted.add(fileName);
      const fileContent = readFileSync(resolve(assetsDir, fileName));
      criticalPathJsGz += gzipSync(fileContent, { level: 9 }).length;
      const source = fileContent.toString("utf8");
      for (const m of source.matchAll(
        /(?:^|[;\s}])(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g,
      )) {
        pending.push(m[1] ?? "");
      }
    }
    expect(counted.size).toBeGreaterThanOrEqual(scriptSrcMatches.length);
    // The app's full catalog must stay off the answer page's critical path.
    expect([...counted].some((name) => name.startsWith("messages-"))).toBe(false);

    expect(
      criticalPathJsGz,
      `Critical path JS (${(criticalPathJsGz / 1024).toFixed(2)} KB gzip in ${[...counted].join(", ")}) should be ≤ 10 KB gzip`,
    ).toBeLessThanOrEqual(10 * 1024);
  });
});
