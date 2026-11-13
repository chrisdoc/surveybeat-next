# The app entry uses Foldkit and @foldkit/ui instead of React and Base UI

Amends ADR 0008, which chose React, TanStack Router, and Base UI for the app entry of `apps/web`. The owner decided on 2026-11-07 to use Foldkit (the Elm architecture on Effect) before more UI slices landed (issue #57, PR #60).

- **App entry.** Foldkit and `@foldkit/ui` with Foldkit's typed bidirectional router. State is an Effect Schema Model with Messages, a pure `update`, `Command.define`, and a declarative `view`. React, react-dom, and `@base-ui/react` are removed from `apps/web`; React stays only in `packages/emails`. Tailwind v4 and the CSS custom property tokens stay. `foldkit`, `@foldkit/ui`, and `@foldkit/vite-plugin` are exact catalog pins that move together with the Effect pins.
- **Answer entry unchanged.** It stays plain TypeScript with no framework, within the ADR 0008 budget (JS ≤ 10 KB gzip on the critical path). Measured on a throwaway branch: Foldkit static prerender plus hydration (Variant F) was 304.8 KB raw / 97.3 KB gzip, against 25.0 KB gzip for plain TypeScript with Schema (1.5 KB without) and 90.8 KB gzip for React. Foldkit is therefore banned from the answer entry as well as from `domain` and `api` (lint rule `domain-boundary`).
- **Tests.** App tests are Foldkit Story (update plus `Command.resolve`) and Scene (role and label locators) suites in Vitest, with no browser.
- **Lint.** `no-literal-ui-text` applies to Foldkit `h()` view calls instead of JSX.

## Considered Options

- **Stay on React, TanStack Router, and Base UI.** Rejected by the owner: Foldkit's schema-first Elm architecture fits the Effect codebase, and moving early is cheaper than after more screens exist.
- **Foldkit for the answer entry too.** Rejected on the measurements above.

## Consequences

Foldkit is pre-1.0, which is an accepted risk: the Elm architecture and schema-first design are stable, Story and Scene tests run without browser overhead, and the Vite plugin keeps state across live reloads. Pin bumps need a PR of their own, together with Effect.
