import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import "@shoelace-style/shoelace/dist/components/spinner/spinner.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import { api, apiGet } from "../api.js";
import type { RunRow, RunStatus } from "../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent, latencyClass, relativeTime } from "../format.js";
import { navigate } from "../router.js";
import "../components/skeleton.js";
import "../components/confirm-dialog.js";

const PAGE_SIZES = [25, 50, 100];

@customElement("broadside-run-list")
export class RunList extends LitElement {
  @state() private runs: RunRow[] = [];
  @state() private loading = true;
  @state() private limit = 50;
  @state() private offset = 0;

  @state() private confirmOpen = false;
  @state() private confirmTarget: RunRow | null = null;
  @state() private confirmBusy = false;

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    try {
      this.runs = await apiGet<RunRow[]>(
        `/api/runs?limit=${this.limit}&offset=${this.offset}`,
      );
    } finally {
      this.loading = false;
    }
  }

  private get page() {
    return Math.floor(this.offset / this.limit) + 1;
  }

  /** A full page means there is (probably) a next one. */
  private get hasNext() {
    return this.runs.length === this.limit;
  }

  private changePage(delta: number) {
    this.offset = Math.max(0, this.offset + delta * this.limit);
    void this.load();
  }

  private badgeFor(status: RunStatus) {
    if (status === "running") {
      return html`<sl-badge variant="success" class="pulse">running</sl-badge>`;
    }
    if (status === "failed") {
      return html`<sl-badge variant="danger">failed</sl-badge>`;
    }
    return html`<sl-badge variant="neutral">completed</sl-badge>`;
  }

  private askDelete(row: RunRow) {
    this.confirmTarget = row;
    this.confirmOpen = true;
  }

  private async doDelete() {
    const target = this.confirmTarget;
    if (!target) return;
    this.confirmBusy = true;
    try {
      await api(`/api/runs/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      this.runs = this.runs.filter((r) => r.id !== target.id);
      this.confirmOpen = false;
    } finally {
      this.confirmBusy = false;
    }
  }

  override render() {
    return html`
      <div class="page">
        <div class="toolbar">
          <h1>Runs</h1>
          <div class="controls">
            <sl-select
              size="small"
              class="size"
              .value=${String(this.limit)}
              @sl-change=${(e: Event) => {
                this.limit = Number(
                  (e.target as HTMLSelectElement).value,
                );
                this.offset = 0;
                void this.load();
              }}
              aria-label="Rows per page"
            >
              ${PAGE_SIZES.map(
                (n) => html`<sl-option value=${String(n)}>${n}</sl-option>`,
              )}
            </sl-select>
            <sl-button
              size="small"
              variant="primary"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("new-run", {
                    bubbles: true,
                    composed: true,
                  }),
                )}
            >
              <sl-icon slot="prefix" name="plus"></sl-icon>
              New Run
            </sl-button>
          </div>
        </div>

        <sl-card class="table-card">
          ${this.loading
            ? html`<broadside-skeleton variant="table"></broadside-skeleton>`
            : this.runs.length === 0
              ? html`<p class="empty">
                  No runs yet. Create one with the "New Run" button.
                </p>`
              : html`<table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Requests</th>
                      <th>p50</th>
                      <th>p95</th>
                      <th>p99</th>
                      <th>Errors</th>
                      <th>Status</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.runs.map(
                      (row) => html`<tr
                        @click=${() => navigate(`/runs/${row.id}`)}
                      >
                        <td class="mono id">${row.id.slice(0, 8)}…</td>
                        <td class="muted" title=${row.started_at}>
                          ${relativeTime(row.started_at)}
                        </td>
                        <td>${formatDuration(row.duration_ms)}</td>
                        <td>${formatNumber(row.total_requests)}</td>
                        <td class=${latencyClass(row.p50)}>
                          ${formatMs(row.p50)}
                        </td>
                        <td class=${latencyClass(row.p95)}>
                          ${formatMs(row.p95)}
                        </td>
                        <td class=${latencyClass(row.p99)}>
                          ${formatMs(row.p99)}
                        </td>
                        <td>${formatPercent(row.error_rate)}</td>
                        <td>${this.badgeFor(row.status)}</td>
                        <td>
                          <sl-button
                            size="small"
                            variant="text"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.askDelete(row);
                            }}
                          >
                            <sl-icon
                              name="trash"
                              label="Delete run"
                            ></sl-icon>
                          </sl-button>
                        </td>
                      </tr>`,
                    )}
                  </tbody>
                </table>`}
        </sl-card>

        <div class="pager">
          <sl-button
            size="small"
            ?disabled=${this.offset === 0 || this.loading}
            @click=${() => this.changePage(-1)}
          >
            Previous
          </sl-button>
          <span class="page-info">Page ${this.page}</span>
          <sl-button
            size="small"
            ?disabled=${!this.hasNext || this.loading}
            @click=${() => this.changePage(1)}
          >
            Next
          </sl-button>
        </div>
      </div>

      <broadside-confirm-dialog
        .open=${this.confirmOpen}
        .busy=${this.confirmBusy}
        .title=${this.confirmTarget?.status === "running"
          ? "Kill run?"
          : "Delete run?"}
        .body=${this.confirmTarget?.status === "running"
          ? "This will terminate the Artillery process. Partial data may be lost."
          : "This will permanently remove the run and all its metrics."}
        .confirmLabel=${this.confirmTarget?.status === "running"
          ? "Kill"
          : "Delete"}
        @close=${() => (this.confirmOpen = false)}
        @confirm=${() => void this.doDelete()}
      ></broadside-confirm-dialog>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: var(--text-xl);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .size {
      width: 84px;
    }
    .table-card::part(body) {
      padding: 0;
      overflow-x: auto;
    }
    .empty {
      padding: var(--space-8);
      text-align: center;
      color: var(--text-muted);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    th {
      text-align: left;
      font-weight: 600;
      color: var(--text-muted);
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border);
      font-variant-numeric: tabular-nums;
    }
    tbody tr {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--surface-hover);
    }
    .id {
      color: var(--brand-strong);
    }
    .muted {
      color: var(--text-muted);
    }
    .pulse {
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-4);
    }
    .page-info {
      font-size: var(--text-sm);
      color: var(--text-muted);
      min-width: 70px;
      text-align: center;
    }
  `;
}
