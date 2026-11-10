import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError } from "../../services/api.js";

export interface RunStarted {
  id: string;
}

/**
 * "New Run" dialog: script path (no `..`), optional YAML config, optional
 * comma-separated extra args. On 201 emits `run-started` so the app can
 * navigate to the live view.
 */
@customElement("broadside-trigger-dialog")
export class TriggerDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @state() private scriptPath = "";
  @state() private config = "";
  @state() private extraArgs = "";
  @state() private error: string | null = null;
  @state() private submitting = false;

  private close() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private onBackdrop(event: Event) {
    if (event.target === event.currentTarget) this.close();
  }

  private async submit() {
    const scriptPath = this.scriptPath.trim();
    if (!scriptPath) {
      this.error = "script_path is required";
      return;
    }
    if (scriptPath.includes("..")) {
      this.error = "script_path must not contain '..'";
      return;
    }
    this.error = null;
    this.submitting = true;
    try {
      const args = this.extraArgs
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = { script_path: scriptPath };
      if (this.config.trim()) body.config = this.config;
      if (args.length) body.extra_args = args;
      const { id } = await api<{ id: string }>("/api/runs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      this.dispatchEvent(
        new CustomEvent<RunStarted>("run-started", {
          detail: { id },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.error =
        err instanceof ApiError ? err.message : "failed to start run";
    } finally {
      this.submitting = false;
    }
  }

  override render() {
    if (!this.open) return "";
    return html`
      <div class="overlay" @click=${this.onBackdrop}>
        <div class="sheet" role="dialog" aria-label="Trigger Artillery run">
          <button class="close" @click=${this.close} aria-label="Close">✕</button>
          <h2>trigger run</h2>
          ${this.error
            ? html`<p class="warn">⚠ ${this.error}</p>`
            : ""}
          <label class="field">
            script path
            <input
              class="input"
              .value=${this.scriptPath}
              placeholder="./load-test.yml"
              @input=${(e: Event) => {
                this.scriptPath = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") void this.submit();
              }}
            />
          </label>
          <label class="field">
            config <span class="opt">(optional YAML)</span>
            <textarea
              class="input"
              rows="4"
              .value=${this.config}
              @input=${(e: Event) => {
                this.config = (e.target as HTMLTextAreaElement).value;
              }}
            ></textarea>
          </label>
          <label class="field">
            extra args <span class="opt">(optional, comma-separated)</span>
            <input
              class="input"
              .value=${this.extraArgs}
              placeholder="--environment, staging"
              @input=${(e: Event) => {
                this.extraArgs = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <div class="actions">
            <button class="btn" @click=${this.close}>cancel</button>
            <button
              class="btn primary"
              @click=${() => void this.submit()}
              ?disabled=${this.submitting}
            >
              ${this.submitting ? "starting…" : "+ start run"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
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
      overflow-y: auto;
    }
    .sheet {
      max-width: 560px;
      width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-5);
      animation: fade-up var(--dur) var(--ease);
    }
    .close {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: var(--s-1) var(--s-3);
      cursor: pointer;
      margin-bottom: var(--s-4);
      transition: all var(--dur-fast) var(--ease);
    }
    .close:hover {
      color: var(--text);
      border-color: var(--amber-dim);
    }
    h2 {
      font-size: var(--step-2);
      margin: 0 0 var(--s-4);
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
    .opt {
      color: var(--mute-2);
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
      font-size: var(--step--1);
      padding: var(--s-2) var(--s-3);
      outline: none;
      box-sizing: border-box;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .input:focus {
      border-color: var(--amber-dim);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--s-2);
      margin-top: var(--s-2);
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
    .btn.primary {
      background: var(--amber);
      border-color: var(--amber);
      color: var(--ink);
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--amber-dim);
      color: var(--ink);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;
}
