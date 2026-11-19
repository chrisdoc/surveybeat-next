import { RoundId, type TrendPoint } from "@surveybeat/domain";
import { Schema } from "effect";
import { type Html, inertHtml } from "foldkit/html";
import { describe, expect, it } from "vitest";
import { CHART_PAD, type ChartPoint, lineChart, plotPercent, plotYPercent } from "./charts.ts";
import { distributionChart, trendChart } from "./results.ts";

/** The slice of a foldkit VNode these tests read: element name, classes, attributes and children. */
interface Tree {
  readonly sel?: string | undefined;
  readonly data?:
    | {
        readonly class?: Readonly<Record<string, boolean>>;
        readonly attrs?: Readonly<Record<string, unknown>>;
        readonly style?: Readonly<Record<string, string>>;
      }
    | undefined;
  readonly children?: ReadonlyArray<Tree | string> | undefined;
}

const asTree = (html: Html): Tree => html as Tree;

const descendants = (tree: Tree): Array<Tree> =>
  (tree.children ?? []).flatMap((child) => (typeof child === "string" ? [] : [child, ...descendants(child)]));

const elements = (tree: Tree, sel: string): Array<Tree> =>
  descendants(tree).filter((node) => node.sel === sel);

const hasClass = (node: Tree, name: string): boolean => Object.hasOwn(node.data?.class ?? {}, name);

const attr = (node: Tree, name: string): string => String(node.data?.attrs?.[name]);

const point = (x: number, score: number | null, joinsPrevious = true): ChartPoint => ({
  x,
  score,
  joinsPrevious,
});

const render = (points: ReadonlyArray<ChartPoint>, extra: Partial<Parameters<typeof lineChart>[0]> = {}) =>
  asTree(lineChart({ points, ariaLabel: "test chart", ...extra }, inertHtml));

/** Every string a subtree renders, so a count label can be found by its text. */
const textsOf = (tree: Tree): Array<string> => {
  const parts: Array<string> = [];
  const walk = (child: Tree | string): void => {
    if (typeof child === "string") {
      parts.push(child);
      return;
    }
    const inner = (child as { text?: string }).text;
    if (inner !== undefined) parts.push(inner);
    for (const grandchild of child.children ?? []) walk(grandchild);
  };
  walk(tree);
  return parts;
};

/** Data segments are the `stroke-primary` lines; horizontal guides are `stroke-line`, vertical guides `stroke-brass`. */
const segments = (tree: Tree): Array<Tree> =>
  elements(tree, "line").filter((node) => hasClass(node, "stroke-primary"));

describe("lineChart", () => {
  const scores = [point(0, 3), point(1 / 3, null), point(2 / 3, 4), point(1, 5)];

  it("draws one dot per non-null score", () => {
    const tree = render(scores);
    expect(elements(tree, "circle")).toHaveLength(3);
  });

  it("draws a segment only between two non-null scores whose later point joins the previous one", () => {
    const tree = render(scores);
    const lines = segments(tree);
    expect(lines).toHaveLength(1);
    expect(attr(lines[0]!, "x1")).toBe(String(CHART_PAD.left + (2 / 3) * 320));
    expect(attr(lines[0]!, "x2")).toBe(String(CHART_PAD.left + 320));
  });

  it("removes the incoming segment of a point that does not join its predecessor", () => {
    const joined = render([point(0, 3), point(0.5, 4), point(1, 5)]);
    expect(segments(joined)).toHaveLength(2);

    const broken = render([point(0, 3), point(0.5, 4), point(1, 5, false)]);
    const lines = segments(broken);
    expect(lines).toHaveLength(1);
    // The surviving segment is 3 to 4; the 4 to 5 segment into the broken point is gone.
    expect(attr(lines[0]!, "x2")).toBe(String(CHART_PAD.left + 0.5 * 320));
  });

  it("colours only the last dot brass when highlightLast is set", () => {
    const plain = render([point(0, 3), point(0.5, 4), point(1, 5)]);
    expect(elements(plain, "circle").some((dot) => hasClass(dot, "fill-brass"))).toBe(false);

    const highlighted = render([point(0, 3), point(0.5, 4), point(1, 5)], { highlightLast: true });
    const dots = elements(highlighted, "circle");
    expect(dots.map((dot) => hasClass(dot, "fill-brass"))).toEqual([false, false, true]);
  });

  it("draws one dashed brass guide per guide x, and no dots for gaps", () => {
    const tree = render([point(0, 3), point(0.5, null), point(1, 5)], { guides: [0.25, 0.75] });
    const guides = elements(tree, "line").filter((node) => hasClass(node, "stroke-brass"));
    expect(guides).toHaveLength(2);
    expect(guides.every((guide) => attr(guide, "stroke-dasharray") === "2 3")).toBe(true);
    expect(elements(tree, "circle")).toHaveLength(2);
  });

  /** A text element's label: foldkit wraps the string child in a text vnode, which carries `text`. */
  const textOf = (node: Tree): string => {
    const parts: Array<string> = [];
    const walk = (child: Tree | string): void => {
      if (typeof child === "string") {
        parts.push(child);
        return;
      }
      const inner = (child as { text?: string }).text;
      if (inner !== undefined) parts.push(inner);
      for (const grandchild of child.children ?? []) walk(grandchild);
    };
    for (const child of node.children ?? []) walk(child);
    return parts.join("");
  };

  const labelsOf = (tree: Tree): Array<string> => elements(tree, "text").map(textOf);

  it("names the 1–5 scale at 1, 3 and 5", () => {
    expect(labelsOf(render(scores)).slice(0, 3)).toEqual(["1", "3", "5"]);
  });

  it("writes date labels under the first and last Round and the latest value beside its dot", () => {
    const tree = render([point(0, 3), point(0.5, null), point(1, 4.2)], {
      xTicks: [
        { x: 0, label: "26.10.2026" },
        { x: 1, label: "09.11.2026" },
      ],
      latestLabel: "4.2",
    });
    const labels = labelsOf(tree);
    expect(labels).toContain("26.10.2026");
    expect(labels).toContain("09.11.2026");
    expect(labels).toContain("4.2");
  });

  it("writes no latest value when every Round was a gap", () => {
    const tree = render([point(0, null), point(1, null)], { latestLabel: "4.2" });
    expect(labelsOf(tree)).not.toContain("4.2");
  });

  it("sets the viewBox and the accessible label", () => {
    const tree = render(scores, { width: 720 });
    expect(attr(tree, "viewBox")).toBe("0 0 720 120");
    expect(attr(tree, "aria-label")).toBe("test chart");
  });
});

describe("plotPercent", () => {
  it("places x=0 at the left padding, x=1 at the right padding, and x=0.5 at the middle", () => {
    const width = 720;
    const plotWidth = width - CHART_PAD.left - CHART_PAD.right;
    const percentAt = (x: number) => ((CHART_PAD.left + x * plotWidth) / width) * 100;
    expect(parseFloat(plotPercent(0, width))).toBeCloseTo(percentAt(0), 10);
    expect(parseFloat(plotPercent(1, width))).toBeCloseTo(percentAt(1), 10);
    expect(parseFloat(plotPercent(0.5, width))).toBeCloseTo(percentAt(0.5), 10);
    expect(parseFloat(plotPercent(0, width))).toBeCloseTo((24 / 720) * 100, 10);
    expect(parseFloat(plotPercent(1, width))).toBeCloseTo((704 / 720) * 100, 10);
    expect(plotPercent(0.5, 720).endsWith("%")).toBe(true);
  });
});

describe("trendChart", () => {
  const roundPoint = (score: number | null, hasGap: boolean): TrendPoint => ({
    roundId: Schema.decodeSync(RoundId)("r"),
    plannedOpenDate: "2026-11-09",
    score,
    contributors: 5,
    hasGap,
  });

  const points = [roundPoint(3, false), roundPoint(4, true), roundPoint(5, false)];
  const svgOf = (tree: Tree): Tree => elements(tree, "svg")[0]!;
  const overlayOf = (tree: Tree): Tree => elements(tree, "div").find((node) => hasClass(node, "absolute"))!;
  const dotsOf = (tree: Tree): Array<Tree> =>
    elements(tree, "span").filter((node) => hasClass(node, "rounded-full"));

  it("stretches to the container width at a fixed height, with no max-width cap", () => {
    const svg = svgOf(asTree(trendChart(points, inertHtml, true)));
    expect(attr(svg, "preserveAspectRatio")).toBe("none");
    expect(hasClass(svg, "h-32")).toBe(true);
    expect(hasClass(svg, "w-full")).toBe(true);
    expect(Object.keys(svg.data?.class ?? {}).some((name) => name.startsWith("max-w-"))).toBe(false);
  });

  it("keeps strokes at their designed width under the stretch", () => {
    const tree = asTree(trendChart(points, inertHtml, true));
    const lines = segments(tree);
    expect(lines).toHaveLength(1);
    expect(hasClass(lines[0]!, "[vector-effect:non-scaling-stroke]")).toBe(true);
  });

  it("draws one segment that skips the gap, and no SVG dots or text", () => {
    const tree = asTree(trendChart(points, inertHtml, true));
    expect(segments(tree)).toHaveLength(1);
    expect(elements(svgOf(tree), "circle")).toHaveLength(0);
    expect(elements(svgOf(tree), "text")).toHaveLength(0);
  });

  it("places an HTML dot per score at its percentage position, the last one brass when unusual", () => {
    const tree = asTree(trendChart(points, inertHtml, true));
    const dots = dotsOf(tree);
    expect(dots).toHaveLength(3);
    expect(dots[0]!.data?.style?.left).toBe(plotPercent(0));
    expect(dots[0]!.data?.style?.top).toBe(plotYPercent(3));
    expect(dots[2]!.data?.style?.left).toBe(plotPercent(1));
    expect(hasClass(dots[0]!, "bg-primary")).toBe(true);
    expect(hasClass(dots[2]!, "bg-brass")).toBe(true);
    expect(dots[0]!.data?.style?.width).toBe(`${4 * 2}px`);
  });

  it("writes the date labels and the latest value as HTML text in an aria-hidden overlay", () => {
    const tree = asTree(trendChart([roundPoint(3, false), roundPoint(4.2, false)], inertHtml, false));
    const overlay = overlayOf(tree);
    expect(attr(overlay, "aria-hidden")).toBe("true");
    const labels = textsOf(overlay);
    expect(labels).toEqual(expect.arrayContaining(["1", "3", "5", "4.2"]));
    // Scale (3), two date ticks and the latest value.
    expect(labels).toHaveLength(6);
    expect(attr(svgOf(tree), "aria-label")).toBe("2-Round trend");
  });
});

describe("distributionChart", () => {
  const option = (label: string, count: number) => ({ option: label, count });

  const bars = (tree: Tree): Array<Tree> =>
    elements(tree, "div").filter((node) => hasClass(node, "bg-primary"));

  it("draws no bar for an option with zero answers, but still shows its count", () => {
    const tree = asTree(distributionChart([option("Yes", 0), option("No", 4)], inertHtml));

    const drawn = bars(tree);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.data?.style?.width).toBe("100%");
    expect(textsOf(tree)).toContain("0");
    expect(textsOf(tree)).toContain("4");
  });

  it("fills the panel width with no max-width cap", () => {
    const tree = asTree(distributionChart([option("Yes", 2)], inertHtml));
    expect(hasClass(tree, "w-full")).toBe(true);
    expect(Object.keys(tree.data?.class ?? {}).some((name) => name.startsWith("max-w-"))).toBe(false);
  });
});
