import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Shared confirmation "sheet" for kill/delete. Krivostr overlay pattern:
 * fixed dim + blur backdrop, surface sheet. The caller owns the API call;
 * this only collects the "confirm" event.
 */
@customElement("broadside-confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property() title = "";
  @property() body = "";
  @property() confirmLabel = "Confirm";
  @property({ type: Boolean }) busy = false;

  private onConfirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", { bubbles: true, composed: true }),
    );
  }

  private onCancel() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private onBackdrop(event: Event) {
    if (event.target === event.currentTarget) this.onCancel();
  }

  private cap(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  override render() {
    if (!this.open) return "";
    return html`
      <div class="overlay" @click=${this.onBackdrop}>
        <div class="sheet" role="dialog" aria-label=${this.title}>
          <div class="header">
            <h2>${this.cap(this.title)}</h2>
            <button class="close" @click=${this.onCancel} aria-label="Close">✕</button>
          </div>
          <p class="body">${this.body}</p>
          <div class="actions">
            <button class="btn" @click=${this.onCancel} ?disabled=${this.busy}>
              Cancel
            </button>
            <button
              class="btn danger"
              @click=${this.onConfirm}
              ?disabled=${this.busy}
            >
              ${this.busy ? "Working…" : this.cap(this.confirmLabel)}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: color-mix(in oklab, var(--bg) 70%, transparent);
      backdrop-filter: blur(4px);
      z-index: 50;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: var(--s-6) var(--s-5);
    }
    .sheet {
      max-width: 480px;
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-4) var(--s-5);
      animation: fade-up var(--dur) var(--ease);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      margin-bottom: var(--s-2);
    }
    h2 {
      font-size: var(--step-1);
      margin: 0;
      font-weight: 600;
    }
    .close {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: 2px var(--s-2);
      cursor: pointer;
      flex: none;
      transition: all var(--dur-fast) var(--ease);
    }
    .close:hover {
      color: var(--text);
      border-color: var(--amber-dim);
    }
    .body {
      margin: 0;
      color: var(--text-dim);
      font-size: var(--step-0);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--s-2);
      margin-top: var(--s-4);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      padding: var(--s-2) var(--s-5);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .btn:hover:not(:disabled) {
      border-color: var(--amber);
      color: var(--amber);
    }
    .btn.danger:hover:not(:disabled) {
      border-color: var(--bad);
      color: var(--bad);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;
}
