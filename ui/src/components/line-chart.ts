import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { scaleTime, scaleLinear } from "d3-scale";
import { line, area } from "d3-shape";
import type { ChartPoint, ChartSeries } from "../types.js";
import { formatClock, formatTick } from "../format.js";

export type YFormat = "ms" | "req/s" | "%" | "count";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 52 };

/**
 * Pure-SVG time-series chart (no charting library):
 * - path line + optional area fill per series
 * - horizontal grid, 4-6 y ticks, 5-8 x ticks
 * - crosshair + tooltip on hover (binary search on the time axis)
 * - drag-to-zoom on the plot area, emitting a `zoom` event
 *
 * Series colors come from `--chart-line-N` CSS custom properties via CSS
 * classes, so a theme toggle re-colors rendered paths without re-rendering.
 */
@customElement("broadside-line-chart")
export class LineChart extends LitElement {
  @property({ type: Array }) series: ChartSeries[] = [];
  @property() yFormat: YFormat = "ms";
  @property() yLabel = "";
  @property({ type: Number }) height = 220;
  @property({ type: Boolean }) showGrid = true;
  @property({ type: Boolean }) showDots = false;
  @property({ type: Boolean }) showLegend = true;
  @property({ type: Boolean }) fill = false;
  /** Explicit x domain (set when zoomed). Null = auto from data. */
  @property({ type: Array }) domain: [number, number] | null = null;

  @state() private width = 0;
  @state() private hoverTime: number | null = null;
  @state() private brush: { x0: number; x1: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private dragStart: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) this.width = Math.floor(rect.width);
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  override firstUpdated() {
    const container = this.renderRoot.querySelector(".wrap");
    if (container && this.resizeObserver) {
      this.resizeObserver.observe(container);
    }
  }

  // ─── Scales / geometry ───

  private get plotWidth() {
    return Math.max(0, this.width - MARGIN.left - MARGIN.right);
  }

  private get plotHeight() {
    return Math.max(0, this.height - MARGIN.top - MARGIN.bottom);
  }

  private xDomain(): [Date, Date] {
    if (this.domain) {
      return [new Date(this.domain[0]), new Date(this.domain[1])];
    }
    const times = this.series.flatMap((s) => s.points.map((p) => p.time));
    if (times.length === 0) {
      const now = Date.now();
      return [new Date(now - 3_600_000), new Date(now)];
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    return [new Date(min), new Date(max === min ? max + 1 : max)];
  }

  private yDomain(): [number, number] {
    const values = this.series.flatMap((s) => s.points.map((p) => p.value));
    if (values.length === 0) return [0, 1];
    const max = Math.max(...values);
    return [0, max * 1.1 || 1];
  }

  private formatY(value: number): string {
    switch (this.yFormat) {
      case "ms":
        return value >= 1000
          ? `${(value / 1000).toFixed(1)}s`
          : `${value.toFixed(0)}`;
      case "req/s":
        return value.toFixed(0);
      case "%":
        return `${(value * 100).toFixed(0)}%`;
      case "count":
        return value.toFixed(0);
    }
  }

  private lineFor(s: ChartSeries, x: (d: Date) => number, y: (v: number) => number) {
    return line<ChartPoint>(
      (p) => x(new Date(p.time)),
      (p) => y(p.value),
    )(s.points);
  }

  // ─── Interaction ───

  private nearestPoint(times: number[], target: number): number | null {
    if (times.length === 0) return null;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const candidates = [
      times[Math.max(0, lo - 1)],
      times[Math.min(times.length - 1, lo)],
    ].filter((t): t is number => t !== undefined);
    return candidates.reduce((best, t) =>
      Math.abs(t - target) < Math.abs(best - target) ? t : best,
    );
  }

  private onMouseMove(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;
    if (this.dragStart !== null) {
      const x1 = this.svgX(event, svg);
      this.brush = {
        x0: Math.min(this.dragStart, x1),
        x1: Math.max(this.dragStart, x1),
      };
      return;
    }
    const x = scaleTime().domain(this.xDomain()).range([0, this.plotWidth]);
    const value = x.invert(this.svgX(event, svg) - MARGIN.left);
    const times = [...new Set(this.series.flatMap((s) => s.points.map((p) => p.time)))].sort(
      (a, b) => a - b,
    );
    this.hoverTime = this.nearestPoint(times, value.getTime());
  }

  private onMouseDown(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;
    this.dragStart = this.svgX(event, svg) - MARGIN.left;
  }

  private onMouseUp(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg || this.dragStart === null) {
      this.dragStart = null;
      this.brush = null;
      return;
    }
    const x1 = this.svgX(event, svg) - MARGIN.left;
    const x0 = this.dragStart;
    this.dragStart = null;
    this.brush = null;
    if (Math.abs(x1 - x0) < 8) return; // treat as a plain click

    const x = scaleTime().domain(this.xDomain()).range([0, this.plotWidth]);
    const from = x.invert(Math.min(x0, x1)).getTime();
    const to = x.invert(Math.max(x0, x1)).getTime();
    this.dispatchEvent(
      new CustomEvent("zoom", {
        detail: { from, to },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private svgX(event: MouseEvent, svg: SVGSVGElement): number {
    const rect = svg.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * this.width;
  }

  private hoverRows() {
    if (this.hoverTime === null) return [];
    const rows: Array<{ name: string; colorIndex: number; value: number }> = [];
    for (const s of this.series) {
      const point = s.points.find((p) => p.time === this.hoverTime);
      if (point) rows.push({ name: s.name, colorIndex: s.colorIndex, value: point.value });
    }
    return rows;
  }

  // ─── Render ───

  override render() {
    const pw = this.plotWidth;
    const ph = this.plotHeight;
    const x = scaleTime().domain(this.xDomain()).range([0, pw]);
    const y = scaleLinear().domain(this.yDomain()).range([ph, 0]);
    const xTicks = x.ticks(6);
    const yTicks = y.ticks(5);
    const span = this.xDomain()[1].getTime() - this.xDomain()[0].getTime();

    const hoverX =
      this.hoverTime === null ? null : x(new Date(this.hoverTime));

    return html`
      <div class="wrap">
        ${this.showLegend && this.series.length > 1
          ? html`<div class="legend">
              ${this.series.map(
                (s) => html`<span class="legend-item">
                  <span class="swatch swatch-${s.colorIndex}"></span>${s.name}
                </span>`,
              )}
            </div>`
          : ""}
        <svg
          width=${this.width}
          height=${this.height}
          @mousemove=${this.onMouseMove}
          @mousedown=${this.onMouseDown}
          @mouseup=${this.onMouseUp}
          @mouseleave=${() => {
            this.hoverTime = null;
            this.brush = null;
          }}
          role="img"
          aria-label="Time-series chart"
        >
          <g transform="translate(${MARGIN.left},${MARGIN.top})">
            ${this.showGrid
              ? yTicks.map(
                  (t) => html`<line
                    class="grid"
                    x1="0"
                    x2=${pw}
                    y1=${y(t)}
                    y2=${y(t)}
                  />`,
                )
              : ""}
            ${yTicks.map(
              (t) => html`<text
                class="axis"
                x="-8"
                y=${y(t)}
                text-anchor="end"
                dominant-baseline="middle"
              >
                ${this.formatY(t)}
              </text>`,
            )}
            ${xTicks.map(
              (t) => html`<text
                class="axis"
                x=${x(t)}
                y=${ph + 18}
                text-anchor="middle"
              >
                ${formatTick(t.getTime(), span)}
              </text>`,
            )}
            ${this.series.map((s) => {
              const path = this.lineFor(s, x, y);
              return html`
                ${this.fill
                  ? html`<path
                      class="fill fill-${s.colorIndex}"
                      d=${area<ChartPoint>()
                        .x((p) => x(new Date(p.time)))
                        .y0(ph)
                        .y1((p) => y(p.value))(s.points)}
                    />`
                  : ""}
                <path class="line line-${s.colorIndex}" d=${path} />
                ${this.showDots
                  ? s.points.map(
                      (p) => html`<circle
                        class="dot dot-${s.colorIndex}"
                        cx=${x(new Date(p.time))}
                        cy=${y(p.value)}${""}
                        r="2.5"
                      />`,
                    )
                  : ""}
              `;
            })}
            ${this.brush
              ? html`<rect
                  class="brush"
                  x=${this.brush.x0}
                  y="0"
                  width=${Math.max(0, this.brush.x1 - this.brush.x0)}
                  height=${ph}
                />`
              : ""}
            ${hoverX !== null
              ? html`<line
                  class="crosshair"
                  x1=${hoverX}
                  x2=${hoverX}
                  y1="0"
                  y2=${ph}
                />`
              : ""}
          </g>
        </svg>
        ${hoverX !== null && this.hoverRows().length
          ? html`<div
              class="tooltip"
              style="left:${Math.min(
                Math.max(MARGIN.left + hoverX + 12, 8),
                Math.max(8, this.width - 170),
              )}px; top:${MARGIN.top + 8}px"
            >
              <div class="tooltip-time">${formatClock(this.hoverTime!)}</div>
              ${this.hoverRows().map(
                (row) => html`<div class="tooltip-row">
                  <span class="swatch swatch-${row.colorIndex}"></span>
                  <span class="tooltip-name">${row.name}</span>
                  <span class="tooltip-value">${this.formatY(row.value)}</span>
                </div>`,
              )}
            </div>`
          : ""}
      </div>
    `;
  }

  static styles = css`
    .wrap {
      position: relative;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      padding: 0 0 var(--space-1);
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .swatch-1 {
      background: var(--chart-line-1);
    }
    .swatch-2 {
      background: var(--chart-line-2);
    }
    .swatch-3 {
      background: var(--chart-line-3);
    }
    .swatch-4 {
      background: var(--chart-line-4);
    }
    .swatch-5 {
      background: var(--chart-line-5);
    }
    svg {
      display: block;
      cursor: crosshair;
    }
    .grid {
      stroke: var(--chart-grid);
      stroke-width: 1;
    }
    .axis {
      fill: var(--chart-axis);
      font-size: 11px;
      font-family: var(--font-sans);
    }
    .line {
      fill: none;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .line-1 {
      stroke: var(--chart-line-1);
    }
    .line-2 {
      stroke: var(--chart-line-2);
    }
    .line-3 {
      stroke: var(--chart-line-3);
    }
    .line-4 {
      stroke: var(--chart-line-4);
    }
    .line-5 {
      stroke: var(--chart-line-5);
    }
    .fill {
      stroke: none;
      opacity: 0.12;
    }
    .fill-1 {
      fill: var(--chart-line-1);
    }
    .fill-2 {
      fill: var(--chart-line-2);
    }
    .fill-3 {
      fill: var(--chart-line-3);
    }
    .fill-4 {
      fill: var(--chart-line-4);
    }
    .fill-5 {
      fill: var(--chart-line-5);
    }
    .dot-1 {
      fill: var(--chart-line-1);
    }
    .dot-2 {
      fill: var(--chart-line-2);
    }
    .dot-3 {
      fill: var(--chart-line-3);
    }
    .dot-4 {
      fill: var(--chart-line-4);
    }
    .dot-5 {
      fill: var(--chart-line-5);
    }
    .brush {
      fill: var(--brand);
      opacity: 0.15;
    }
    .crosshair {
      stroke: var(--chart-axis);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      pointer-events: none;
    }
    .tooltip {
      position: absolute;
      pointer-events: none;
      background: var(--chart-tooltip-bg);
      border: 1px solid var(--chart-tooltip-border);
      border-radius: 8px;
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-xs);
      box-shadow: var(--shadow-card);
      white-space: nowrap;
      z-index: 2;
    }
    .tooltip-time {
      font-weight: 600;
      margin-bottom: 2px;
    }
    .tooltip-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tooltip-name {
      color: var(--text-muted);
    }
    .tooltip-value {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      padding-left: var(--space-3);
    }
  `;
}
