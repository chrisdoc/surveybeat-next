// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { renderSitePage } from "./src/site/render.ts";

const outDir = resolve(import.meta.dirname, "dist-site");

/**
 * Turns the built `site.html` shell into one static page per locale: English at `/`, German at
 * `/de/`. The shell's hashed stylesheet link is already in place when `closeBundle` runs.
 */
const prerenderSite = (): Plugin => ({
  name: "prerender-site",
  closeBundle() {
    const shellPath = resolve(outDir, "site.html");
    const shell = readFileSync(shellPath, "utf8");
    writeFileSync(resolve(outDir, "index.html"), renderSitePage("en", shell));
    mkdirSync(resolve(outDir, "de"), { recursive: true });
    writeFileSync(resolve(outDir, "de", "index.html"), renderSitePage("de", shell));
    rmSync(shellPath);
  },
});

// The landing page: static HTML and CSS, no JavaScript. Built separately from the app (ADR 0020).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), prerenderSite()],
  build: {
    outDir: "dist-site",
    emptyOutDir: true,
    rollupOptions: {
      input: { site: "site.html" },
    },
  },
});
