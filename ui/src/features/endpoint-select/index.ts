import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { apiGet } from "../../services/api.ts";
import type { EndpointRow } from "../../types.ts";
import "../../components/select.js";

export const ALL_ENDPOINTS = "";

/**
 * Endpoint dropdown: "All (aggregate)" plus every endpoint seen in the
 * run. The parent owns the selected value; this control only reports
 * changes. Native <select> in mono, styled per the design system.
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

  private onChange(event: CustomEvent<{ value: string }>) {
    this.dispatchEvent(
      new CustomEvent("endpoint-change", {
        detail: { endpoint: event.detail.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const options = [
      { value: "", label: "all (aggregate)" },
      ...this.endpoints.map((e) => ({ value: e.endpoint, label: e.endpoint })),
    ];
    return html`
      <broadside-select
        .label=${this.label}
        .options=${options}
        .value=${this.value}
        @change=${this.onChange}
      ></broadside-select>
    `;
  }

  static styles = css`
    .field {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .label {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      letter-spacing: 0.04em;
      text-transform: capitalize;
      text-align: center;
    }
    .select {
      appearance: none;
      min-width: 200px;
      padding-right: 28px;
      background: var(--surface)
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a0a4ac' fill='none' stroke-width='1.5'/%3E%3C/svg%3E")
        no-repeat right 10px center;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding-top: var(--s-2);
      padding-bottom: var(--s-2);
      padding-left: var(--s-3);
      outline: none;
      cursor: pointer;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .select:focus {
      border-color: var(--amber-dim);
    }
    .select:disabled {
      opacity: 0.5;
      cursor: wait;
    }
  `;
}
