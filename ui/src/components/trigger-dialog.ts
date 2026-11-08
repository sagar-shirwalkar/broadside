import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/input/input.js";
import "@shoelace-style/shoelace/dist/components/textarea/textarea.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import { api, ApiError } from "../api.js";

export interface RunStarted {
  id: string;
}

/**
 * "New Run" dialog: script path (no `..`), optional YAML config, optional
 * comma-separated extra args. On 201 the dialog closes and emits
 * `run-started` so the app can navigate to the live view.
 */
@customElement("broadside-trigger-dialog")
export class TriggerDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @state() private scriptPath = "";
  @state() private config = "";
  @state() private extraArgs = "";
  @state() private error: string | null = null;
  @state() private submitting = false;

  override updated(changed: Map<string, unknown>) {
    if (!changed.has("open")) return;
    const dialog = this.renderRoot.querySelector("sl-dialog");
    if (!dialog) return;
    if (this.open) {
      this.error = null;
      void dialog.show();
    } else {
      dialog.hide();
    }
  }

  private close() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
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
        err instanceof ApiError
          ? `${err.message} (${err.status})`
          : "failed to start run";
    } finally {
      this.submitting = false;
    }
  }

  override render() {
    return html`
      <sl-dialog
        label="Trigger Artillery run"
        ?open=${this.open}
        @sl-hide=${this.close}
      >
        <div class="form">
          ${this.error
            ? html`<sl-alert variant="danger" open>
                <sl-icon slot="icon" name="exclamation-triangle"></sl-icon>
                ${this.error}
              </sl-alert>`
            : ""}
          <sl-input
            label="Script path"
            help-text="Path to the Artillery YAML script, e.g. ./load-test.yml"
            .value=${this.scriptPath}
            @sl-input=${(e: Event) => {
              this.scriptPath = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.submit();
            }}
          ></sl-input>
          <sl-textarea
            label="Config (optional YAML)"
            rows="4"
            .value=${this.config}
            @sl-input=${(e: Event) => {
              this.config = (e.target as HTMLTextAreaElement).value;
            }}
          ></sl-textarea>
          <sl-input
            label="Extra args (optional, comma-separated)"
            help-text="Appended to the Artillery command line"
            .value=${this.extraArgs}
            @sl-input=${(e: Event) => {
              this.extraArgs = (e.target as HTMLInputElement).value;
            }}
          ></sl-input>
        </div>
        <div slot="footer" class="footer">
          <sl-button variant="neutral" @click=${this.close}>Cancel</sl-button>
          <sl-button
            variant="primary"
            ?loading=${this.submitting}
            @click=${() => void this.submit()}
          >
            Start run
          </sl-button>
        </div>
      </sl-dialog>
    `;
  }

  static styles = css`
    .form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `;
}
