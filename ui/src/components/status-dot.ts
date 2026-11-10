import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Status dot: green (ok) / amber (warn) / red (bad), matching the
 * topbar health badge. Optionally blinks for in-flight states.
 *
 * Usage:
 *   <broadside-status-dot tone="ok"></broadside-status-dot>
 *   <broadside-status-dot tone="warn" pulse></broadside-status-dot>
 */
@customElement("broadside-status-dot")
export class StatusDot extends LitElement {
  @property() tone: "ok" | "warn" | "bad" = "ok";
  @property({ type: Boolean }) pulse = false;

  override render() {
    return html`
      <span
        class="dot dot-${this.tone} ${this.pulse ? "pulse" : ""}"
        aria-label=${this.tone}
        role="img"
      ></span>
    `;
  }

  static styles = css`
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
      flex: none;
    }
    .dot-ok {
      background: var(--ok);
      box-shadow: 0 0 8px var(--ok);
    }
    .dot-warn {
      background: var(--warn);
      box-shadow: 0 0 8px var(--warn);
    }
    .dot-bad {
      background: var(--bad);
    }
    .pulse {
      animation: blink 1.2s infinite;
    }
  `;
}
