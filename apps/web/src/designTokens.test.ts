import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";

/**
 * The design tokens live once in the app's Tailwind theme (`app/app.css`). The answer page cannot
 * load that stylesheet (ADR 0008 budget) and emails cannot use CSS variables, so both repeat the
 * values. These tests fail when a copy drifts from the theme.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const declarations = (css: string, prefix: string): Map<string, string> =>
  new Map(
    Array.from(css.matchAll(new RegExp(`--${prefix}([a-z0-9-]+):\\s*([^;]+);`, "g")), (m) => [
      m[1] ?? "",
      (m[2] ?? "").trim().toLowerCase(),
    ]),
  );

const darkBlock = (css: string): string => {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  assert.isAbove(start, -1, "dark block present");
  const open = css.indexOf("{", css.indexOf(":root", start));
  return css.slice(open, css.indexOf("}", open));
};

const theme = read("./app/app.css");
const lightTheme = theme.slice(0, theme.indexOf("@media (prefers-color-scheme: dark)"));
const themeColors = declarations(lightTheme, "color-");
const themeRadii = declarations(theme, "radius-");

describe("design tokens", () => {
  it("the answer page uses the theme's values", () => {
    const answer = declarations(read("./answer/style.css").split("}")[0] ?? "", "");
    assert.isAbove(answer.size, 0);
    for (const [name, value] of answer) {
      const expected = name.startsWith("radius-")
        ? themeRadii.get(name.slice("radius-".length))
        : themeColors.get(name);
      assert.strictEqual(value, expected, `--${name} in answer/style.css`);
    }
  });

  it("on-primary exists in both schemes", () => {
    assert.isTrue(themeColors.has("on-primary"));
    assert.isTrue(declarations(darkBlock(theme), "color-").has("on-primary"));
  });

  it("the answer page's dark block matches the app's dark block", () => {
    const answer = declarations(darkBlock(read("./answer/style.css")), "");
    const app = declarations(darkBlock(theme), "color-");
    assert.isAbove(answer.size, 0);
    for (const [name, value] of answer) {
      assert.strictEqual(value, app.get(name), `--${name} dark in answer/style.css`);
    }
  });

  it("emails use the theme's light values", () => {
    const source = read("../../../packages/emails/src/theme.ts");
    const block = source.slice(
      source.indexOf("export const colors"),
      source.indexOf("export const darkColors"),
    );
    const email = new Map(
      Array.from(block.matchAll(/(\w+): "(#[0-9A-Fa-f]{6})"/g), (m) => [
        m[1] ?? "",
        (m[2] ?? "").toLowerCase(),
      ]),
    );
    const sameAs: Record<string, string> = {
      page: "stone",
      card: "surface",
      border: "line",
      rowBorder: "line-soft",
      text: "ink",
      muted: "muted",
      accent: "primary",
      button: "evergreen",
      panel: "evergreen",
      mint: "mint",
    };
    for (const [key, token] of Object.entries(sameAs)) {
      assert.strictEqual(email.get(key), themeColors.get(token), `colors.${key} in emails/theme.ts`);
    }
  });
});
