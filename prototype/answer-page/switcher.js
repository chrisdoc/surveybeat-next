// PROTOTYPE-ONLY variant switcher. Injected by server.mjs; never part of a measured page (?bar=0).
;(() => {
  const V = ["A", "B", "C", "D"]
  const L = { A: "A: prerendered HTML + vanilla TS", B: "B: Preact + signals", C: "C: React 19", D: "D: React 19 + Base UI" }
  const cur = () => (new URLSearchParams(location.search).get("variant") || "A").toUpperCase()
  const go = (d) => {
    const u = new URLSearchParams(location.search)
    u.set("variant", V[(V.indexOf(cur()) + d + V.length) % V.length])
    history.replaceState(null, "", location.pathname + "?" + u) // fragment already removed by the page
    location.reload()
  }
  const bar = document.createElement("div")
  bar.setAttribute("role", "region")
  bar.setAttribute("aria-label", "Prototype variant switcher")
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;gap:.5rem;align-items:center;justify-content:center;padding:.4rem;background:#111;color:#fff;font:14px system-ui"
  const b = (txt, label, d) => {
    const e = document.createElement("button")
    e.textContent = txt
    e.setAttribute("aria-label", label)
    e.style.cssText = "width:44px;min-height:44px;font:inherit;background:#333;color:#fff;border:1px solid #888;border-radius:6px"
    e.onclick = () => go(d)
    return e
  }
  const l = document.createElement("span")
  l.textContent = "PROTOTYPE ONLY · " + L[cur()]
  l.setAttribute("aria-live", "polite")
  bar.append(b("←", "Previous variant", -1), l, b("→", "Next variant", 1))
  document.body.append(bar)
  addEventListener("keydown", (e) => {
    const t = document.activeElement
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    if (e.key === "ArrowLeft") go(-1)
    if (e.key === "ArrowRight") go(1)
  })
})()
