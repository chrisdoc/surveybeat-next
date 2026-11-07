import { defineConfig, type Plugin } from "vite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { messages, t } from "./src/shared/messages.ts"

const V = process.env.VARIANT ?? "A"
const NOS = process.env.NOSCHEMA === "1"
const name = V + (NOS ? "-nos" : "")
const here = import.meta.dirname

const scale = (n: string) =>
  `<div class="scale">${[1, 2, 3, 4, 5]
    .map((i) => `<label><input type="radio" name="${n}" value="${i}">${messages[`scale.${i}` as "scale.1"]}</label>`)
    .join("")}</div>`

// Variant A: markup and CSS are baked into the HTML at build time.
const prerender = (): Plugin => ({
  name: "prerender",
  transformIndexHtml(html) {
    const css = readFileSync(resolve(here, "src/shared/style.css"), "utf8")
      .replace(/\s*([{};:,])\s*/g, "$1")
      .replace(/\n/g, "")
    const body = `<main>
<h1 id="pulse"></h1><p class="err" id="err" role="alert"></p>
<section data-screen="1"><form id="f1"><fieldset><legend id="q1text" tabindex="-1">${t("loading")}</legend>${scale("q1")}</fieldset>
<p class="anon" id="anon"></p><button type="submit" id="save" disabled>${t("save")}</button></form></section>
<section data-screen="2" hidden><fieldset><legend id="q2text" tabindex="-1"></legend>${scale("q2")}</fieldset>
<label for="comment"><b>${t("comment.label")}</b></label><p class="lead" id="hint">${t("comment.hint")}</p>
<textarea id="comment" aria-describedby="hint"></textarea><p class="lead" id="lead" aria-live="polite"></p>
<button type="button" id="next">${t("next")}</button></section>
<section data-screen="3" hidden><h2 tabindex="-1">${t("thanks.title")}</h2><p>${t("thanks.body")}</p><ul class="actions" id="actions"></ul></section>
</main>`
    return html.replace("<!--PRERENDER_STYLE-->", `<style>${css}</style>`).replace("<!--PRERENDER_BODY-->", body)
  },
})

export default defineConfig({
  root: resolve(here, "src", V.toLowerCase()),
  base: `/v/${name}/`,
  plugins: V === "A" ? [prerender()] : [],
  oxc: V === "A" ? undefined : { jsx: { runtime: "automatic", importSource: V === "B" ? "preact" : "react" } },
  resolve: {
    alias: NOS ? [{ find: /^\.\/decode$/, replacement: resolve(here, "src/shared/decode-none.ts") }] : [],
  },
  build: {
    outDir: resolve(here, "dist", name),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
  },
})
