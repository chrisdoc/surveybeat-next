# Answer page: build strategy results (PROTOTYPE, throwaway)

Question: how do we build the answer page to reach first meaningful paint under 1 s at p75 on a mid-range phone on 4G?

Variants (same three screens: Q1 rating with preselected value + anonymity statement + "Save and continue", Q2 rating + optional comment, thank-you with 2 Actions):
A prerendered HTML (markup + CSS inline) + vanilla TS; B Preact + signals; C React 19; D React 19 + Base UI (`@base-ui/react` 1.9.0; the `@base-ui-components/react` name is deprecated and was renamed to this one; RadioGroup, Radio, Field, Fieldset, Button).
All decode the exchange with `effect/Schema` (effect 4.1.2) and use a flat English message dictionary. B, C and D render the skeleton (radio group with the preselected value, disabled button) as soon as JS runs, then fill in the question text and anonymity statement when `/exchange` returns, exactly like A. "Meaningful" = question text and anonymity statement painted with the button enabled.

### Bundle sizes (gzip, KB) and requests before first paint

| Variant | JS gz | CSS gz | HTML gz | JS raw | Requests before FCP (Playwright, median) | Schema share of JS gz |
|---|---|---|---|---|---|---|
| A | 25.0 | 0.6 (inline) | 1.3 | 75.7 | 1 | 23.5 KB (72.6 KB raw) |
| B | 33.1 | 0.6 | 0.3 | 96.9 | 3 | 23.5 KB (73.0 KB raw) |
| C | 90.8 | 0.6 | 0.3 | 290.6 | 3 | 23.3 KB (73.0 KB raw) |
| D | 104.6 | 0.8 | 0.2 | 331.3 | 3 | 23.5 KB (73.1 KB raw) |

### Lighthouse 13 (mobile, simulated slow 4G + 4x CPU), 5 runs each, ms: median / worst

| Variant | FCP | LCP | TBT | TTI | Speed Index |
|---|---|---|---|---|---|
| A | 618 / 635 | 1120 / 1193 | 1 / 16 | 1120 / 1193 | 618 / 635 |
| B | 763 / 767 | 1346 / 1418 | 0 / 13 | 1346 / 1418 | 763 / 767 |
| C | 777 / 791 | 1608 / 1613 | 0 / 16 | 1608 / 1613 | 777 / 791 |
| D | 779 / 780 | 1900 / 1913 | 30 / 42 | 1900 / 1913 | 910 / 916 |

### Playwright under real DevTools throttling (150 ms RTT, 1.6 Mbps, CPU 4x, 150 ms mock delay applied for real), ms: median / worst

| Variant | FCP | LCP | Meaningful (question text + enabled button painted) | Save-and-continue: click to next screen | of which POST /answer round trip |
|---|---|---|---|---|---|
| A | 284 / 292 | 760 / 792 | 755 / 785 | 193 / 201 | 179 / 187 |
| B | 660 / 672 | 824 / 1064 | 816 / 1059 | 194 / 212 | 174 / 185 |
| C | 1052 / 1112 | 1264 / 1312 | 1263 / 1304 | 204 / 208 | 175 / 182 |
| D | 1220 / 1292 | 1388 / 1440 | 1390 / 1437 | 242 / 256 | 177 / 180 |

Lighthouse BenchmarkIndex on this host: median 1344 (a Moto G4-class reference is roughly 1000-1300; a number far above means the host is faster than a mid-range phone before 4x throttling).

## Delta tables (from the numbers above, medians)

| Comparison | JS gz | Lighthouse FCP | Lighthouse LCP |
|---|---|---|---|
| D minus C (what Base UI adds on React) | +13.8 KB (+40.7 KB raw) | +2 ms | +292 ms (TBT 0 to 30 ms, Speed Index +133 ms) |
| D minus A | +79.6 KB | +161 ms | +780 ms |
| C minus A (React baseline) | +65.8 KB | +159 ms | +488 ms |
| B minus A | +8.1 KB | +145 ms | +226 ms |

Effect Schema alone (same variant built without the decode, `?nos=1`; JS gz with / without): A 25.0 / 1.5 KB, B 33.1 / 9.6 KB, C 90.8 / 67.5 KB, D 104.6 / 81.1 KB. So **Schema costs about 23.5 KB gzip (73 KB raw) in every variant**, which is 94% of variant A's JS. A with a hand-rolled decode is 1.5 KB.

## Method

- `pnpm measure` builds every variant twice (with and without Schema) with Vite 8, serves `dist/` from `server.mjs` (gzip level 9, `Cache-Control: no-store`), and measures at mock delay 150 ms.
- Sizes: gzip of each built file; "CSS gz" includes A's inline `<style>`; HTML gz is the whole document (so includes A's inline CSS and prerendered markup). Requests before FCP = document + resources whose `responseEnd` is before FCP, from the Resource Timing API in the Playwright runs.
- Lighthouse 13.6, performance category only, 5 runs per variant, URL `/a?variant=X&bar=0#t=test&v=4`. Defaults: mobile emulation and simulated throttling (slow 4G: 150 ms RTT, 1.6 Mbps, 4x CPU). Chromium: Playwright's `chromium_headless_shell-1248` (the full `chromium-1248` build fails on a missing libcups here).
- Mock delay under Lighthouse: simulated throttling replays a fast local load through a model and keeps the observed server response time of each request, so the 150 ms `/exchange` delay is carried into the model. Evidence: in A, LCP minus FCP is about 500 ms (one modeled RTT of 150 ms, 150 ms server delay, plus transfer), so the question text is correctly placed after the exchange. It is still a model; it was not validated against a real network.
- Playwright cross-check: fresh context per run, 360x740 @2x mobile UA, CDP `Network.emulateNetworkConditions` (150 ms, 1.6 Mbps down, 750 Kbps up) and `Emulation.setCPUThrottlingRate` 4, 5 runs. The mock delay is real here. The round trip is the in-page time between marks around `fetch('/answer')`; click to next screen is the click event to the painted screen 2 (rAF + task).

## Caveats

- Lighthouse reports TTI equal to LCP here (no long tasks), and "FMP" no longer exists in Lighthouse 13, so FCP and LCP are the proxies. LCP is the question text arriving from `/exchange`, so LCP is the closest thing to meaningful paint.
- The Playwright numbers are optimistic. The measured POST round trip is about 175-185 ms, barely above the 150 ms mock delay, so the CDP latency emulation clearly did not add a full 150 ms RTT to the in-page requests (it did slow a 75 KB file load when tested in isolation). Treat the Playwright table as a relative comparison and a lower bound; a realistic save round trip is that value plus about one RTT, about 330 ms. Trust Lighthouse for absolute numbers.
- The host has 2 cores and a Lighthouse BenchmarkIndex of about 1340, so 4x throttling is probably a little optimistic for a real mid-range phone. Runs are low-variance but N=5 on one machine says nothing about p75 over real devices.
- Real hosting would serve Brotli (smaller than gzip) over HTTP/2 or HTTP/3 with TLS; this server is plain HTTP/1.1 on loopback (TLS adds a round trip the model counts but we did not exercise).
- Base UI's Radio renders a `role=radio` button plus a visually hidden `input type=radio`, not a bare native input as in A, B and C. Accessibility was designed in (fieldset/legend, 44 px targets, visible focus, focus moved to the new screen heading) but not audited with a screen reader or axe.
- Token handling: the page removes the fragment with `history.replaceState` before the POST; the switcher bar (prototype only) is not injected when `bar=0`, so it is not in any measurement.

## Recommendation

**Build the answer page as variant A: prerendered static HTML with inline CSS and a tiny vanilla controller.** It is the only variant whose first paint is one request (the document), with FCP 618 ms in Lighthouse and 380 ms of headroom under 1 s; B and C pay extra requests (JS, CSS) and JS execution before anything paints (FCP 763 and 777 ms), and C and D pay the React runtime on top.

An honest result: **no variant reaches meaningful content (the question text from `/exchange`) under 1 s in Lighthouse**; A is closest at 1.12 s median (1.19 s worst) because the exchange is a mandatory round trip after the document. To meet the 1 s goal, define the budget on the first paint of the rating screen, which A delivers at about 0.62 s without waiting for the network, and treat the exchange-dependent text as a second milestone with its own 1.3 s budget. If the product requires the question text itself under 1 s, the exchange cannot wait for JS: the server would have to put the Question into the HTML (not possible with ADR 0005's static shell and fragment token), or the shell has to be cached and the exchange fired from an inline script in the document head instead of from a module.

Do not use the Schema in the answer page as-is: it is 23.5 KB gzip, about 15 times the rest of A's code. Either keep the shared Schema decode off the critical path (dynamic import after first paint) or write the check by hand for this one response.

Proposed budgets (gzip, answer page entry only):
- JS: 30 KB total while shipping Schema, target 10 KB if Schema is excluded from the critical path; no framework.
- CSS: 2 KB, inline in the HTML. HTML including inline CSS and prerendered screens: 8 KB.
- Round trips before first paint: 1 (the document). No blocking JS or CSS requests before FCP.
- Round trips before meaningful content: 2 (document, then `/exchange`).
- Lighthouse mobile (slow 4G, 4x CPU) CI gate: FCP at most 800 ms, LCP at most 1.3 s, TBT at most 50 ms.
- Base UI, React and anything from the main app's stack stay out of the answer page entry (this confirms ADR 0008's rule: React alone costs +66 KB gzip and +160 ms FCP; Base UI adds another +14 KB and +290 ms LCP).
