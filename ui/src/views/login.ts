import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError, setToken } from "../api.js";

/**
 * Landing page shown when the API answers 401 (API_TOKEN set, no valid
 * token stored). Never rendered when authentication is disabled.
 */
@customElement("broadside-login")
export class Login extends LitElement {
  @state() private token = "";
  @state() private error: string | null = null;
  @state() private submitting = false;

  private async submit() {
    const token = this.token.trim();
    if (!token) {
      this.error = "enter the API token";
      return;
    }
    this.error = null;
    this.submitting = true;
    setToken(token);
    try {
      // Probe a protected endpoint: the api wrapper clears the token and
      // re-dispatches unauthorized if it is still rejected.
      await api<unknown[]>("/api/runs?limit=1");
      this.dispatchEvent(
        new CustomEvent("login-success", {
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.error =
        err instanceof ApiError && err.status === 401
          ? "that token was rejected. try again."
          : "could not reach the server.";
    } finally {
      this.submitting = false;
    }
  }

  override render() {
    return html`
      <main class="page">
        <section class="card">
          <div class="brand">
            <span class="brand-dot" aria-hidden="true"></span>
            <h1>Broadside</h1>
            <p class="sub">artillery run dashboard</p>
          </div>
          ${this.error
            ? html`<p class="warn">⚠ ${this.error}</p>`
            : ""}
          <label class="field">
            api token
            <input
              class="input"
              type="password"
              autocomplete="current-password"
              .value=${this.token}
              @input=${(e: Event) => {
                this.token = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this.submit();
              }}
            />
          </label>
          <button
            class="btn primary"
            ?disabled=${this.submitting}
            @click=${() => void this.submit()}
          >
            sign in →
          </button>
          <footer class="foot">
            <span>powered by artillery</span>
          </footer>
        </section>
      </main>
    `;
  }

  static styles = css`
    .page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--s-6) var(--s-5);
      animation: fade-up var(--dur-slow) var(--ease);
    }
    .card {
      width: min(380px, 100%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-6);
    }
    .brand {
      text-align: center;
      margin-bottom: var(--s-5);
    }
    .brand-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 12px var(--amber);
    }
    h1 {
      margin: var(--s-3) 0 0;
      font-size: var(--step-3);
      font-weight: 500;
      letter-spacing: -0.035em;
    }
    .sub {
      margin: 4px 0 0;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    .warn {
      color: var(--warn);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      margin: 0 0 var(--s-4);
    }
    .field {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      margin-bottom: var(--s-4);
    }
    .input {
      display: block;
      width: 100%;
      margin-top: var(--s-1);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--step-0);
      padding: var(--s-2) var(--s-3);
      outline: none;
      box-sizing: border-box;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .input:focus {
      border-color: var(--amber-dim);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      width: 100%;
      padding: var(--s-3) var(--s-5);
      border-radius: var(--radius);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .btn.primary {
      background: var(--amber);
      border: 1px solid var(--amber);
      color: var(--ink);
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--amber-dim);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .foot {
      margin-top: var(--s-6);
      text-align: center;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute-2);
    }
  `;
}
