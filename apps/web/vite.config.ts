import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { answerCatalog, type AnswerTranslation } from "./src/messages/answer.ts";
import { answerMessages } from "./src/answer/answer-messages.ts";
import { answerDe } from "./src/messages/answer.de.ts";

const prerenderAnswer = (): Plugin => {
  let outDir = "dist";
  return {
    name: "prerender-answer",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html, ctx) {
      if (!ctx.path.endsWith("answer.html") && !html.includes("<!--PRERENDER_STYLE-->")) {
        return html;
      }
      const rawCss = readFileSync(resolve(import.meta.dirname, "src/answer/style.css"), "utf8");
      const minCss = rawCss
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s*([{};:,])\s*/g, "$1")
        .replace(/\n\s*/g, "");

      const bootstrapScript = `<script>
(function() {
  try {
    var hash = location.hash;
    var params = new URLSearchParams(hash.slice(1));
    var t = params.get("t");
    var v = params.get("v");
    if (t) {
      sessionStorage.setItem("sb_token", t);
    } else {
      t = sessionStorage.getItem("sb_token") || "";
    }
    window.__sb_token = t;
    if (v) {
      var n = parseInt(v, 10);
      if (n >= 1 && n <= 5) {
        window.__sb_v = n;
      }
    }
    if (hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (t) {
      var host = location.hostname;
      var submitOrigin = (host === "dashboard.surveybeat.app" || host === "app.surveybeat.app")
        ? "https://submit.surveybeat.app"
        : (host.endsWith(".dashboard.surveybeat.app")
            ? "https://" + host.replace(".dashboard.surveybeat.app", ".submit.surveybeat.app")
            : (host.endsWith(".app.surveybeat.app")
                ? "https://" + host.replace(".app.surveybeat.app", ".submit.surveybeat.app")
                : location.origin));
      window.__sb_submitOrigin = submitOrigin;
      window.__exchangePromise = fetch(submitOrigin + "/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t })
      }).then(function(r) {
        if (!r.ok) {
          var err = new Error("HTTP " + r.status);
          err.status = r.status;
          throw err;
        }
        return r.json();
      });
    }
  } catch (e) {}
})();
</script>`;

      // The German shell is `de/answer.html`; every other answer shell is English.
      const table: AnswerTranslation = ctx.path.endsWith("de/answer.html") ? answerDe : answerCatalog;
      const message = answerMessages(table);

      // Plain numbers here; main.ts fills the ends with the Question's own labels once the context arrives.
      const scale = [1, 2, 3, 4, 5]
        .map((value) => {
          const id = value === 1 ? ' id="q1low"' : value === 5 ? ' id="q1high"' : "";
          return `<label><input type="radio" name="q1" value="${value}"><span${id}>${value}</span></label>`;
        })
        .join("");

      const body = `<main>
  <noscript><p class="err" role="alert">${message("answer.noscript")}</p></noscript>
  <p class="mark">${message("answer.mark")}</p>
  <h1 id="pulse"></h1>
  <p class="test-banner" id="test-banner" hidden></p>
  <p class="err" id="err" role="alert" hidden></p>
  <div id="state-message" role="alert" hidden></div>
  <section data-screen="1" id="screen-1">
    <form id="f1">
      <fieldset>
        <legend id="q1text" tabindex="-1">${message("answer.loading")}</legend>
        <div class="scale">${scale}</div>
      </fieldset>
      <p class="anon" id="anon"></p>
      <button type="submit" id="save" disabled>${message("answer.save")}</button>
    </form>
  </section>
  <div id="remaining-screens" hidden></div>
  <section data-screen="thanks" id="screen-thanks" hidden>
    <h2 tabindex="-1">${message("answer.thanks.title")}</h2>
    <p id="thanks-body">${message("answer.thanks.body")}</p>
    <ul class="actions" id="actions"></ul>
  </section>
</main>`;

      return html
        .replace("<title></title>", `<title>${message("answer.title")}</title>`)
        .replace("<!--PRERENDER_STYLE-->", `<style>${minCss}</style>`)
        .replace("<!--HEAD_BOOTSTRAP-->", bootstrapScript)
        .replace("<!--PRERENDER_BODY-->", body);
    },
    closeBundle() {
      // `/a` and `/de/a` are served from copies of the prerendered shells; a failed copy fails the build.
      for (const [source, dir] of [
        ["answer.html", ""],
        ["de/answer.html", "de"],
      ] as const) {
        const answerHtmlPath = resolve(outDir, source);
        const aDir = resolve(outDir, dir, "a");
        mkdirSync(aDir, { recursive: true });
        copyFileSync(answerHtmlPath, resolve(aDir, "index.html"));
        copyFileSync(answerHtmlPath, resolve(outDir, dir, "a.html"));
      }
    },
  };
};

/**
 * Lists every chunk an answer page imports statically as `<link rel="modulepreload">`, so the browser
 * fetches them in parallel instead of discovering each level of the import graph one round trip later.
 * The answer pages share their runtime chunk, which would otherwise add a level (ADR 0008, Lighthouse gate).
 */
const preloadAnswerChunks = (): Plugin => ({
  name: "preload-answer-chunks",
  transformIndexHtml: {
    order: "post",
    handler(html, ctx) {
      const { bundle, chunk } = ctx;
      if (!ctx.path.endsWith("answer.html") || bundle === undefined || chunk === undefined) return html;
      const seen = new Set<string>();
      const pending = [...chunk.imports];
      while (pending.length > 0) {
        const fileName = pending.pop() ?? "";
        const imported = bundle[fileName];
        if (seen.has(fileName) || imported === undefined || imported.type !== "chunk") continue;
        seen.add(fileName);
        pending.push(...imported.imports);
      }
      const links = [...seen].map((fileName) => `<link rel="modulepreload" crossorigin href="/${fileName}">`);
      return html.replace("</head>", `${links.join("")}</head>`);
    },
  },
});

// Two entries in one project: the app (Foldkit) and the answer page (plain TypeScript, no framework).
export default defineConfig({
  plugins: [tailwindcss(), foldkit(), prerenderAnswer(), preloadAnswerChunks()],
  build: {
    modulePreload: false,
    rollupOptions: {
      input: {
        app: "index.html",
        answer: "answer.html",
        "answer-de": "de/answer.html",
      },
    },
  },
});
