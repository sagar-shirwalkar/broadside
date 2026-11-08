import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * KPI card: mono uppercase label, large tabular value, sparkline of the
 * last N points (with a translucent area beneath, like the charts), and
 * an optional delta (▲▼ %) versus a previous run. The colored dot is
 * the small semantic marker — compact, no icon chips.
 */
@customElement("broadside-kpi-card")
export class KpiCard extends LitElement {
  @property() label = "";
  @property() value = "";
  /** One hint per line, top to bottom. */
  @property() hint = "";
  /** Sparkline points, oldest first. */
  @property({ type: Array }) spark: number[] = [];
  /** Signed percent change vs. the previous run; null hides the delta. */
  @property({ type: Number }) delta: number | null = null;
  @property() deltaTone: "good" | "bad" = "good";
  /** Dot color. */
  @property() dot: "mint" | "peach" | "blush" = "mint";

  private sparkPath(): string {
    const data = this.spark;
    if (data.length < 2) return "";
    const w = 120;
    const h = 32;
    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    const step = w / (data.length - 1);
    return data
      .map((v, i) => {
        const x = (i * step).toFixed(1);
        const y = (h - 3 - ((v - min) / range) * (h - 6)).toFixed(1);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  private sparkArea(): string {
    const path = this.sparkPath();
    if (!path) return "";
    return `${path} L120,32 L0,32 Z`;
  }

  override render() {
    const path = this.sparkPath();
    const area = this.sparkArea();
    const delta = this.delta;
    const hintLines = this.hint ? this.hint.split("\n") : [];
    return html`
      <div class="card">
        <div class="top">
          <span class="dot dot-${this.dot}" aria-hidden="true"></span>
          <span class="label">${this.label}</span>
          ${delta === null
            ? ""
            : html`<span class="delta delta-${this.deltaTone}">
                ${delta > 0 ? "▲" : delta < 0 ? "▼" : "→"}
                ${Math.abs(delta).toFixed(1)}%
              </span>`}
        </div>
        <div class="value">${this.value}</div>
        <div class="bottom">
          <span class="hint">
            ${hintLines.map((line) => html`<span class="hint-line">${line}</span>`)}
          </span>
          ${path
            ? html`<svg
                class="spark"
                viewBox="0 0 120 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d=${area} class="spark-fill" />
                <path d=${path} class="spark-line" />
              </svg>`
            : this.spark.length === 1
              ? html`<svg
                class="spark"
                viewBox="0 0 120 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <circle cx="60" cy="16" r="3.5" class="spark-dot" />
              </svg>`
              : ""}
        </div>
      </div>
    `;
  }

  static styles = css`
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-5);
      height: 100%;
      box-sizing: border-box;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .card:hover {
      border-color: var(--rule-2);
    }
    .top {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      margin-bottom: var(--s-2);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex: none;
    }
    .dot-mint {
      background: var(--ok);
      box-shadow: 0 0 8px var(--ok);
    }
    .dot-peach {
      background: var(--warn);
    }
    .dot-blush {
      background: var(--bad);
    }
    .label {
      font-size: var(--step--1);
      font-family: var(--font-mono);
      color: var(--text-dim);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .delta {
      margin-left: auto;
      font-size: var(--step--1);
      font-family: var(--font-mono);
    }
    .delta-good {
      color: var(--ok);
    }
    .delta-bad {
      color: var(--bad);
    }
    .value {
      font-size: var(--step-3);
      font-weight: 600;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .bottom {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--s-3);
      margin-top: var(--s-2);
      min-height: 32px;
    }
    .hint {
      font-size: var(--step--1);
      font-family: var(--font-mono);
      color: var(--mute-2);
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .spark {
      width: 120px;
      height: 32px;
      flex: none;
    }
    .spark-line {
      fill: none;
      stroke: var(--chart-line-1);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .spark-fill {
      fill: var(--chart-line-1);
      fill-opacity: 0.13;
      stroke: none;
    }
    .spark-dot {
      fill: var(--chart-line-1);
    }
  `;
}
