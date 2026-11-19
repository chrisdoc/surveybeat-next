// @effect-diagnostics nodeBuiltinImport:off -- this file reads the repository from disk or spawns a process outside a Worker; the Effect FileSystem and ChildProcess services do not exist there.

import tailwindcss from "@tailwindcss/vite";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { renderSitePage } from "./src/site/render.ts";

const outDir = resolve(import.meta.dirname, "dist-site");

const prerenderSite = (): Plugin => ({
  name: "prerender-site",
  closeBundle() {
    const shellPath = resolve(outDir, "site.html");
    const shell = readFileSync(shellPath, "utf8");
    writeFileSync(resolve(outDir, "index.html"), renderSitePage("en", shell));
    rmSync(shellPath);
  },
});

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss(), prerenderSite()],
  build: {
    outDir: "dist-site",
    emptyOutDir: true,
    rolldownOptions: {
      input: { site: "site.html" },
    },
  },
});
