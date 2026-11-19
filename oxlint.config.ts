import foldkitRecommended from "@foldkit/oxlint-plugin/recommended.json" with { type: "json" };
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import landmines from "ultracite/oxlint/landmines";

const restyleExceptionsOff = {
  "anti-slop-effect/no-manual-tag-comparison": "off",
  "anti-slop-effect/no-manual-tagged-construction": "off",
  "anti-slop-effect/no-service-constructor-imports": "off",
  "anti-slop-effect/prefer-effect-match": "off",
  "anti-slop/no-chained-type-assertions": "off",
  "anti-slop/no-conditional-empty-object-spread": "off",
  "anti-slop/no-known-value-widening": "off",
  "anti-slop/no-runtime-typeof": "off",
  "anti-slop/no-shape-in-symbol-names": "off",
  "anti-slop/no-unknown-parameters": "off",
  "anti-slop/no-unknown-returns": "off",
  "anti-slop/no-unsafe-dictionary-type": "off",
  "anti-slop/require-safety-comment-for-type-assertion": "off",
  "eslint/array-callback-return": "off",
  "eslint/complexity": "off",
  "eslint/default-case": "off",
  "eslint/func-names": "off",
  "eslint/func-style": "off",
  "eslint/max-classes-per-file": "off",
  "eslint/no-await-in-loop": "off",
  "eslint/no-bitwise": "off",
  "eslint/no-empty": "off",
  "eslint/no-inline-comments": "off",
  "eslint/no-negated-condition": "off",
  "eslint/no-nested-ternary": "off",
  "eslint/no-plusplus": "off",
  "eslint/no-redeclare": "off",
  "eslint/no-shadow": "off",
  "eslint/prefer-destructuring": "off",
  "eslint/prefer-named-capture-group": "off",
  "eslint/require-unicode-regexp": "off",
  "foldkit/got-prefix-requires-submodel-payload": "off",
  "foldkit/got-wrapper-carries-only-routing": "off",
  "foldkit/keyed-required-for-mapped-rows": "off",
  "foldkit/no-child-message-construction-in-root": "off",
  "foldkit/no-module-level-mutable-state": "off",
  "foldkit/no-switch-on-message-tag": "off",
  "foldkit/prefer-option-over-nullable-in-model": "off",
  "import/no-mutable-exports": "off",
  "jsdoc/require-param-description": "off",
  "jsdoc/require-returns-description": "off",
  "oxc/no-accumulating-spread": "off",
  "oxc/no-barrel-file": "off",
  "promise/avoid-new": "off",
  "promise/param-names": "off",
  "promise/prefer-await-to-callbacks": "off",
  "typescript/consistent-type-definitions": "off",
  "typescript/no-non-null-assertion": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/filename-case": "off",
  "unicorn/import-style": "off",
  "unicorn/no-array-for-each": "off",
  "unicorn/no-array-method-this-argument": "off",
  "unicorn/no-array-reduce": "off",
  "unicorn/no-array-sort": "off",
  "unicorn/no-await-expression-member": "off",
  "unicorn/no-negated-condition": "off",
  "unicorn/no-useless-undefined": "off",
  "unicorn/prefer-number-coercion": "off",
  "unicorn/prefer-query-selector": "off",
  "unicorn/prefer-single-call": "off",
  "unicorn/prefer-structured-clone": "off",
  "unicorn/prefer-ternary": "off",
  "unicorn/text-encoding-identifier-case": "off",
  "unicorn/throw-new-error": "off",
  "landmines-types/no-explicit-return-types": "off",
  "typescript/no-unnecessary-type-parameters": "off",
  "typescript/no-unsafe-return": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-confusing-void-expression": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/promise-function-async": "off",
  "typescript/consistent-return": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/strict-boolean-expressions": "off",
  "typescript/strict-void-return": "off",
  "typescript/switch-exhaustiveness-check": "off",
  "typescript/no-unsafe-argument": "off",
  "typescript/no-unsafe-call": "off",
};

const foldkitScope = (pattern: string) => `apps/web/src/${pattern}`;

const foldkitSeverity = ([rule, severity]: readonly [string, string]) => {
  if (severity === "error" || severity === "off") {
    return [rule, severity] as const;
  }

  throw new Error(
    `@foldkit/oxlint-plugin/recommended.json sets ${rule} to ${
      severity
    }. Map that severity in oxlint.config.ts before bumping the plugin.`,
  );
};

const foldkitRules = (rules: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(rules)
      .filter(([rule]) => !(rule in restyleExceptionsOff))
      .map(foldkitSeverity),
  );

const foldkitOverrides = [
  {
    files: [foldkitScope("**/*.ts")],
    excludeFiles: [foldkitScope("answer/**")],
    rules: foldkitRules(foldkitRecommended.rules),
  },
  ...foldkitRecommended.overrides.map(({ excludeFiles, files, rules }) => ({
    excludeFiles: excludeFiles?.map(foldkitScope),
    files: files.map(foldkitScope),
    rules: foldkitRules(rules),
  })),
];

const surveyedRules = {
  "surveybeat/domain-boundary": "error",
  "surveybeat/privacy-query": "error",
};

const pluginRules = {
  "anti-slop-effect/no-manual-effect-error-tag": "error",
  "anti-slop-effect/no-manual-tag-comparison": "error",
  "anti-slop-effect/no-manual-tagged-construction": "error",
  "anti-slop-effect/no-service-constructor-imports": "error",
  "anti-slop-effect/prefer-effect-match": "error",
  "anti-slop/no-array-filter-map": "error",
  "anti-slop/no-chained-type-assertions": "error",
  "anti-slop/no-conditional-empty-object-spread": "error",
  "anti-slop/no-known-value-widening": "error",
  "anti-slop/no-module-mocking": "error",
  "anti-slop/no-object-parameters": "error",
  "anti-slop/no-reduce-accumulator-copy": "error",
  "anti-slop/no-reflect-apply": "error",
  "anti-slop/no-reflect-get": "error",
  "anti-slop/no-runtime-typeof": "error",
  "anti-slop/no-shape-in-symbol-names": "error",
  "anti-slop/no-unknown-parameters": "error",
  "anti-slop/no-unknown-returns": "error",
  "anti-slop/no-unknown-type-aliases": "error",
  "anti-slop/no-unsafe-dictionary-type": "error",
  "anti-slop/no-widen-then-assert": "error",
  "anti-slop/require-readable-spacing": "error",
  "anti-slop/require-safety-comment-for-type-assertion": "error",
  "effect-tests/no-manual-effect-runtime-in-tests": "error",
  "landmines-testing/no-flake-masking": [
    "error",
    {
      allow: {
        "packages/cloudflare/src/Email.test.ts": 1,
        "packages/cloudflare/src/Organization.test.ts": 5,
      },
    },
  ],
  "patterns/acquire-release-constructs-in-acquire-body": "error",
  "patterns/no-module-level-mutable-state": "error",
  "patterns/no-shared-pending-cache": "error",
  "patterns/no-sleep-in-loop": "error",
  "patterns/shared-waiters": "error",
  "xstate-effect/no-inline-effect": "error",
};

export default defineConfig({
  extends: [core, landmines],
  ignorePatterns: [
    "**/dist/**",
    "**/dist-types/**",
    "**/node_modules/**",
    ".alchemy/**",
    "infra/tests/**",
    "tools/oxlint-plugin-surveybeat/fixtures/**",
    "tools/oxlint/fixtures/**",
    "tools/oxlint/anti-slop/**",
    ".agents/**",
    ".claude/**",
    ".cursor/**",
    ".pi/**",
    ".entire/**",
    ".factory/**",
    ".opencode/**",
  ],
  jsPlugins: [
    "./tools/oxlint-plugin-surveybeat/index.js",
    "./tools/oxlint-plugin-surveybeat/no-comments.js",
    { name: "foldkit", specifier: "@foldkit/oxlint-plugin" },
    { name: "xstate-effect", specifier: "@xstate/effect/oxlint" },
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
    "./tools/oxlint/effect-tests.ts",
    "./tools/oxlint/patterns.ts",
    ...landmines.jsPlugins,
  ],
  options: { typeAware: true },
  overrides: [
    ...foldkitOverrides,
    {
      files: ["apps/web/src/**/*.{ts,tsx}", "packages/emails/src/**/*.tsx"],
      excludeFiles: ["**/*.test.ts", "apps/web/src/messages/**"],
      rules: { "surveybeat/no-literal-ui-text": "error" },
    },
    {
      files: ["apps/web/src/messages/**"],
      rules: { "patterns/no-module-level-mutable-state": "off" },
    },
    {
      files: ["**/*.test.ts", "infra/tests/**"],
      rules: {
        "typescript/consistent-type-assertions": "off",
        "surveybeat/privacy-query": "off",
        "no-comments/no-comments": "off",
        "no-comments/directive-reason": "off",
      },
    },
  ],
  rules: {
    ...surveyedRules,
    ...pluginRules,
    ...restyleExceptionsOff,
    "no-comments/no-comments": "error",
    "no-comments/directive-reason": "error",
    "landmines-style/no-comments": "off",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-explicit-any": "error",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    "typescript/no-invalid-void-type": "error",
  },
});
