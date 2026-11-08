import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
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
      this.error = "Enter the API token";
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
          ? "That token was rejected. Try again."
          : "Could not reach the server.";
    } finally {
      this.submitting = false;
    }
  }

  override render() {
    return html`
      <main class="page">
        <sl-card class="card">
          <div class="brand">
            <img src="/favicon.svg" alt="" width="44" height="44" />
            <h1>Broadside</h1>
            <p class="sub">Artillery run dashboard</p>
          </div>
          ${this.error
            ? html`<sl-alert variant="danger" open>
                <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                ${this.error}
              </sl-alert>`
            : ""}
          <sl-input
            label="API token"
            type="password"
            autocomplete="current-password"
            .value=${this.token}
            @sl-input=${(e: Event) => {
              this.token = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.submit();
            }}
          ></sl-input>
          <sl-button
            variant="primary"
            class="submit"
            ?loading=${this.submitting}
            @click=${() => void this.submit()}
          >
            Sign in
          </sl-button>
          <footer class="foot">
            <span>Powered by Artillery</span>
          </footer>
        </sl-card>
      </main>
    `;
  }

  static styles = css`
    .page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--space-6);
      background:
        radial-gradient(
          60% 50% at 50% 0%,
          var(--brand-soft) 0%,
          transparent 100%
        ),
        var(--bg);
    }
    .card {
      width: min(380px, 100%);
    }
    .card::part(base) {
      padding: var(--space-6);
      box-shadow: var(--shadow-card);
    }
    .brand {
      text-align: center;
      margin-bottom: var(--space-5);
    }
    h1 {
      margin: var(--space-2) 0 0;
      font-size: var(--text-xl);
    }
    .sub {
      margin: 2px 0 0;
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    sl-alert {
      margin-bottom: var(--space-4);
    }
    .submit {
      width: 100%;
      margin-top: var(--space-4);
    }
    .foot {
      margin-top: var(--space-6);
      text-align: center;
      font-size: var(--text-xs);
      color: var(--text-faint);
    }
  `;
}
