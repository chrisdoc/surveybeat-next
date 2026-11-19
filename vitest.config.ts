import { defineConfig } from "vitest/config";

process.env["TZ"] = "UTC";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["{packages,apps,tools,infra,scripts}/**/*.test.ts"],
          exclude: ["**/*.privacy.test.ts", "**/node_modules/**", "**/dist/**", "tools/oxlint/fixtures/**"],
        },
      },
      {
        test: {
          name: "privacy",
          include: ["{packages,apps,tools,infra}/**/*.privacy.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
