import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";

/**
 * Shared confirmation dialog for kill/delete. The caller owns the API call;
 * this only collects the "confirm" event.
 */
@customElement("broadside-confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property({ type: Boolean }) open = false;
  @property() title = "";
  @property() body = "";
  @property() confirmLabel = "Confirm";
  @property({ type: Boolean }) busy = false;

  override updated(changed: Map<string, unknown>) {
    if (!changed.has("open")) return;
    const dialog = this.renderRoot.querySelector("sl-dialog");
    if (!dialog) return;
    if (this.open) void dialog.show();
    else dialog.hide();
  }

  private onConfirm() {
    this.dispatchEvent(
      new CustomEvent("confirm", { bubbles: true, composed: true }),
    );
  }

  override render() {
    return html`
      <sl-dialog
        label=${this.title}
        ?open=${this.open}
        @sl-hide=${() => this.dispatchEvent(
          new CustomEvent("close", { bubbles: true, composed: true }),
        )}
      >
        <p>${this.body}</p>
        <div slot="footer" class="footer">
          <sl-button
            variant="neutral"
            ?disabled=${this.busy}
            @click=${() => this.dispatchEvent(
              new CustomEvent("cancel", { bubbles: true, composed: true }),
            )}
          >
            Cancel
          </sl-button>
          <sl-button
            variant="danger"
            ?disabled=${this.busy}
            ?loading=${this.busy}
            @click=${this.onConfirm}
          >
            ${this.confirmLabel}
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  static styles = css`
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    p {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--text-muted);
    }
  `;
}
