import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import { navigate } from "../router.js";

/**
 * Shown for unknown hashes and when the API reports an unknown run id.
 */
@customElement("broadside-not-found")
export class NotFound extends LitElement {
  @property() message = "Page not found";

  override render() {
    return html`
      <main class="page">
        <p class="code">404</p>
        <h1>${this.message}</h1>
        <p class="hint">The run may have been deleted, or the link is stale.</p>
        <sl-button variant="primary" @click=${() => navigate("/")}>
          Go to run list
        </sl-button>
      </main>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-10) var(--space-4);
      text-align: center;
    }
    .code {
      margin: 0;
      font-size: 56px;
      font-weight: 700;
      color: var(--text-faint);
      line-height: 1;
    }
    h1 {
      margin: 0;
      font-size: var(--text-xl);
    }
    .hint {
      margin: 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
  `;
}
