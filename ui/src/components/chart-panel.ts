import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "./line-chart.js";
import type { YFormat } from "./line-chart.js";
import type { ChartSeries } from "../types.js";

/**
 * A titled chart card with an optional "Reset zoom" button. Zoom events
 * from the inner line chart bubble up untouched; parents re-fetch raw
 * data for the window and flip `zoomed` to show the reset affordance.
 */
@customElement("broadside-chart-panel")
export class ChartPanel extends LitElement {
  @property() title = "";
  @property({ type: Array }) series: ChartSeries[] = [];
  @property() yFormat: YFormat = "ms";
  @property() yLabel = "";
  @property({ type: Number }) height = 220;
  @property({ type: Boolean }) fill = false;
  @property({ type: Boolean }) zoomed = false;
  @property({ type: Array }) domain: [number, number] | null = null;

  private resetZoom() {
    this.dispatchEvent(
      new CustomEvent("reset-zoom", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <sl-card class="card">
        <div class="header">
          <h3>${this.title}</h3>
          <div class="actions">
            ${this.zoomed
              ? html`<sl-button
                  size="small"
                  variant="text"
                  @click=${this.resetZoom}
                >
                  <sl-icon name="arrow-counterclockwise" label="Reset zoom"></sl-icon>
                  Reset zoom
                </sl-button>`
              : ""}
            <slot name="controls"></slot>
          </div>
        </div>
        <broadside-line-chart
          .series=${this.series}
          .yFormat=${this.yFormat}
          .yLabel=${this.yLabel}
          .height=${this.height}
          .fill=${this.fill}
          .domain=${this.domain}
        ></broadside-line-chart>
      </sl-card>
    `;
  }

  static styles = css`
    .card {
      display: block;
      height: 100%;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-2);
    }
    h3 {
      margin: 0;
      font-size: var(--text-base);
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
  `;
}
