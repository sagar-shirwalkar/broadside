import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import { apiGet } from "../api.js";
import type { EndpointRow } from "../types.js";

export const ALL_ENDPOINTS = "";

/**
 * Endpoint dropdown: "All (aggregate)" plus every endpoint seen in the run.
 * The parent owns the selected value; this control only reports changes.
 */
@customElement("broadside-endpoint-select")
export class EndpointSelect extends LitElement {
  @property() runId = "";
  /** "" = aggregate row. */
  @property() value: string = ALL_ENDPOINTS;
  @property() label = "Endpoint";

  @state() private endpoints: EndpointRow[] = [];
  @state() private loading = false;

  override updated(changed: Map<string, unknown>) {
    if (changed.has("runId")) {
      void this.load();
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    if (this.runId) void this.load();
  }

  private async load() {
    if (!this.runId) return;
    this.loading = true;
    try {
      this.endpoints = await apiGet<EndpointRow[]>(
        `/api/runs/${encodeURIComponent(this.runId)}/endpoints`,
      );
    } catch {
      this.endpoints = [];
    } finally {
      this.loading = false;
    }
  }

  private onChange(event: Event) {
    const select = event.target as HTMLSelectElement & { value: string };
    this.dispatchEvent(
      new CustomEvent("endpoint-change", {
        detail: { endpoint: select.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="field">
        <label class="label" for="select">${this.label}</label>
        <sl-select
          id="select"
          size="small"
          .value=${this.value}
          ?loading=${this.loading}
          @sl-change=${this.onChange}
        >
          <sl-option value="">All (aggregate)</sl-option>
          ${this.endpoints.map(
            (e) => html`<sl-option value=${e.endpoint}>
              ${e.endpoint}
            </sl-option>`,
          )}
        </sl-select>
      </div>
    `;
  }

  static styles = css`
    .field {
      display: inline-flex;
      flex-direction: column;
      gap: 2px;
    }
    .label {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }
    sl-select {
      min-width: 180px;
    }
  `;
}
