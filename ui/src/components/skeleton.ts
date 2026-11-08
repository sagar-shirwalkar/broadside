import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Layout-matching placeholder shown while the initial fetch is in flight,
 * so content popping in does not shift the page around. CSS pulse only.
 */
@customElement("broadside-skeleton")
export class Skeleton extends LitElement {
  @property() variant: "table" | "kpi" | "chart" = "chart";

  override render() {
    if (this.variant === "table") {
      return html`<div class="table" aria-hidden="true">
        ${[0, 1, 2, 3, 4].map(() => html`<div class="row"></div>`)}
      </div>`;
    }
    if (this.variant === "kpi") {
      return html`<div class="kpi" aria-hidden="true">
        <div class="bar value"></div>
        <div class="bar label"></div>
      </div>`;
    }
    return html`<div class="chart" aria-hidden="true"></div>`;
  }

  static styles = css`
    .bar,
    .row,
    .chart {
      background: var(--surface-2);
      border-radius: var(--radius);
      animation: pulse 1.6s ease-in-out infinite;
    }
    .table .row {
      height: 18px;
      margin: var(--s-3) 0;
    }
    .kpi .value {
      width: 60%;
      height: 34px;
      margin-bottom: var(--s-2);
    }
    .kpi .label {
      width: 40%;
      height: 14px;
    }
    .chart {
      height: 220px;
    }
    @keyframes pulse {
      50% {
        opacity: 0.45;
      }
    }
  `;
}
