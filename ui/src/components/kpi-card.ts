import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * KPI card: mono label, large tabular value, sparkline of the last N
 * points, and an optional delta (glyph + %) versus a previous run.
 */
@customElement("broadside-kpi-card")
export class KpiCard extends LitElement {
  @property() label = "";
  @property() value = "";
  @property() hint = "";
  /** Sparkline points, oldest first. */
  @property({ type: Array }) spark: number[] = [];
  /** Signed percent change vs. the previous run; null hides the delta. */
  @property({ type: Number }) delta: number | null = null;
  @property() deltaTone: "good" | "bad" = "good";
  @property() chip: "peach" | "blush" | "mint" = "mint";
  @property() icon = "●";

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

  override render() {
    const path = this.sparkPath();
    const delta = this.delta;
    return html`
      <div class="card">
        <div class="top">
          <span class="chip chip-${this.chip}" aria-hidden="true">${this.icon}</span>
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
          <span class="hint">${this.hint}</span>
          ${path
            ? html`<svg
                class="spark"
                viewBox="0 0 120 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
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
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      font-size: var(--step--1);
      flex: none;
    }
    .chip-peach {
      background: var(--chip-peach);
    }
    .chip-blush {
      background: var(--chip-blush);
    }
    .chip-mint {
      background: var(--chip-mint);
    }
    .label {
      font-size: var(--step--1);
      font-family: var(--font-mono);
      color: var(--text-dim);
      letter-spacing: 0.04em;
      text-transform: lowercase;
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
    .spark-dot {
      fill: var(--chart-line-1);
    }
  `;
}
