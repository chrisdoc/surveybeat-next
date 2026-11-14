import type { Html, HtmlBuilder } from "foldkit/html";

export interface ChartPoint {
  readonly x: number;
  readonly score: number | null;
  readonly joinsPrevious: boolean;
}

export interface ChartTick {
  readonly x: number;
  readonly label: string;
}

export interface LineChartOptions {
  readonly points: ReadonlyArray<ChartPoint>;
  readonly ariaLabel: string;

  readonly width?: number;
  readonly dotRadius?: number;

  readonly highlightLast?: boolean;

  readonly guides?: ReadonlyArray<number>;

  readonly xTicks?: ReadonlyArray<ChartTick>;

  readonly latestLabel?: string;
  readonly className?: string;
}

const HEIGHT = 120;
const MIN_SCORE = 1;
const MAX_SCORE = 5;
const LABEL_SIZE = "9";
const LABEL_CLASS = "fill-muted";

export const CHART_PAD = { left: 24, right: 16, top: 16, bottom: 24 } as const;

export const plotPercent = (x: number, width = 360): string => {
  const chartWidth = width - CHART_PAD.left - CHART_PAD.right;
  return `${((CHART_PAD.left + x * chartWidth) / width) * 100}%`;
};

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

  for (const s of [1, 3, 5]) {
    svgChildren.push(
      h.text(
        [
          h.X(String(CHART_PAD.left - 5)),
          h.Y(String(getY(s) + 3)),
          h.TextAnchor("end"),
          h.FontSize(LABEL_SIZE),
          h.Class(LABEL_CLASS),
        ],
        [String(s)],
      ),
    );
  }

  for (const tick of options.xTicks ?? []) {
    svgChildren.push(
      h.text(
        [
          h.X(String(getX(tick.x))),
          h.Y(String(HEIGHT - 6)),
          h.TextAnchor(tick.x <= 0 ? "start" : tick.x >= 1 ? "end" : "middle"),
          h.FontSize(LABEL_SIZE),
          h.Class(LABEL_CLASS),
        ],
        [tick.label],
      ),
    );
  }

  let lastPoint: ChartPoint | undefined;
  for (const p of points) {
    if (p.score !== null) lastPoint = p;
  }
  if (options.latestLabel !== undefined && lastPoint !== undefined && lastPoint.score !== null) {
    const nearEnd = lastPoint.x > 0.85;
    svgChildren.push(
      h.text(
        [
          h.X(String(getX(lastPoint.x) + (nearEnd ? -6 : 6))),
          h.Y(String(getY(lastPoint.score) - 6)),
          h.TextAnchor(nearEnd ? "end" : "start"),
          h.FontSize(LABEL_SIZE),
          h.Class(LABEL_CLASS),
        ],
        [options.latestLabel],
      ),
    );
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
