# Lint scope

`oxlint.config.ts` replaces the old `.oxlintrc.json`. It extends `ultracite/oxlint/core` 8.3.0, the config the rat-stack reference uses, and loads the plugins #205 names: `surveybeat`, `no-comments`, `foldkit` (scoped to the Foldkit app), `anti-slop`, `anti-slop-effect`, `effect-tests`, `patterns`, and `xstate-effect` (from `@xstate/effect/oxlint`), plus Ultracite's opt-in `ultracite/oxlint/landmines` preset (`@interfere/landmines`). 429 rules run at `error`; the ones that are not at `error` are listed below by name.

## Adopted surface

- `surveybeat/domain-boundary`, `surveybeat/privacy-query`, `surveybeat/no-literal-ui-text` stay, because they encode ADRs the reference does not have.
- `@foldkit/oxlint-plugin` recommended, mapped to `error` and `off` only; its `rules` are scoped to `apps/web/src/**/*.ts` and never to `apps/web/src/answer/**`, per ADR 0008.
- Vendored anti-slop: `tools/oxlint/anti-slop/` (18 generic rules and 5 Effect rules, MIT, `UPSTREAM.md` records `dmmulroy/anti-slop` at `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`).
- `effect-tests/no-manual-effect-runtime-in-tests` at `error`. The three `Effect.runSync` calls in `Themes.privacy.test.ts` were moved to `it.effect`, not suppressed.
- The five pattern rules at `error`: `no-module-level-mutable-state`, `no-shared-pending-cache`, `no-sleep-in-loop`, `shared-waiters`, `acquire-release-constructs-in-acquire-body`. `MainWorker`'s request-scoped `Effect.cached` was replaced with the plain `authSettings` Effect; the remaining `apps/web/src/messages/**` module state is exempted by scope (see below).
- `@interfere/landmines` 0.1.0 ([interfere-inc/landmines](https://github.com/interfere-inc/landmines)), through Ultracite's [landmines preset](https://www.ultracite.ai/docs/presets#agent-shortcut-rules-with-landmines): every `landmines-testing` and `landmines-structure` rule runs at `error`. On adoption the tree had two `vi.stubGlobal("navigator")` stubs, now replaced by passing the browser languages to `initialModel`, and six API tests that imported a harness from `auth/`; that harness moved to `packages/cloudflare/src/testing.ts`, beside the handlers it wires. `landmines-style/no-comments` is off: `no-comments/no-comments` already owns that policy and keeps `@effect-diagnostics … -- reason` directives and the JSDoc types the `checkJs` scripts need, which `landmines-style/no-comments` reports (575 findings).
- `landmines-testing/no-flake-masking` carries an exact per-file allowance for the workerd adapter tests whose deploys need a raised timeout: `packages/cloudflare/src/Organization.test.ts` 5 and `packages/cloudflare/src/Email.test.ts` 1. The rule reports when a file drops below its allowance, so lower the number as timeouts go.
- Every adopted rule has a fixture: `tools/oxlint/fixtures/` holds a violating file per rule and `tools/oxlint/rules.test.ts` runs real oxlint over them, the same way `tools/oxlint-plugin-surveybeat/index.test.ts` does. `xstate-inline.ts` and `xstate-declared.ts` are the pair for `xstate-effect/no-inline-effect`: the first discards an Effect in an inline `enq` action and spawns inline Effect logic, the second declares both in `setupEffect` and passes only their names.

## Scope exceptions

Each is an `overrides` entry that names the rule and the files it cannot apply to.

- `apps/web/src/answer/**`: the Foldkit recommended set does not apply. ADR 0008 keeps that entry free of Foldkit.
- `apps/web/src/messages/**`: `patterns/no-module-level-mutable-state` is off. The browser app has one reader and the module's purpose is the current locale; the rule targets server and Worker isolates.
- `**/*.test.ts` and `infra/tests/**`: `no-comments`, `typescript/consistent-type-assertions`, and `surveybeat/privacy-query` are off, as they were before #205.

## Restyle exceptions

Adopting the reference's surface verbatim would have meant rewriting this tree: Ultracite core alone produced 6,713 findings here and the plugin set another 6,431. #205's rule is "`error` when clean, otherwise a counted baseline". Rather than carry a 14k baseline, the rules that need a repo-wide restyle are off by name in `restyleExceptionsOff`, with the count each one produced on 2026-11-14. The follow-up restyle is issue #216; as it lands, delete the rule's line from `restyleExceptionsOff` so it runs again at its reference severity.

5680 findings across 79 rules are excepted, by namespace: `anti-slop` 9, `anti-slop-effect` 4, `eslint` 18, `foldkit` 7, `import` 1, `jsdoc` 2, `landmines-types` 1, `oxc` 2, `promise` 3, `typescript` 15, `unicorn` 17.

| Rule | Findings on adoption |
| --- | ---: |
| `anti-slop/no-chained-type-assertions` | 19 |
| `anti-slop/no-conditional-empty-object-spread` | 32 |
| `anti-slop/no-known-value-widening` | 48 |
| `anti-slop/no-runtime-typeof` | 98 |
| `anti-slop/no-shape-in-symbol-names` | 29 |
| `anti-slop/no-unknown-parameters` | 30 |
| `anti-slop/no-unknown-returns` | 15 |
| `anti-slop/no-unsafe-dictionary-type` | 43 |
| `anti-slop/require-safety-comment-for-type-assertion` | 151 |
| `anti-slop-effect/no-manual-tag-comparison` | 406 |
| `anti-slop-effect/no-manual-tagged-construction` | 1389 |
| `anti-slop-effect/no-service-constructor-imports` | 26 |
| `anti-slop-effect/prefer-effect-match` | 16 |
| `eslint/array-callback-return` | 4 |
| `eslint/complexity` | 24 |
| `eslint/default-case` | 47 |
| `eslint/func-names` | 321 |
| `eslint/func-style` | 50 |
| `eslint/max-classes-per-file` | 16 |
| `eslint/no-await-in-loop` | 14 |
| `eslint/no-bitwise` | 13 |
| `eslint/no-empty` | 2 |
| `eslint/no-inline-comments` | 22 |
| `eslint/no-negated-condition` | 49 |
| `eslint/no-nested-ternary` | 35 |
| `eslint/no-plusplus` | 71 |
| `eslint/no-redeclare` | 153 |
| `eslint/no-shadow` | 35 |
| `eslint/prefer-destructuring` | 79 |
| `eslint/prefer-named-capture-group` | 24 |
| `eslint/require-unicode-regexp` | 136 |
| `foldkit/got-prefix-requires-submodel-payload` | 15 |
| `foldkit/got-wrapper-carries-only-routing` | 15 |
| `foldkit/keyed-required-for-mapped-rows` | 5 |
| `foldkit/no-child-message-construction-in-root` | 4 |
| `foldkit/no-module-level-mutable-state` | 9 |
| `foldkit/no-switch-on-message-tag` | 13 |
| `foldkit/prefer-option-over-nullable-in-model` | 1 |
| `import/no-mutable-exports` | 8 |
| `jsdoc/require-param-description` | 45 |
| `jsdoc/require-returns-description` | 16 |
| `landmines-types/no-explicit-return-types` (adopted 2026-11-18) | 748 |
| `oxc/no-accumulating-spread` | 9 |
| `oxc/no-barrel-file` | 8 |
| `promise/avoid-new` | 3 |
| `promise/param-names` | 2 |
| `promise/prefer-await-to-callbacks` | 11 |
| `typescript/consistent-return` | 50 |
| `typescript/consistent-type-definitions` | 5 |
| `typescript/no-confusing-void-expression` | 17 |
| `typescript/no-non-null-assertion` | 43 |
| `typescript/no-unnecessary-type-parameters` | 9 |
| `typescript/no-unsafe-argument` | 16 |
| `typescript/no-unsafe-assignment` | 49 |
| `typescript/no-unsafe-call` | 26 |
| `typescript/no-unsafe-member-access` | 133 |
| `typescript/no-unsafe-return` | 16 |
| `typescript/no-unsafe-type-assertion` | 125 |
| `typescript/promise-function-async` | 113 |
| `typescript/strict-boolean-expressions` | 40 |
| `typescript/strict-void-return` | 15 |
| `typescript/switch-exhaustiveness-check` | 4 |
| `unicorn/consistent-function-scoping` | 66 |
| `unicorn/filename-case` | 165 |
| `unicorn/import-style` | 13 |
| `unicorn/no-array-for-each` | 23 |
| `unicorn/no-array-method-this-argument` | 48 |
| `unicorn/no-array-reduce` | 3 |
| `unicorn/no-array-sort` | 52 |
| `unicorn/no-await-expression-member` | 140 |
| `unicorn/no-negated-condition` | 49 |
| `unicorn/no-useless-undefined` | 9 |
| `unicorn/prefer-number-coercion` | 29 |
| `unicorn/prefer-query-selector` | 20 |
| `unicorn/prefer-single-call` | 9 |
| `unicorn/prefer-structured-clone` | 2 |
| `unicorn/prefer-ternary` | 4 |
| `unicorn/text-encoding-identifier-case` | 45 |
| `unicorn/throw-new-error` | 33 |

These are off, not deleted: `restyleExceptionsOff` is the single list, so the next pass can see exactly what is owed and what each rule costs.
