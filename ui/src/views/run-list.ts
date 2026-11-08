import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
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

  private goToPage(page: number) {
    this.offset = Math.max(0, page - 1) * this.limit;
    void this.load();
  }

  private changePage(delta: number) {
    this.goToPage(this.page + delta);
  }

  /**
   * Numbered page list: a window around the current page, always keeping
   * the first and last page visible, with "…" for gaps.
   */
  private pageNumbers(): Array<number | "…"> {
    const current = this.page;
    const lastPage = this.hasNext ? current + 1 : current;
    if (lastPage <= 7) {
      return Array.from({ length: lastPage }, (_, i) => i + 1);
    }
    const pages = new Set<number>([1, 2, 3, current - 1, current, current + 1, lastPage]);
    const sorted = [...pages]
      .filter((p) => p >= 1 && p <= lastPage)
      .sort((a, b) => a - b);
    const out: Array<number | "…"> = [];
    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) out.push("…");
      out.push(p);
      prev = p;
    }
    if (prev < lastPage) out.push("…");
    return out;
  }

  private statusGlyph(status: RunStatus): string {
    if (status === "running") return "●";
    if (status === "failed") return "✕";
    return "✓";
  }

  private statusClass(status: RunStatus): string {
    if (status === "running") return "status-running";
    if (status === "failed") return "status-failed";
    return "status-done";
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
            <select
              class="btn select"
              .value=${String(this.limit)}
              @change=${(e: Event) => {
                this.limit = Number(
                  (e.target as HTMLSelectElement).value,
                );
                this.offset = 0;
                void this.load();
              }}
              aria-label="Rows per page"
            >
              ${PAGE_SIZES.map(
                (n) => html`<option value=${String(n)}>${n}/page</option>`,
              )}
            </select>
            <button
              class="btn primary"
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("new-run", {
                    bubbles: true,
                    composed: true,
                  }),
                )}
            >
              + new run
            </button>
          </div>
        </div>

        <div class="table-wrap">
          ${this.loading
            ? html`<broadside-skeleton variant="table"></broadside-skeleton>`
            : this.runs.length === 0
              ? html`<p class="empty">// no runs yet — hit "+ new run"</p>`
              : html`<table>
                  <thead>
                    <tr>
                      <th>id</th>
                      <th>started</th>
                      <th>duration</th>
                      <th>requests</th>
                      <th>p50</th>
                      <th>p95</th>
                      <th>p99</th>
                      <th>errors</th>
                      <th>status</th>
                      <th aria-label="Actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this.runs.map(
                      (row) => html`<tr
                        @click=${() => navigate(`/runs/${row.id}`)}
                      >
                        <td class="mono id">${row.id.slice(0, 8)}</td>
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
                        <td class=${this.statusClass(row.status)}>
                          <span class="glyph" aria-hidden="true">${this.statusGlyph(row.status)}</span>
                          ${row.status}
                        </td>
                        <td>
                          <button
                            class="icon-btn"
                            title="Delete run"
                            aria-label="Delete run"
                            @click=${(e: Event) => {
                              e.stopPropagation();
                              this.askDelete(row);
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>`,
                    )}
                  </tbody>
                </table>`}
        </div>

        <div class="pager">
          <button
            class="btn"
            ?disabled=${this.offset === 0 || this.loading}
            @click=${() => this.changePage(-1)}
          >
            ← Previous
          </button>
          ${this.pageNumbers().map((entry) =>
            entry === "…"
              ? html`<span class="ellipsis" aria-hidden="true">…</span>`
              : html`<button
                  class="page-btn ${entry === this.page ? "current" : ""}"
                  aria-current=${entry === this.page ? "page" : undefined}
                  @click=${() => this.goToPage(entry)}
                >
                  ${entry}
                </button>`,
          )}
          <button
            class="btn"
            ?disabled=${!this.hasNext || this.loading}
            @click=${() => this.changePage(1)}
          >
            Next →
          </button>
        </div>
      </div>

      <broadside-confirm-dialog
        .open=${this.confirmOpen}
        .busy=${this.confirmBusy}
        .title=${this.confirmTarget?.status === "running"
          ? "kill run?"
          : "delete run?"}
        .body=${this.confirmTarget?.status === "running"
          ? "This will terminate the Artillery process. Partial data may be lost."
          : "This will permanently remove the run and all its metrics."}
        .confirmLabel=${this.confirmTarget?.status === "running"
          ? "kill"
          : "delete"}
        @close=${() => (this.confirmOpen = false)}
        @confirm=${() => void this.doDelete()}
      ></broadside-confirm-dialog>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-4);
      flex-wrap: wrap;
    }
    h1 {
      margin: 0;
      font-size: var(--step-3);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: var(--s-2);
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
    .select {
      appearance: none;
      padding-right: 28px;
      background: var(--surface)
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a0a4ac' fill='none' stroke-width='1.5'/%3E%3C/svg%3E")
        no-repeat right 10px center;
      outline: none;
    }
    .table-wrap {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      padding: var(--s-2) var(--s-5);
    }
    .empty {
      padding: var(--s-8);
      text-align: center;
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--step-0);
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
    }
    th {
      text-align: left;
      font-weight: 500;
      color: var(--mute);
      font-size: var(--step--1);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: var(--s-3) var(--s-4);
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: var(--s-3) var(--s-4);
      border-bottom: 1px solid var(--border);
      color: var(--text-dim);
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    tbody tr {
      cursor: pointer;
      transition: background var(--dur-fast) var(--ease);
    }
    tbody tr:hover {
      background: color-mix(in oklab, var(--surface) 50%, transparent);
    }
    .id {
      color: var(--accent);
    }
    .muted {
      color: var(--mute);
    }
    .glyph {
      font-size: var(--step--1);
    }
    .status-running {
      color: var(--ok);
    }
    .status-failed {
      color: var(--bad);
    }
    .status-done {
      color: var(--mute);
    }
    .icon-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius);
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: var(--s-1) var(--s-3);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .icon-btn:hover {
      color: var(--bad);
      border-color: var(--bad);
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      flex-wrap: wrap;
    }
    .page-btn {
      min-width: 34px;
      height: 34px;
      padding: 0 var(--s-2);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-dim);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .page-btn:hover:not(.current) {
      border-color: var(--amber-dim);
      color: var(--text);
    }
    .page-btn.current {
      background: var(--amber);
      border-color: var(--amber);
      color: var(--ink);
      font-weight: 500;
    }
    .ellipsis {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      padding: 0 var(--s-1);
    }
  `;
}
