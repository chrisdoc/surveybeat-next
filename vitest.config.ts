import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["{packages,apps,tools}/**/*.test.ts"],
          exclude: ["**/*.privacy.test.ts", "**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "privacy",
          include: ["{packages,apps,tools}/**/*.privacy.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
