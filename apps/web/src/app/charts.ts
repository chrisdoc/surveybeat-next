import type { Html, HtmlBuilder } from "foldkit/html";

/** One point on a line chart. `x` runs 0..1 along the plot; `joinsPrevious` draws the segment from the point before. */
export interface ChartPoint {
  readonly x: number;
  readonly score: number | null;
  readonly joinsPrevious: boolean;
}

export interface LineChartOptions {
  readonly points: ReadonlyArray<ChartPoint>;
  readonly ariaLabel: string;
  /** viewBox width; the height is fixed at 120. */
  readonly width?: number;
  readonly dotRadius?: number;
  /** Draws the last dot in brass. */
  readonly highlightLast?: boolean;
  /** x positions 0..1 of faint vertical marker lines. */
  readonly guides?: ReadonlyArray<number>;
  readonly className?: string;
}

const HEIGHT = 120;
const MIN_SCORE = 1;
const MAX_SCORE = 5;

export const CHART_PAD = { left: 24, right: 16, top: 16, bottom: 24 } as const;

/** Left offset of x (0..1) as a CSS percentage of the chart width, so HTML overlays line up with the plot. */
export const plotPercent = (x: number, width = 360): string => {
  const chartWidth = width - CHART_PAD.left - CHART_PAD.right;
  return `${((CHART_PAD.left + x * chartWidth) / width) * 100}%`;
};

/** Hand-built SVG line chart. A null score is a gap: the line breaks and no dot is drawn. */
export const lineChart = <Message>(options: LineChartOptions, h: HtmlBuilder<Message>): Html => {
  const width = options.width ?? 360;
  const dotRadius = options.dotRadius ?? 4;
  const chartWidth = width - CHART_PAD.left - CHART_PAD.right;
  const chartHeight = HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
  const { points } = options;

  const getX = (x: number) => CHART_PAD.left + x * chartWidth;
  const getY = (score: number) => {
    const norm = (score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
    return CHART_PAD.top + (1 - norm) * chartHeight;
  };

  const svgChildren: Array<Html> = [];

  // Horizontal guide lines at 1.0, 3.0, 5.0
  for (const s of [1, 3, 5]) {
    const y = getY(s);
    svgChildren.push(
      h.line([
        h.X1(String(CHART_PAD.left)),
        h.Y1(String(y)),
        h.X2(String(width - CHART_PAD.right)),
        h.Y2(String(y)),
        h.Class("stroke-line"),
      ]),
    );
  }

  // Vertical marker guides
  for (const x of options.guides ?? []) {
    svgChildren.push(
      h.line([
        h.X1(String(getX(x))),
        h.Y1(String(CHART_PAD.top)),
        h.X2(String(getX(x))),
        h.Y2(String(HEIGHT - CHART_PAD.bottom)),
        h.Class("stroke-brass"),
        h.StrokeDasharray("2 3"),
        h.AriaHidden(true),
      ]),
    );
  }

  // Draw lines between consecutive non-gap points
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1]!;
    const p2 = points[i]!;
    if (p1.score !== null && p2.score !== null && p2.joinsPrevious) {
      svgChildren.push(
        h.line([
          h.X1(String(getX(p1.x))),
          h.Y1(String(getY(p1.score))),
          h.X2(String(getX(p2.x))),
          h.Y2(String(getY(p2.score))),
          h.Class("stroke-primary"),
          h.StrokeWidth("2"),
        ]),
      );
    }
  }

  // Draw dot markers
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.score !== null) {
      svgChildren.push(
        h.circle([
          h.Cx(String(getX(p.x))),
          h.Cy(String(getY(p.score))),
          h.R(String(dotRadius)),
          h.Class(options.highlightLast === true && i === points.length - 1 ? "fill-brass" : "fill-primary"),
        ]),
      );
    }
  }

  return h.svg(
    [
      h.ViewBox(`0 0 ${width} ${HEIGHT}`),
      h.Class(options.className ?? "h-32 w-full max-w-sm overflow-hidden"),
      h.Role("img"),
      h.AriaLabel(options.ariaLabel),
    ],
    svgChildren,
  );
};
