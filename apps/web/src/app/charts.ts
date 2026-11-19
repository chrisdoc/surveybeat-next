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
  readonly points: readonly ChartPoint[];
  readonly ariaLabel: string;

  readonly width?: number;
  readonly dotRadius?: number;

  readonly highlightLast?: boolean;

  readonly guides?: readonly number[];

  readonly xTicks?: readonly ChartTick[];

  readonly latestLabel?: string;
  readonly className?: string;

  readonly fillWidth?: boolean;
}

const HEIGHT = 120;
const MIN_SCORE = 1;
const MAX_SCORE = 5;
const LABEL_SIZE = "9";
const LABEL_CLASS = "fill-muted";
const OVERLAY_LABEL_CLASS = "absolute leading-none text-muted text-[9px] whitespace-nowrap";

export const CHART_PAD = { left: 24, right: 16, top: 16, bottom: 24 } as const;

const scoreY = (score: number): number => {
  const norm = (score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
  return CHART_PAD.top + (1 - norm) * (HEIGHT - CHART_PAD.top - CHART_PAD.bottom);
};

export const plotPercent = (x: number, width = 360): string => {
  const chartWidth = width - CHART_PAD.left - CHART_PAD.right;
  return `${((CHART_PAD.left + x * chartWidth) / width) * 100}%`;
};

export const plotYPercent = (score: number): string => `${(scoreY(score) / HEIGHT) * 100}%`;

export const lineChart = <Message>(options: LineChartOptions, h: HtmlBuilder<Message>): Html => {
  const width = options.width ?? 360;
  const dotRadius = options.dotRadius ?? 4;
  const fillWidth = options.fillWidth === true;
  const chartWidth = width - CHART_PAD.left - CHART_PAD.right;
  const { points } = options;

  const getX = (x: number) => CHART_PAD.left + x * chartWidth;
  const getY = scoreY;
  const strokeEffect = fillWidth ? " [vector-effect:non-scaling-stroke]" : "";

  const svgChildren: Html[] = [];
  const overlayChildren: Html[] = [];

  for (const s of [1, 3, 5]) {
    const y = getY(s);
    svgChildren.push(
      h.line([
        h.X1(String(CHART_PAD.left)),
        h.Y1(String(y)),
        h.X2(String(width - CHART_PAD.right)),
        h.Y2(String(y)),
        h.Class(`stroke-line${strokeEffect}`),
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
        h.Class(`stroke-brass${strokeEffect}`),
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
          h.Class(`stroke-primary${strokeEffect}`),
          h.StrokeWidth("2"),
        ]),
      );
    }
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.score !== null) {
      const isBrass = options.highlightLast === true && i === points.length - 1;
      if (fillWidth) {
        const size = `${dotRadius * 2}px`;
        overlayChildren.push(
          h.span([
            h.Class(
              `absolute block -translate-x-1/2 -translate-y-1/2 rounded-full ${isBrass ? "bg-brass" : "bg-primary"}`,
            ),
            h.Style({ left: plotPercent(p.x, width), top: plotYPercent(p.score), width: size, height: size }),
          ]),
        );
      } else {
        svgChildren.push(
          h.circle([
            h.Cx(String(getX(p.x))),
            h.Cy(String(getY(p.score))),
            h.R(String(dotRadius)),
            h.Class(isBrass ? "fill-brass" : "fill-primary"),
          ]),
        );
      }
    }
  }

  for (const s of [1, 3, 5]) {
    if (fillWidth) {
      overlayChildren.push(
        h.span(
          [
            h.Class(`${OVERLAY_LABEL_CLASS} -translate-x-full -translate-y-1/2`),
            h.Style({ left: `${((CHART_PAD.left - 5) / width) * 100}%`, top: plotYPercent(s) }),
          ],
          [String(s)],
        ),
      );
    } else {
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
  }

  for (const tick of options.xTicks ?? []) {
    if (fillWidth) {
      const anchor = tick.x <= 0 ? "" : tick.x >= 1 ? " -translate-x-full" : " -translate-x-1/2";
      overlayChildren.push(
        h.span(
          [
            h.Class(`${OVERLAY_LABEL_CLASS} -translate-y-full${anchor}`),
            h.Style({ left: plotPercent(tick.x, width), top: `${((HEIGHT - 6) / HEIGHT) * 100}%` }),
          ],
          [tick.label],
        ),
      );
    } else {
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
  }

  let lastPoint: ChartPoint | undefined;
  for (const p of points) {
    if (p.score !== null) {
      lastPoint = p;
    }
  }
  if (options.latestLabel !== undefined && lastPoint !== undefined && lastPoint.score !== null) {
    const nearEnd = lastPoint.x > 0.85;
    if (fillWidth) {
      const offset = nearEnd ? -6 : 6;
      overlayChildren.push(
        h.span(
          [
            h.Class(`${OVERLAY_LABEL_CLASS} -translate-y-full${nearEnd ? " -translate-x-full" : ""}`),
            h.Style({
              left: `calc(${plotPercent(lastPoint.x, width)} + ${offset}px)`,
              top: `calc(${plotYPercent(lastPoint.score)} - 6px)`,
            }),
          ],
          [options.latestLabel],
        ),
      );
    } else {
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
  }

  if (fillWidth) {
    return h.div(
      [h.Class("relative w-full")],
      [
        h.svg(
          [
            h.ViewBox(`0 0 ${width} ${HEIGHT}`),
            h.PreserveAspectRatio("none"),
            h.Class("block h-32 w-full"),
            h.Role("img"),
            h.AriaLabel(options.ariaLabel),
          ],
          svgChildren,
        ),
        h.div([h.AriaHidden(true), h.Class("pointer-events-none absolute inset-0")], overlayChildren),
      ],
    );
  }

  return h.svg(
    [
      h.ViewBox(`0 0 ${width} ${HEIGHT}`),
      h.Class(options.className ?? "h-32 w-full overflow-hidden"),
      h.Role("img"),
      h.AriaLabel(options.ariaLabel),
    ],
    svgChildren,
  );
};
