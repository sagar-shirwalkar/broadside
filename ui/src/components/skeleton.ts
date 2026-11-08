import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";

/**
 * Layout-matching placeholder shown while the initial fetch is in flight,
 * so content popping in does not shift the page around.
 */
@customElement("broadside-skeleton")
export class Skeleton extends LitElement {
  @property() variant: "table" | "kpi" | "chart" = "chart";

  override render() {
    if (this.variant === "table") {
      return html`<div class="table" aria-hidden="true">
        ${[0, 1, 2, 3, 4].map(
          () => html`<div class="row"><sl-skeleton></sl-skeleton></div>`,
        )}
      </div>`;
    }
    if (this.variant === "kpi") {
      return html`<div class="kpi" aria-hidden="true">
        <sl-skeleton class="value"></sl-skeleton>
        <sl-skeleton class="label"></sl-skeleton>
      </div>`;
    }
    return html`<div class="chart" aria-hidden="true">
      <sl-skeleton></sl-skeleton>
    </div>`;
  }

  static styles = css`
    .table .row {
      padding: var(--space-3) 0;
    }
    .table sl-skeleton {
      display: block;
      width: 100%;
      height: 18px;
    }
    .kpi .value {
      display: block;
      width: 60%;
      height: 34px;
      margin-bottom: var(--space-2);
    }
    .kpi .label {
      display: block;
      width: 40%;
      height: 14px;
    }
    .chart sl-skeleton {
      display: block;
      width: 100%;
      height: 220px;
    }
  `;
}
