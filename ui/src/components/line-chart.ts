import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ChartSeries, PhaseAnnotation } from "../types.js";
import { formatClock, formatTick } from "../format.js";
import {
  areaPathFrom,
  escapeAnnotationLabel,
  linScale,
  linePathFrom,
  nearestTime,
  niceTicks,
  stepPathFrom,
  timeTicks,
} from "../chart-svg.js";

export type YFormat = "ms" | "req/s" | "%" | "count";
export type ChartKind = "line" | "step" | "bars";
export type XFormat = "time" | "number";

const MARGIN = { top: 12, right: 16, bottom: 28, left: 60 };
const TICK_COUNT_Y = 5;
const TICK_COUNT_X = 6;

/**
 * Pure-SVG time-series chart (no charting library, hand-rolled scales):
 * polyline + optional area fill, horizontal grid, nice ticks, crosshair
 * tooltip, drag-to-zoom, single-point markers.
 *
 * The SVG children are built as a string and injected via innerHTML on the
 * <g> element. Lit nested `${...}` templates parse into the XHTML
 * namespace (HTML <path>s don't render), while setting innerHTML on an
 * SVG element parses in the correct SVG namespace. All injected values
 * are computed numbers/timestamps — never user strings — so this is not
 * an XSS vector; series names only appear in the legend/tooltip as
 * Lit-escaped text.
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
  /** line = polyline, step = step curve (CDF), bars = bucket bars. */
  @property() kind: ChartKind = "line";
  /** "time" = epoch ms (default); "number" = raw numeric x (latency). */
  @property() xFormat: XFormat = "time";
  /** Phase boundaries drawn as dashed verticals with labels. */
  @property({ type: Array }) annotations: PhaseAnnotation[] = [];

  @state() private width = 0;
  @state() private hoverTime: number | null = null;
  @state() private brush: { x0: number; x1: number } | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private dragStart: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) {
        this.width = Math.floor(rect.width);
      }
    });
    // Observe the host (block, full panel width) — more reliable across
    // engines than the inner wrapper.
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  override firstUpdated() {
    // Seed synchronously so the first paint is already sized; the
    // observer keeps it correct on resize.
    if (this.clientWidth > 0) {
      this.width = this.clientWidth;
    }
  }

  override updated() {
    // See class comment: innerHTML on an SVG element parses in the
    // correct namespace, unlike Lit nested templates.
    const g = this.renderRoot.querySelector("g");
    if (!g || this.plotWidth === 0) return;
    const content = this.svgContent();
    if (g.innerHTML !== content) g.innerHTML = content;
  }

  // ─── Domains ───

  /** Spread-safe min/max: raw zooms can carry 100k points, where
   *  `Math.min(...values)` overflows the call stack. */
  private bounds(pick: (p: { time: number; value: number }) => number): [number, number] | null {
    let min = Infinity;
    let max = -Infinity;
    let seen = false;
    for (const s of this.series) {
      for (const p of s.points) {
        const v = pick(p);
        if (v < min) min = v;
        if (v > max) max = v;
        seen = true;
      }
    }
    return seen ? [min, max] : null;
  }

  private xDomain(): [number, number] {
    if (this.domain) return this.domain;
    const times = this.bounds((p) => p.time);
    if (!times) {
      const now = Date.now();
      return [now - 3_600_000, now];
    }
    const [min, max] = times;
    if (max === min) {
      // Single bucket (a short run): center the point in a 2-minute
      // window so it does not collapse onto the plot edge.
      return [min - 60_000, min + 60_000];
    }
    return [min, max];
  }

  private yDomain(): [number, number] {
    const values = this.bounds((p) => p.value);
    if (!values) return [0, 1];
    const max = values[1];
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
      case "%": {
        const pct = value * 100;
        return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
      }
      case "count":
        return value.toFixed(0);
    }
  }

  // ─── Interaction ───

  private svgX(event: MouseEvent, svg: SVGSVGElement): number {
    const rect = svg.getBoundingClientRect();
    return ((event.clientX - rect.left) / rect.width) * this.width;
  }

  private onMouseMove(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;
    if (this.dragStart !== null) {
      // Keep brush coordinates plot-relative, matching dragStart.
      const x1 = this.svgX(event, svg) - MARGIN.left;
      this.brush = {
        x0: Math.min(this.dragStart, x1),
        x1: Math.max(this.dragStart, x1),
      };
      return;
    }
    const invert = linScale(this.xDomain(), [0, this.plotWidth]).invert;
    const value = invert(this.svgX(event, svg) - MARGIN.left);
    const times = [
      ...new Set(this.series.flatMap((s) => s.points.map((p) => p.time))),
    ].sort((a, b) => a - b);
    this.hoverTime = nearestTime(times, value);
  }

  private onMouseDown(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (!svg) return;
    this.dragStart = this.svgX(event, svg) - MARGIN.left;
  }

  private onMouseUp(event: MouseEvent) {
    const svg = this.renderRoot.querySelector("svg");
    if (svg && this.dragStart !== null) {
      const x1 = this.svgX(event, svg) - MARGIN.left;
      const x0 = this.dragStart;
      if (Math.abs(x1 - x0) >= 8) {
        const invert = linScale(this.xDomain(), [0, this.plotWidth]).invert;
        this.dispatchEvent(
          new CustomEvent("zoom", {
            detail: {
              from: invert(Math.min(x0, x1)),
              to: invert(Math.max(x0, x1)),
            },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
    this.dragStart = null;
    this.brush = null;
  }

  private hoverRows() {
    if (this.hoverTime === null) return [];
    const rows: Array<{ name: string; colorIndex: number; value: number }> = [];
    for (const s of this.series) {
      const point = s.points.find((p) => p.time === this.hoverTime);
      if (point) {
        rows.push({ name: s.name, colorIndex: s.colorIndex, value: point.value });
      }
    }
    return rows;
  }

  private get plotWidth() {
    return Math.max(0, this.width - MARGIN.left - MARGIN.right);
  }

  private get plotHeight() {
    return Math.max(0, this.height - MARGIN.top - MARGIN.bottom);
  }

  // ─── SVG content ───

  /** Builds the full inner SVG markup. Numbers only — no user strings. */
  private svgContent(): string {
    const pw = this.plotWidth;
    const ph = this.plotHeight;
    const xDomain = this.xDomain();
    const yDomain = this.yDomain();
    const x = linScale(xDomain, [0, pw]);
    const y = linScale(yDomain, [ph, 0]);
    const xTicks =
      this.xFormat === "number"
        ? niceTicks(xDomain[0], xDomain[1], TICK_COUNT_X)
        : timeTicks(xDomain[0], xDomain[1], TICK_COUNT_X);
    const yTicks = niceTicks(yDomain[0], yDomain[1], TICK_COUNT_Y);
    const span = xDomain[1] - xDomain[0];

    const parts: string[] = [];

    if (this.showGrid) {
      for (const t of yTicks) {
        parts.push(
          `<line class="grid" x1="0" x2="${pw}" y1="${y(t)}" y2="${y(t)}"/>`,
        );
      }
    }

    for (const t of yTicks) {
      parts.push(
        `<text class="axis" x="-8" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${this.formatY(t)}</text>`,
      );
    }

    xTicks.forEach((t, i) => {
      const anchor =
        i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle";
      if (this.xFormat === "number") {
        const label =
          t >= 1000 ? `${(t / 1000).toFixed(1)}s` : `${Math.round(t)}`;
        parts.push(
          `<text class="axis" x="${x(t)}" y="${ph + 18}" text-anchor="${anchor}">${label}</text>`,
        );
      } else {
        parts.push(
          `<text class="axis" x="${x(t)}" y="${ph + 18}" text-anchor="${anchor}">${formatTick(t, span)}</text>`,
        );
      }
    });

    for (const s of this.series) {
      if (this.kind === "bars") {
        const count = s.points.length;
        const slot = count > 0 ? pw / count : 0;
        s.points.forEach((p, i) => {
          const left = i * slot + slot * 0.2;
          parts.push(
            `<rect class="bar bar-${s.colorIndex}" x="${left.toFixed(1)}" y="${y(p.value).toFixed(1)}" width="${(slot * 0.6).toFixed(1)}" height="${(ph - y(p.value)).toFixed(1)}"/>`,
          );
        });
        continue;
      }

      if (this.kind === "step") {
        const path = stepPathFrom(s.points, x, y) ?? "";
        if (path) {
          parts.push(`<path class="fill fill-${s.colorIndex}" d="${path} L${x(this.xEnd(s))},${ph} L${x(s.points[0]!.time)},${ph} Z"/>`);
          parts.push(`<path class="line line-${s.colorIndex}" d="${path}"/>`);
        }
        const single = s.points.length === 1;
        if (single) {
          const p = s.points[0]!;
          parts.push(
            `<circle class="dot dot-${s.colorIndex}" cx="${x(p.time)}" cy="${y(p.value)}" r="4.5"/>`,
          );
        }
        continue;
      }

      if (this.fill && s.points.length > 1) {
        parts.push(
          `<path class="fill fill-${s.colorIndex}" d="${areaPathFrom(s.points, x, y, ph)}"/>`,
        );
      }
      if (s.points.length > 1) {
        parts.push(
          `<path class="line line-${s.colorIndex}" d="${linePathFrom(s.points, x, y)}"/>`,
        );
      }
      const single = s.points.length === 1;
      if (single) {
        const p = s.points[0]!;
        parts.push(
          `<circle class="dot dot-${s.colorIndex}" cx="${x(p.time)}" cy="${y(p.value)}" r="4.5"/>`,
        );
      } else if (this.showDots) {
        for (const p of s.points) {
          parts.push(
            `<circle class="dot dot-${s.colorIndex}" cx="${x(p.time)}" cy="${y(p.value)}" r="2.5"/>`,
          );
        }
      }
    }

    if (this.brush) {
      parts.push(
        `<rect class="brush" x="${Math.min(this.brush.x0, this.brush.x1)}" y="0" width="${Math.abs(this.brush.x1 - this.brush.x0)}" height="${ph}"/>`,
      );
    }

    for (const a of this.annotations) {
      const startMs = new Date(a.start).getTime();
      if (startMs >= xDomain[0] && startMs <= xDomain[1]) {
        parts.push(
          `<line class="annotation" x1="${x(startMs)}" x2="${x(startMs)}" y1="0" y2="${ph}"/>`,
        );
        parts.push(
          `<text class="annotation-label" x="${x(startMs) + 4}" y="10">${escapeAnnotationLabel(a.name)}</text>`,
        );
      }
      if (a.end) {
        const endMs = new Date(a.end).getTime();
        if (endMs >= xDomain[0] && endMs <= xDomain[1]) {
          parts.push(
            `<line class="annotation annotation-end" x1="${x(endMs)}" x2="${x(endMs)}" y1="0" y2="${ph}"/>`,
          );
        }
      }
    }

    if (this.hoverTime !== null) {
      const hoverX = x(this.hoverTime);
      parts.push(
        `<line class="crosshair" x1="${hoverX}" x2="${hoverX}" y1="0" y2="${ph}"/>`,
      );
    }

    return parts.join("");
  }

  private xEnd(s: ChartSeries): number {
    return s.points.length > 0 ? s.points[s.points.length - 1]!.time : 0;
  }

  // ─── Render ───

  override render() {
    const hoverX =
      this.hoverTime === null
        ? null
        : linScale(this.xDomain(), [0, this.plotWidth])(this.hoverTime);

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
        ${this.plotWidth > 0
          ? html`<svg
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
              <g transform="translate(${MARGIN.left},${MARGIN.top})"></g>
            </svg>`
          : ""}
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
    :host {
      display: block;
    }
    .wrap {
      position: relative;
      width: 100%;
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
      stroke-linejoin: round;
      stroke-linecap: round;
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
      fill-opacity: 0.13;
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
    .bar {
      fill-opacity: 0.4;
    }
    .bar-1 {
      fill: var(--chart-line-1);
    }
    .bar-2 {
      fill: var(--chart-line-2);
    }
    .bar-3 {
      fill: var(--chart-line-3);
    }
    .bar-4 {
      fill: var(--chart-line-4);
    }
    .bar-5 {
      fill: var(--chart-line-5);
    }
    .annotation {
      stroke: var(--amber-dim);
      stroke-width: 1;
      stroke-dasharray: 4 4;
    }
    .annotation-end {
      opacity: 0.6;
    }
    .annotation-label {
      fill: var(--amber-dim);
      font-size: 9px;
      font-family: var(--font-mono);
      letter-spacing: 0.05em;
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
