import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Validation } from "@broadside/fp/validation";
import { api, ApiError } from "../../services/api.ts";

export interface RunStarted {
  id: string;
}

interface TriggerForm {
  scriptPath: string;
  scriptContent: string;
  config: string;
  extraArgs: string;
}

function validateTriggerForm(input: TriggerForm): Validation<string, TriggerForm> {
  const scriptPath = input.scriptPath.trim();
  const scriptContent = input.scriptContent;
  const errors: string[] = [];
  if (!scriptPath && !scriptContent) {
    errors.push("Script File Or Script Path Is Required");
  }
  if (!scriptContent && scriptPath.includes("..")) {
    errors.push("Script Path Must Not Contain '..'");
  }
  if (errors.length > 0) {
    const [first, ...rest] = errors;
    return Validation.fail(first, ...rest);
  }
  return Validation.ok({ ...input, scriptPath });
}

/**
 * "New Run" dialog: upload/drag-drop a script file (or use a server path),
 * optional YAML config, optional comma-separated extra args. On 201 emits
 * `run-started` so the app can navigate to the live view.
 */
@customElement("broadside-trigger-dialog")
export class TriggerDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @state() private scriptPath = "";
  @state() private scriptContent = "";
  @state() private fileName = "";
  @state() private dragging = false;
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

  private clearFile() {
    this.scriptContent = "";
    this.fileName = "";
    this.scriptPath = "";
    this.error = null;
  }

  private async loadFile(file: File) {
    try {
      const text = await file.text();
      this.scriptContent = text;
      this.fileName = file.name;
      this.scriptPath = file.name;
      this.error = null;
    } catch {
      this.error = "Failed To Read Script File";
    }
  }

  private onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.loadFile(file);
    input.value = "";
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragging = true;
  }

  private onDragLeave(e: DragEvent) {
    e.preventDefault();
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    this.dragging = false;
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void this.loadFile(file);
  }

  private async submit() {
    const result = validateTriggerForm({
      scriptPath: this.scriptPath,
      scriptContent: this.scriptContent,
      config: this.config,
      extraArgs: this.extraArgs,
    });

    await result.match({
      fail: async (violations) => {
        this.error = violations.join("; ");
      },
      ok: async ({ scriptPath, scriptContent, config, extraArgs }) => {
        this.error = null;
        this.submitting = true;
        try {
          const args = extraArgs
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
          const body: Record<string, unknown> = {};
          if (scriptContent) {
            body.script_content = scriptContent;
            body.script_path = scriptPath || "uploaded-script.yml";
          } else {
            body.script_path = scriptPath;
          }
          if (config.trim()) body.config = config;
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
            err instanceof ApiError ? err.message : "Failed To Start Run";
        } finally {
          this.submitting = false;
        }
      },
    });
  }

  override render() {
    if (!this.open) return "";
    return html`
      <div class="overlay" @click=${this.onBackdrop}>
        <div class="sheet" role="dialog" aria-label="Trigger Artillery Run">
          <div class="header">
            <h2>Trigger Run</h2>
            <button class="close" @click=${this.close} aria-label="Close">✕</button>
          </div>
          ${this.error
            ? html`<p class="warn">⚠ ${this.error}</p>`
            : ""}

          <div class="field">
            <span class="label">Script File</span>
            ${this.scriptContent
              ? html`
                  <div class="file-selected">
                    <span class="file-name" title=${this.fileName}>${this.fileName}</span>
                    <button class="file-remove" @click=${this.clearFile} aria-label="Remove file">Remove</button>
                  </div>
                `
              : html`
                  <label
                    class="dropzone ${this.dragging ? "dragging" : ""}"
                    @dragover=${this.onDragOver}
                    @dragleave=${this.onDragLeave}
                    @drop=${this.onDrop}
                  >
                    <input
                      class="file-input"
                      type="file"
                      accept=".yml,.yaml,.json"
                      @change=${this.onFileInput}
                    />
                    <span class="plus" aria-hidden="true">+</span>
                    <span class="drop-text">Drop Script File Or Click To Browse</span>
                    <span class="drop-hint">.yml, .yaml, .json</span>
                  </label>
                `}
            <details class="path-fallback">
              <summary>Use Server Path Instead</summary>
              <input
                class="input"
                .value=${this.scriptContent ? "" : this.scriptPath}
                placeholder="./load-test.yml"
                ?disabled=${Boolean(this.scriptContent)}
                @input=${(e: Event) => {
                  this.scriptPath = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") void this.submit();
                }}
              />
            </details>
          </div>

          <label class="field">
            <span class="label">Config <span class="opt">(Optional YAML)</span></span>
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
            <span class="label">Extra Args <span class="opt">(Optional, Comma-Separated)</span></span>
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
            <button class="btn" @click=${this.close}>Cancel</button>
            <button
              class="btn primary"
              @click=${() => void this.submit()}
              ?disabled=${this.submitting}
            >
              ${this.submitting ? "Starting…" : "+ Start Run"}
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
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      margin-bottom: var(--s-4);
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
      flex: none;
      transition: all var(--dur-fast) var(--ease);
    }
    .close:hover {
      color: var(--text);
      border-color: var(--amber-dim);
    }
    h2 {
      font-size: var(--step-2);
      margin: 0;
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
    .label {
      display: block;
      margin-bottom: var(--s-1);
    }
    .opt {
      color: var(--mute-2);
    }
    .dropzone {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--s-1);
      width: 100%;
      min-height: 112px;
      padding: var(--s-4);
      box-sizing: border-box;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      background: var(--bg);
      color: var(--text-dim);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
      text-align: center;
    }
    .dropzone:hover,
    .dropzone.dragging {
      border-color: var(--amber-dim);
      color: var(--text);
      background: color-mix(in oklab, var(--amber) 4%, var(--bg));
    }
    .file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .plus {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      font-size: var(--step-2);
      line-height: 1;
      color: var(--amber);
      background: var(--surface);
    }
    .dropzone:hover .plus,
    .dropzone.dragging .plus {
      border-color: var(--amber-dim);
    }
    .drop-text {
      font-size: var(--step--1);
    }
    .drop-hint {
      font-size: var(--step--1);
      color: var(--mute-2);
    }
    .file-selected {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      padding: var(--s-2) var(--s-3);
      border: 1px solid var(--amber-dim);
      border-radius: var(--radius);
      background: color-mix(in oklab, var(--amber) 6%, var(--bg));
      color: var(--text);
    }
    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .file-remove {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: 2px var(--s-2);
      cursor: pointer;
      flex: none;
    }
    .file-remove:hover {
      color: var(--bad);
      border-color: var(--bad);
    }
    .path-fallback {
      margin-top: var(--s-2);
    }
    .path-fallback > summary {
      cursor: pointer;
      color: var(--mute-2);
      font-size: var(--step--1);
      user-select: none;
    }
    .path-fallback > summary:hover {
      color: var(--text-dim);
    }
    .path-fallback[open] > summary {
      margin-bottom: var(--s-2);
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
