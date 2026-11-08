import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
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
        <p class="hint">// the run may have been deleted, or the link is stale.</p>
        <button class="btn" @click=${() => navigate("/")}>
          ← go to run list
        </button>
      </main>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--s-4);
      padding: var(--s-10) 0;
      animation: fade-up var(--dur-slow) var(--ease);
    }
    .code {
      margin: 0;
      font-size: var(--step-5);
      font-weight: 500;
      color: var(--mute-2);
      line-height: 1;
      letter-spacing: -0.035em;
    }
    h1 {
      margin: 0;
      font-size: var(--step-2);
    }
    .hint {
      margin: 0;
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
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
    .btn:hover {
      border-color: var(--amber);
      color: var(--amber);
    }
  `;
}
