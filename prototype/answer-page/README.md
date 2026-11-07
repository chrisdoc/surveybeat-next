PROTOTYPE: four build strategies for the answer page's first screens (A prerendered HTML + vanilla TS, B Preact, C React 19, D React 19 + Base UI), switchable via ?variant=, measured with Lighthouse mobile. Throwaway; never merged.

- View: `pnpm --dir prototype/answer-page install && pnpm --dir prototype/answer-page dev` then open http://localhost:3100/a?variant=A#t=test&v=4 (←/→ keys or the bottom bar switch variants; the bar is prototype-only and is not injected when `bar=0`).
- Measure: `pnpm --dir prototype/answer-page measure` (about 15 min; `RUNS=1` for a quick pass). Writes RESULTS.md and results.json. Needs Playwright's headless-shell Chromium (override with CHROME_PATH).
- Mock server: `server.mjs`, `DELAY_MS` (default 150), `PORT` (default 3100). `?nos=1` serves the build without the Effect Schema decode.
- Findings: see RESULTS.md.
