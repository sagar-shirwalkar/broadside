import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
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
      <section class="card">
        <header class="header">
          <h3>${this.title}</h3>
          <div class="actions">
            ${this.zoomed
              ? html`<button class="btn" @click=${this.resetZoom}>
                  ↺ reset
                </button>`
              : ""}
            <slot name="controls"></slot>
          </div>
        </header>
        <broadside-line-chart
          .series=${this.series}
          .yFormat=${this.yFormat}
          .yLabel=${this.yLabel}
          .height=${this.height}
          .fill=${this.fill}
          .domain=${this.domain}
        ></broadside-line-chart>
      </section>
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
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      margin-bottom: var(--s-2);
    }
    h3 {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.01em;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: var(--s-1) var(--s-3);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: transparent;
      color: var(--mute);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .btn:hover {
      color: var(--text);
      border-color: var(--amber-dim);
    }
  `;
}
