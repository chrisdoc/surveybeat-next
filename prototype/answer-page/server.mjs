// Mock server: serves dist/, POST /exchange and /answer after DELAY_MS (default 150).
import { createServer } from "node:http"
import { readFileSync, existsSync, statSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { join, extname } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
export function start({ port = Number(process.env.PORT ?? 3100), delay = Number(process.env.DELAY_MS ?? 150) } = {}) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8" }
  const cache = new Map()
  const send = (req, res, status, type, buf, extra = {}) => {
    const gz = /gzip/.test(req.headers["accept-encoding"] ?? "") && /text|json|javascript/.test(type)
    let body = buf
    if (gz) { body = cache.get(buf) ?? gzipSync(buf, { level: 9 }); cache.set(buf, body) }
    res.writeHead(status, { "content-type": type, ...(gz ? { "content-encoding": "gzip" } : {}), "content-length": body.length, "cache-control": "no-store", ...extra })
    res.end(body)
  }
  const json = (req, res, obj) => send(req, res, 200, "application/json", Buffer.from(JSON.stringify(obj)))
  const redact = (s) => String(s).replace(/\S+@\S+/g, "[email]").replace(/https?:\/\/\S+/g, "[link]")
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x")
    if (req.method === "POST") {
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => setTimeout(() => {
        const b = body ? JSON.parse(body) : {}
        if (u.pathname === "/exchange")
          return json(req, res, {
            pulseName: "Team Pulse, November",
            anonymity: "Your answers are anonymous. Your Lead sees only group results, never who said what.",
            state: "open",
            questions: [
              { id: "q1", text: "How was your week overall?", allowComment: false },
              { id: "q2", text: "How supported did you feel by your team?", allowComment: true },
            ],
            actions: [
              { id: "a1", title: "Shorter Monday stand-up (in progress)" },
              { id: "a2", title: "Quiet focus hours on Wednesdays" },
            ],
          })
        if (u.pathname === "/answer") return json(req, res, { saved: true, shownToLead: b.comment == null ? undefined : redact(b.comment) })
        send(req, res, 404, "text/plain", Buffer.from("nope"))
      }, delay))
      return
    }
    if (u.pathname === "/a") {
      const v = (u.searchParams.get("variant") ?? "A").toUpperCase().replace(/[^ABCD]/g, "A")
      const f = join(root, "dist", v + (u.searchParams.get("nos") === "1" ? "-nos" : ""), "index.html")
      if (!existsSync(f)) return send(req, res, 500, "text/plain", Buffer.from("run pnpm build first"))
      let html = readFileSync(f, "utf8")
      if (u.searchParams.get("bar") !== "0") html = html.replace("</body>", '<script src="/switcher.js"></script></body>')
      return send(req, res, 200, "text/html; charset=utf-8", Buffer.from(html))
    }
    if (u.pathname === "/switcher.js") return send(req, res, 200, "text/javascript", readFileSync(join(root, "switcher.js")))
    const m = u.pathname.match(/^\/v\/([\w-]+)\/(.+)$/)
    const f = m && join(root, "dist", m[1], m[2])
    if (f && !f.includes("..") && existsSync(f) && statSync(f).isFile())
      return send(req, res, 200, types[extname(f)] ?? "application/octet-stream", readFileSync(f))
    if (u.pathname === "/") { res.writeHead(302, { location: "/a?variant=A#t=test&v=4" }); return res.end() }
    send(req, res, 404, "text/plain", Buffer.from("not found"))
  })
  return new Promise((r) => srv.listen(port, () => r(srv)))
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await start()
  console.log(`View: http://localhost:${process.env.PORT ?? 3100}/a?variant=A#t=test&v=4  (delay ${process.env.DELAY_MS ?? 150} ms)`)
}
