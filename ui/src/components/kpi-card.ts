import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * KPI card: three centered zones separated by hairlines — mono uppercase
 * label with a small semantic dot, a tabular value (deliberately modest
 * so large totals like 45,490 never overflow), and a bottom zone split
 * into hint (right-aligned toward the center) + sparkline.
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
    const data = this.spark ?? [];
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
        </div>
        <div class="middle">
          <span class="value">${this.value}</span>
          ${delta === null
            ? ""
            : html`<span class="delta delta-${this.deltaTone}">
                ${delta > 0 ? "▲" : delta < 0 ? "▼" : "→"}
                ${Math.abs(delta).toFixed(1)}%
              </span>`}
        </div>
        <div class="bottom">
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
            : (this.spark?.length ?? 0) === 1
              ? html`<svg
                class="spark"
                viewBox="0 0 120 32"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <circle cx="60" cy="16" r="3.5" class="spark-dot" />
              </svg>`
              : ""}
          <span class="hint">
            ${hintLines.map((line) => html`<span class="hint-line">${line}</span>`)}
          </span>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-5);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .card:hover {
      border-color: var(--rule-2);
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      padding-bottom: var(--s-3);
    }
    .dot {
      width: 7px;
      height: 7px;
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
    }
    .middle {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: var(--s-3);
      padding: var(--s-3) 0;
      border-top: 1px solid var(--border);
    }
    .value {
      font-size: var(--step-2);
      font-weight: 600;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .delta {
      font-size: var(--step--1);
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .delta-good {
      color: var(--ok);
    }
    .delta-bad {
      color: var(--bad);
    }
    .bottom {
      margin-top: auto;
      padding-top: var(--s-3);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--s-2);
    }
    .hint {
      font-size: var(--step--1);
      font-family: var(--font-mono);
      color: var(--mute-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      text-align: center;
    }
    .hint-line {
      white-space: nowrap;
    }
    .spark {
      width: 100%;
      max-width: 110px;
      height: 32px;
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
