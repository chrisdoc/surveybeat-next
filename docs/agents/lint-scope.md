# Lint scope

`oxlint.config.ts` replaces the old `.oxlintrc.json`. It extends `ultracite/oxlint/core` 8.1.1, the config the rat-stack reference uses, and loads the plugins #205 names: `surveybeat`, `no-comments`, `foldkit` (scoped to the Foldkit app), `anti-slop`, `anti-slop-effect`, `effect-tests`, `patterns`, and `xstate-effect` (from `@xstate/effect/oxlint`). 398 rules run at `error`; the ones that are not at `error` are listed below by name.

## Adopted surface

- `surveybeat/domain-boundary`, `surveybeat/privacy-query`, `surveybeat/no-literal-ui-text` stay, because they encode ADRs the reference does not have.
- `@foldkit/oxlint-plugin` recommended, mapped to `error` and `off` only; its `rules` are scoped to `apps/web/src/**/*.ts` and never to `apps/web/src/answer/**`, per ADR 0008.
- Vendored anti-slop: `tools/oxlint/anti-slop/` (18 generic rules and 5 Effect rules, MIT, `UPSTREAM.md` records `dmmulroy/anti-slop` at `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`).
- `effect-tests/no-manual-effect-runtime-in-tests` at `error`. The three `Effect.runSync` calls in `Themes.privacy.test.ts` were moved to `it.effect`, not suppressed.
- The five pattern rules at `error`: `no-module-level-mutable-state`, `no-shared-pending-cache`, `no-sleep-in-loop`, `shared-waiters`, `acquire-release-constructs-in-acquire-body`. `MainWorker`'s request-scoped `Effect.cached` was replaced with the plain `authSettings` Effect; the remaining `apps/web/src/messages/**` module state is exempted by scope (see below).
- Every adopted rule has a fixture: `tools/oxlint/fixtures/` holds a violating file per rule and `tools/oxlint/rules.test.ts` runs real oxlint over them, the same way `tools/oxlint-plugin-surveybeat/index.test.ts` does. `xstate-inline.ts` and `xstate-declared.ts` are the pair for `xstate-effect/no-inline-effect`: the first discards an Effect in an inline `enq` action and spawns inline Effect logic, the second declares both in `setupEffect` and passes only their names.

## Scope exceptions

Each is an `overrides` entry that names the rule and the files it cannot apply to.

- `apps/web/src/answer/**`: the Foldkit recommended set does not apply. ADR 0008 keeps that entry free of Foldkit.
- `apps/web/src/messages/**`: `patterns/no-module-level-mutable-state` is off. The browser app has one reader and the module's purpose is the current locale; the rule targets server and Worker isolates.
- `**/*.test.ts` and `infra/tests/**`: `no-comments`, `typescript/consistent-type-assertions`, and `surveybeat/privacy-query` are off, as they were before #205.

## Restyle exceptions

Adopting the reference's surface verbatim would have meant rewriting this tree: Ultracite core alone produced 6,713 findings here and the plugin set another 6,431. #205's rule is "`error` when clean, otherwise a counted baseline". Rather than carry a 14k baseline, the rules that need a repo-wide restyle are off by name in `restyleExceptionsOff`, with the count each one produced on 2026-11-14. The follow-up restyle is issue #216; as it lands, delete the rule's line from `restyleExceptionsOff` so it runs again at its reference severity.

13832 findings across 151 rules are excepted, by namespace: `anti-slop` 11, `anti-slop-effect` 4, `eslint` 37, `foldkit` 9, `import` 3, `jsdoc` 2, `node` 1, `oxc` 2, `promise` 4, `typescript` 34, `unicorn` 44.

| Rule | Findings on adoption |
| --- | ---: |
| `anti-slop/no-array-filter-map` | 7 |
| `anti-slop/no-chained-type-assertions` | 19 |
| `anti-slop/no-conditional-empty-object-spread` | 32 |
| `anti-slop/no-known-value-widening` | 48 |
| `anti-slop/no-runtime-typeof` | 98 |
| `anti-slop/no-shape-in-symbol-names` | 29 |
| `anti-slop/no-unknown-parameters` | 30 |
| `anti-slop/no-unknown-returns` | 15 |
| `anti-slop/no-unsafe-dictionary-type` | 43 |
| `anti-slop/require-readable-spacing` | 4044 |
| `anti-slop/require-safety-comment-for-type-assertion` | 151 |
| `anti-slop-effect/no-manual-tag-comparison` | 406 |
| `anti-slop-effect/no-manual-tagged-construction` | 1389 |
| `anti-slop-effect/no-service-constructor-imports` | 26 |
| `anti-slop-effect/prefer-effect-match` | 16 |
| `eslint/array-callback-return` | 4 |
| `eslint/complexity` | 24 |
| `eslint/curly` | 629 |
| `eslint/default-case` | 47 |
| `eslint/eqeqeq` | 1 |
| `eslint/func-names` | 321 |
| `eslint/func-style` | 50 |
| `eslint/max-classes-per-file` | 16 |
| `eslint/no-await-in-loop` | 14 |
| `eslint/no-bitwise` | 13 |
| `eslint/no-duplicate-imports` | 2 |
| `eslint/no-else-return` | 2 |
| `eslint/no-empty` | 2 |
| `eslint/no-eq-null` | 1 |
| `eslint/no-fallthrough` | 1 |
| `eslint/no-inline-comments` | 22 |
| `eslint/no-loop-func` | 1 |
| `eslint/no-negated-condition` | 49 |
| `eslint/no-nested-ternary` | 35 |
| `eslint/no-new` | 1 |
| `eslint/no-plusplus` | 71 |
| `eslint/no-promise-executor-return` | 2 |
| `eslint/no-redeclare` | 153 |
| `eslint/no-sequences` | 1 |
| `eslint/no-shadow` | 35 |
| `eslint/no-use-before-define` | 74 |
| `eslint/no-useless-return` | 1 |
| `eslint/no-void` | 7 |
| `eslint/prefer-const` | 2 |
| `eslint/prefer-destructuring` | 79 |
| `eslint/prefer-exponentiation-operator` | 1 |
| `eslint/prefer-named-capture-group` | 24 |
| `eslint/prefer-template` | 6 |
| `eslint/require-await` | 1 |
| `eslint/require-unicode-regexp` | 136 |
| `eslint/sort-keys` | 2570 |
| `eslint/sort-vars` | 1 |
| `foldkit/got-prefix-requires-submodel-payload` | 15 |
| `foldkit/got-wrapper-carries-only-routing` | 15 |
| `foldkit/keyed-required-for-mapped-rows` | 5 |
| `foldkit/no-child-message-construction-in-root` | 4 |
| `foldkit/no-empty-children-array` | 1 |
| `foldkit/no-impure-call-at-decision-time` | 1 |
| `foldkit/no-module-level-mutable-state` | 9 |
| `foldkit/no-switch-on-message-tag` | 13 |
| `foldkit/prefer-option-over-nullable-in-model` | 1 |
| `import/consistent-type-specifier-style` | 384 |
| `import/no-duplicates` | 4 |
| `import/no-mutable-exports` | 8 |
| `jsdoc/require-param-description` | 45 |
| `jsdoc/require-returns-description` | 16 |
| `node/callback-return` | 1 |
| `oxc/no-accumulating-spread` | 9 |
| `oxc/no-barrel-file` | 8 |
| `promise/always-return` | 1 |
| `promise/avoid-new` | 3 |
| `promise/param-names` | 2 |
| `promise/prefer-await-to-callbacks` | 11 |
| `typescript/array-type` | 467 |
| `typescript/consistent-indexed-object-style` | 11 |
| `typescript/consistent-return` | 50 |
| `typescript/consistent-type-definitions` | 5 |
| `typescript/consistent-type-imports` | 20 |
| `typescript/dot-notation` | 32 |
| `typescript/method-signature-style` | 2 |
| `typescript/no-confusing-void-expression` | 17 |
| `typescript/no-deprecated` | 2 |
| `typescript/no-floating-promises` | 6 |
| `typescript/no-import-type-side-effects` | 2 |
| `typescript/no-inferrable-types` | 1 |
| `typescript/no-invalid-void-type` | 1 |
| `typescript/no-non-null-assertion` | 43 |
| `typescript/no-unnecessary-type-arguments` | 27 |
| `typescript/no-unnecessary-type-assertion` | 12 |
| `typescript/no-unnecessary-type-parameters` | 9 |
| `typescript/no-unsafe-argument` | 16 |
| `typescript/no-unsafe-assignment` | 49 |
| `typescript/no-unsafe-call` | 26 |
| `typescript/no-unsafe-enum-comparison` | 1 |
| `typescript/no-unsafe-member-access` | 133 |
| `typescript/no-unsafe-return` | 16 |
| `typescript/no-unsafe-type-assertion` | 125 |
| `typescript/parameter-properties` | 2 |
| `typescript/prefer-nullish-coalescing` | 4 |
| `typescript/prefer-promise-reject-errors` | 1 |
| `typescript/prefer-regexp-exec` | 1 |
| `typescript/promise-function-async` | 113 |
| `typescript/return-await` | 1 |
| `typescript/strict-boolean-expressions` | 40 |
| `typescript/strict-void-return` | 15 |
| `typescript/switch-exhaustiveness-check` | 4 |
| `typescript/use-unknown-in-catch-callback-variable` | 1 |
| `unicorn/catch-error-name` | 4 |
| `unicorn/consistent-function-scoping` | 66 |
| `unicorn/escape-case` | 8 |
| `unicorn/filename-case` | 165 |
| `unicorn/import-style` | 13 |
| `unicorn/new-for-builtins` | 4 |
| `unicorn/no-array-fill-with-reference-type` | 1 |
| `unicorn/no-array-for-each` | 23 |
| `unicorn/no-array-method-this-argument` | 48 |
| `unicorn/no-array-reduce` | 3 |
| `unicorn/no-array-reverse` | 8 |
| `unicorn/no-array-sort` | 52 |
| `unicorn/no-await-expression-member` | 140 |
| `unicorn/no-hex-escape` | 2 |
| `unicorn/no-lonely-if` | 3 |
| `unicorn/no-negated-condition` | 49 |
| `unicorn/no-object-as-default-parameter` | 3 |
| `unicorn/no-useless-fallback-in-spread` | 2 |
| `unicorn/no-useless-spread` | 3 |
| `unicorn/no-useless-undefined` | 9 |
| `unicorn/no-zero-fractions` | 12 |
| `unicorn/numeric-separators-style` | 129 |
| `unicorn/prefer-array-find` | 1 |
| `unicorn/prefer-at` | 6 |
| `unicorn/prefer-code-point` | 1 |
| `unicorn/prefer-dom-node-append` | 18 |
| `unicorn/prefer-dom-node-dataset` | 1 |
| `unicorn/prefer-import-meta-properties` | 4 |
| `unicorn/prefer-logical-operator-over-ternary` | 2 |
| `unicorn/prefer-number-coercion` | 29 |
| `unicorn/prefer-number-properties` | 30 |
| `unicorn/prefer-query-selector` | 20 |
| `unicorn/prefer-response-static-json` | 1 |
| `unicorn/prefer-set-has` | 1 |
| `unicorn/prefer-single-call` | 9 |
| `unicorn/prefer-spread` | 3 |
| `unicorn/prefer-string-replace-all` | 21 |
| `unicorn/prefer-structured-clone` | 2 |
| `unicorn/prefer-ternary` | 4 |
| `unicorn/relative-url-style` | 1 |
| `unicorn/require-module-specifiers` | 1 |
| `unicorn/switch-case-braces` | 289 |
| `unicorn/text-encoding-identifier-case` | 45 |
| `unicorn/throw-new-error` | 33 |

These are off, not deleted: `restyleExceptionsOff` is the single list, so the next pass can see exactly what is owed and what each rule costs.
