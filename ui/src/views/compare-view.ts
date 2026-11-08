import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { apiGet } from "../api.js";
import type {
  ChartSeries,
  CompareResponse,
  EndpointRow,
  MetricRow,
  RunRow,
} from "../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent } from "../format.js";
import "../components/chart-panel.js";
import "../components/skeleton.js";

const MAX_COMPARE = 10;

@customElement("broadside-compare-view")
export class CompareView extends LitElement {
  @state() private runs: RunRow[] = [];
  @state() private selected = new Set<string>();
  @state() private data: CompareResponse | null = null;
  @state() private loading = false;
  @state() private endpoint = "";
  @state() private endpointOptions: EndpointRow[] = [];

  override connectedCallback() {
    super.connectedCallback();
    void this.loadRuns();
  }

  private async loadRuns() {
    this.runs = await apiGet<RunRow[]>("/api/runs?limit=100");
  }

  private toggle(id: string, checked: boolean) {
    const next = new Set(this.selected);
    if (checked) {
      if (next.size >= MAX_COMPARE) return;
      next.add(id);
    } else {
      next.delete(id);
    }
    this.selected = next;
  }

  private async compare() {
    const ids = [...this.selected].join(",");
    if (!ids) return;
    this.loading = true;
    try {
      const params = new URLSearchParams({ ids });
      if (this.endpoint !== "") params.set("endpoint", this.endpoint);
      this.data = await apiGet<CompareResponse>(
        `/api/runs/compare?${params}`,
      );
      if (this.endpoint === "" && this.data.runs[0]) {
        void this.loadEndpointOptions(this.data.runs[0].id);
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadEndpointOptions(runId: string) {
    try {
      this.endpointOptions = await apiGet<EndpointRow[]>(
        `/api/runs/${encodeURIComponent(runId)}/endpoints`,
      );
    } catch {
      this.endpointOptions = [];
    }
  }

  private seriesFor(
    pick: (r: MetricRow) => number | null,
  ): ChartSeries[] {
    if (!this.data) return [];
    return this.data.runs.map((run, index) => {
      const points = this.data!.series
        .filter((row) => row.run_id === run.id)
        .map((row) => ({
          time: new Date(row.bucket).getTime(),
          value: pick(row),
        }))
        .filter((p): p is { time: number; value: number } => p.value !== null);
      return {
        name: run.id.slice(0, 8),
        colorIndex: (index % 5) + 1,
        points,
      };
    });
  }

  private bestIn(column: (r: RunRow) => number | null, lowest = true): string | null {
    let best: string | null = null;
    let bestValue = lowest ? Infinity : -Infinity;
    for (const run of this.data?.runs ?? []) {
      const value = column(run);
      if (value === null) continue;
      if (lowest ? value < bestValue : value > bestValue) {
        bestValue = value;
        best = run.id;
      }
    }
    return best;
  }

  override render() {
    const bestP95 = this.bestIn((r) => r.p95);
    const bestP50 = this.bestIn((r) => r.p50);
    const bestErrors = this.bestIn((r) => r.error_rate);
    const bestVolume = this.bestIn((r) => r.total_requests, false);

    return html`
      <div class="page">
        <h1>compare runs</h1>

        <div class="card">
          <div class="picker">
            <div class="checks">
              ${this.runs.map(
                (run) => html`<label class="check">
                  <input
                    type="checkbox"
                    .checked=${this.selected.has(run.id)}
                    ?disabled=${!this.selected.has(run.id) &&
                    this.selected.size >= MAX_COMPARE}
                    @change=${(e: Event) =>
                      this.toggle(run.id, (e.target as HTMLInputElement).checked)}
                  />
                  <span class="mono">${run.id.slice(0, 8)}</span>
                  <span class="meta">
                    ${new Date(run.started_at).toLocaleString()}
                  </span>
                </label>`,
              )}
            </div>
            <div class="actions">
              ${this.endpointOptions.length
                ? html`<label class="field">
                    <span class="label">endpoint</span>
                    <select
                      class="select"
                      .value=${this.endpoint}
                      @change=${(e: Event) => {
                        this.endpoint = (e.target as HTMLSelectElement).value;
                        void this.compare();
                      }}
                    >
                      <option value="">all (aggregate)</option>
                      ${this.endpointOptions.map(
                        (e) => html`<option value=${e.endpoint}>
                          ${e.endpoint}
                        </option>`,
                      )}
                    </select>
                  </label>`
                : ""}
              <button
                class="btn primary"
                ?disabled=${this.selected.size < 2 || this.loading}
                @click=${() => void this.compare()}
              >
                ${this.loading ? "loading…" : `compare${this.selected.size ? ` (${this.selected.size})` : ""} →`}
              </button>
            </div>
          </div>
        </div>

        ${this.loading && !this.data
          ? html`<broadside-skeleton variant="chart"></broadside-skeleton>`
          : this.data
            ? html`
                <div class="grid">
                  <broadside-chart-panel
                    title="p95 latency"
                    .series=${this.seriesFor((r) => r.p95)}
                    yFormat="ms"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="requests / second"
                    .series=${this.seriesFor((r) => r.rps)}
                    yFormat="req/s"
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="error rate"
                    .series=${this.seriesFor((r) => r.error_rate)}
                    yFormat="%"
                    .fill=${true}
                  ></broadside-chart-panel>
                </div>

                <div class="card table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>run</th>
                        <th>p50</th>
                        <th>p95</th>
                        <th>p99</th>
                        <th>error rate</th>
                        <th>duration</th>
                        <th>total requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.data.runs.map(
                        (run) => html`<tr>
                          <td class="mono">${run.id.slice(0, 8)}</td>
                          <td class=${bestP50 === run.id ? "best" : ""}>
                            ${formatMs(run.p50)}
                          </td>
                          <td class=${bestP95 === run.id ? "best" : ""}>
                            ${formatMs(run.p95)}
                          </td>
                          <td>${formatMs(run.p99)}</td>
                          <td class=${bestErrors === run.id ? "best" : ""}>
                            ${formatPercent(run.error_rate)}
                          </td>
                          <td>${formatDuration(run.duration_ms)}</td>
                          <td class=${bestVolume === run.id ? "best" : ""}>
                            ${formatNumber(run.total_requests)}
                          </td>
                        </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>
              `
            : ""}
      </div>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
    }
    h1 {
      margin: 0;
      font-size: var(--step-3);
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-5);
    }
    .picker {
      display: flex;
      flex-direction: column;
      gap: var(--s-4);
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--s-2);
      max-height: 240px;
      overflow: auto;
    }
    .check {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--text);
      cursor: pointer;
      padding: var(--s-1) var(--s-2);
      border-radius: var(--radius);
      transition: background var(--dur-fast) var(--ease);
    }
    .check:hover {
      background: var(--surface-2);
    }
    .check input {
      accent-color: var(--accent);
      cursor: pointer;
    }
    .meta {
      color: var(--mute);
      font-size: var(--step--1);
    }
    .actions {
      display: flex;
      align-items: flex-end;
      gap: var(--s-3);
      flex-wrap: wrap;
    }
    .field {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
    }
    .label {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
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
    }
    .select:focus {
      border-color: var(--amber-dim);
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
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--s-4);
    }
    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .table-card {
      padding: var(--s-2) var(--s-5);
      overflow-x: auto;
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
    .best {
      font-weight: 500;
      color: var(--ok);
    }
  `;
}
