import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";

/**
 * KPI card: large value, label, chip icon, sparkline of the last N points,
 * and an optional delta badge versus a previous run.
 */
@customElement("broadside-kpi-card")
export class KpiCard extends LitElement {
  @property() label = "";
  @property() value = "";
  @property() hint = "";
  /** Sparkline points, oldest first. */
  @property({ type: Array }) spark: number[] = [];
  /** Signed percent change vs. the previous run (e.g. 12.5 = ↑12.5%). */
  @property({ type: Number }) delta: number | null = null;
  /** Semantic colors for the delta arrow. */
  @property() deltaTone: "good" | "bad" = "good";
  /** Pastel chip color. */
  @property() chip: "peach" | "blush" | "mint" = "mint";
  @property() icon = "activity";

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
      <sl-card class="card">
        <div class="top">
          <span class="chip chip-${this.chip}">
            <sl-icon name=${this.icon} label=${this.label}></sl-icon>
          </span>
          <span class="label">${this.label}</span>
          ${delta === null
            ? ""
            : html`<span class="delta delta-${this.deltaTone}">
                ${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}
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
            : ""}
        </div>
      </sl-card>
    `;
  }

  static styles = css`
    .card {
      display: block;
      height: 100%;
    }
    .top {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      font-size: 18px;
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
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
    .delta {
      margin-left: auto;
      font-size: var(--text-xs);
      font-weight: 600;
    }
    .delta-good {
      color: var(--success);
    }
    .delta-bad {
      color: var(--danger);
    }
    .value {
      font-size: var(--text-xl);
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }
    .bottom {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-3);
      margin-top: var(--space-2);
    }
    .hint {
      font-size: var(--text-xs);
      color: var(--text-faint);
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
      vector-effect: non-scaling-stroke;
    }
  `;
}
