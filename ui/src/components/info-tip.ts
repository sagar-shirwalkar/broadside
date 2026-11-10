import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Reusable hover "card" tooltip for chart panels: amber hairline border,
 * surface background, mono body text. Shows on hover and on keyboard
 * focus. Pure CSS — no positioning JS, no native title.
 *
 * Usage:
 *   <broadside-info-tip text="p99/p50 ratio — tail fairness…"></broadside-info-tip>
 */
@customElement("broadside-info-tip")
export class InfoTip extends LitElement {
  @property() text = "";
  @property() label = "about this metric";

  override render() {
    return html`
      <span class="wrap">
        <button
          class="trigger"
          type="button"
          aria-label=${this.label}
          aria-describedby="tip"
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
        <span class="tip" role="tooltip" id="tip">${this.text}</span>
      </span>
    `;
  }

  static styles = css`
    .wrap {
      position: relative;
      display: inline-flex;
    }
    .trigger {
      background: transparent;
      border: none;
      padding: 0;
      color: var(--amber);
      font-family: var(--font-mono);
      font-size: var(--step-1);
      line-height: 1;
      cursor: help;
      transition: color var(--dur-fast) var(--ease);
    }
    .trigger:hover,
    .trigger:focus-visible {
      color: var(--amber-dim);
      outline: none;
    }
    .tip {
      position: absolute;
      top: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%) translateY(-4px);
      min-width: 240px;
      max-width: 300px;
      white-space: normal;
      text-align: left;
      background: var(--surface-2);
      border: 1px solid var(--amber);
      border-radius: var(--radius-lg);
      padding: var(--s-3) var(--s-4);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      line-height: 1.55;
      color: var(--amber);
      letter-spacing: 0;
      text-transform: none;
      box-shadow: var(--shadow-card);
      opacity: 0;
      visibility: hidden;
      transition:
        opacity var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease),
        visibility 0s var(--dur-fast);
      z-index: 20;
      pointer-events: none;
    }
    .wrap:hover .tip,
    .wrap:focus-within .tip {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
      transition:
        opacity var(--dur-fast) var(--ease),
        transform var(--dur-fast) var(--ease);
    }
    /* The card is pointer-events: none so it never intercepts the chart;
     * it simply tracks the trigger (hover/focus-within). */
  `;
}
