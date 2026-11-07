import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join } from "node:path"
import { homedir } from "node:os"
import { spawn } from "node:child_process"
import { networkInterfaces } from "node:os"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"
import { buildAll } from "./build.mjs"
import { start } from "../server.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const CHROME = process.env.CHROME_PATH ?? join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1248/" + readdirSync(join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1248")).find((d) => d.startsWith("chrome-")), "chrome-headless-shell")
const PORT = 3199, DELAY = 150, RUNS = Number(process.env.RUNS ?? 5)
const VARS = ["A", "B", "C", "D"]
const LAN = Object.values(networkInterfaces()).flat().find((i) => i.family === "IPv4" && !i.internal)?.address ?? "localhost"
const url = (v, extra = "", host = "localhost") => `http://${host}:${PORT}/a?variant=${v}&bar=0${extra}#t=test&v=4`
const gz = (b) => gzipSync(b, { level: 9 }).length
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const worst = (a) => Math.max(...a)

function sizes(name) {
  const d = join(root, "dist", name)
  const html = readFileSync(join(d, "index.html"))
  const out = { jsRaw: 0, js: 0, css: 0, html: gz(html), htmlRaw: html.length, inlineCss: 0 }
  const inline = [...html.toString().matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("")
  if (inline) out.inlineCss = out.css = gz(Buffer.from(inline))
  const walk = join(d, "assets")
  if (existsSync(walk)) for (const f of readdirSync(walk)) {
    const b = readFileSync(join(walk, f))
    if (f.endsWith(".js")) { out.js += gz(b); out.jsRaw += b.length }
    if (f.endsWith(".css")) out.css += gz(b)
  }
  return out
}

function lighthouse(v, i) {
  return new Promise((res, rej) => {
    const out = join(root, ".lh", `${v}-${i}.json`)
    const p = spawn(join(root, "node_modules/.bin/lighthouse"), [url(v), "--output=json", `--output-path=${out}`, "--only-categories=performance", "--quiet",
      "--chrome-flags=--headless=new --no-sandbox --disable-gpu"], { env: { ...process.env, CHROME_PATH: CHROME }, stdio: "inherit" })
    p.on("exit", (c) => {
      if (c) return rej(new Error("lighthouse " + c))
      const j = JSON.parse(readFileSync(out, "utf8")), a = j.audits
      res({ fcp: a["first-contentful-paint"].numericValue, lcp: a["largest-contentful-paint"].numericValue, tbt: a["total-blocking-time"].numericValue,
        tti: a["interactive"].numericValue, si: a["speed-index"].numericValue, bench: j.environment.benchmarkIndex, throttling: j.configSettings.throttlingMethod, form: j.configSettings.formFactor })
    })
  })
}

async function pw(browser, v) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  await page.addInitScript(() => {
    window.__clicks = []
    addEventListener("click", () => window.__clicks.push(performance.now()), true)
    window.__lcp = 0
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: "largest-contentful-paint", buffered: true })
  })
  await page.goto(url(v, "", LAN), { waitUntil: "commit" })
  await page.waitForFunction(() => performance.getEntriesByName("meaningful").length && !document.querySelector("#save,button[type=submit]")?.disabled, null, { timeout: 30000 })
  await page.waitForTimeout(500)
  const m = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0].startTime
    const res = performance.getEntriesByType("resource")
    const nav = performance.getEntriesByType("navigation")[0]
    return { fcp, lcp: window.__lcp, meaningful: performance.getEntriesByName("meaningful")[0].startTime, reqBeforeFcp: 1 + res.filter((r) => r.responseEnd <= fcp).length,
      reqTotal: 1 + res.length, ttfb: nav.responseStart, hash: location.hash }
  })
  await page.click("button[type=submit]")
  await page.waitForFunction(() => performance.getEntriesByName("screen2").length, null, { timeout: 30000 })
  const s = await page.evaluate(() => {
    const e = (n) => performance.getEntriesByName(n).at(-1).startTime
    return { clickToScreen2: e("screen2") - window.__clicks.at(-1), fetchRtt: e("answer-end") - e("answer-start") }
  })
  await ctx.close()
  return { ...m, ...s }
}

async function main() {
  mkdirSync(join(root, ".lh"), { recursive: true })
  console.log("building..."); buildAll()
  const srv = await start({ port: PORT, delay: DELAY })
  const R = { sizes: {}, lh: {}, pw: {}, meta: { runs: RUNS, delay: DELAY, date: new Date().toISOString() } }
  for (const v of VARS) { R.sizes[v] = sizes(v); R.sizes[v + "-nos"] = sizes(v + "-nos") }
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] })
  for (const v of VARS) {
    R.pw[v] = []
    for (let i = 0; i < RUNS; i++) { R.pw[v].push(await pw(browser, v)); process.stdout.write(`pw ${v} ${i}\n`) }
  }
  await browser.close()
  for (const v of VARS) {
    R.lh[v] = []
    for (let i = 0; i < RUNS; i++) { R.lh[v].push(await lighthouse(v, i)); console.log(`lh ${v} ${i}`, R.lh[v].at(-1)) }
  }
  srv.close()
  writeFileSync(join(root, "results.json"), JSON.stringify(R, null, 1))
  report(R)
}

const k = (n) => (n / 1024).toFixed(1)
const ms = (n) => Math.round(n)
function report(R) {
  const L = []
  L.push("### Bundle sizes (gzip, KB) and requests before first paint", "", "| Variant | JS gz | CSS gz | HTML gz | JS raw | Requests before FCP (Playwright, median) | Schema share of JS gz |", "|---|---|---|---|---|---|---|")
  for (const v of VARS) {
    const s = R.sizes[v], n = R.sizes[v + "-nos"]
    L.push(`| ${v} | ${k(s.js)} | ${k(s.css)}${s.inlineCss ? " (inline)" : ""} | ${k(s.html)} | ${k(s.jsRaw)} | ${median(R.pw[v].map((x) => x.reqBeforeFcp))} | ${k(s.js - n.js)} KB (${k(s.jsRaw - n.jsRaw)} KB raw) |`)
  }
  L.push("", `### Lighthouse 13 (mobile, simulated slow 4G + 4x CPU), ${R.meta.runs} runs each, ms: median / worst`, "", "| Variant | FCP | LCP | TBT | TTI | Speed Index |", "|---|---|---|---|---|---|")
  for (const v of VARS) {
    const f = (key) => `${ms(median(R.lh[v].map((x) => x[key])))} / ${ms(worst(R.lh[v].map((x) => x[key])))}`
    L.push(`| ${v} | ${f("fcp")} | ${f("lcp")} | ${f("tbt")} | ${f("tti")} | ${f("si")} |`)
  }
  L.push("", `### Playwright under real DevTools throttling (150 ms RTT, 1.6 Mbps, CPU 4x, ${R.meta.delay} ms mock delay applied for real), ms: median / worst`, "", "| Variant | FCP | LCP | Meaningful (question text + enabled button painted) | Save-and-continue: click to next screen | of which POST /answer round trip |", "|---|---|---|---|---|---|")
  for (const v of VARS) {
    const f = (key) => `${ms(median(R.pw[v].map((x) => x[key])))} / ${ms(worst(R.pw[v].map((x) => x[key])))}`
    L.push(`| ${v} | ${f("fcp")} | ${f("lcp")} | ${f("meaningful")} | ${f("clickToScreen2")} | ${f("fetchRtt")} |`)
  }
  const bench = VARS.flatMap((v) => R.lh[v]).map((x) => x.bench)
  L.push("", `Lighthouse BenchmarkIndex on this host: median ${ms(median(bench))} (a Moto G4-class reference is roughly 1000-1300; a number far above means the host is faster than a mid-range phone before 4x throttling).`)
  const tpl = existsSync(join(root, "RESULTS.static.md")) ? readFileSync(join(root, "RESULTS.static.md"), "utf8") : "{{TABLES}}"
  writeFileSync(join(root, "RESULTS.md"), tpl.replace("{{TABLES}}", L.join("\n")))
  console.log(L.join("\n"))
}

if (process.argv.includes("--report-only")) report(JSON.parse(readFileSync(join(root, "results.json"), "utf8")))
else main().catch((e) => { console.error(e); process.exit(1) })
