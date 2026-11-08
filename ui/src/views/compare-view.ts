import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/card/card.js";
import "@shoelace-style/shoelace/dist/components/checkbox/checkbox.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
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
      if (next.size >= MAX_COMPARE) return; // cap: checkboxes are disabled anyway
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
        <h1>Compare runs</h1>

        <sl-card>
          <div class="picker">
            <div class="checks">
              ${this.runs.map(
                (run) => html`<sl-checkbox
                  ?checked=${this.selected.has(run.id)}
                  ?disabled=${!this.selected.has(run.id) &&
                  this.selected.size >= MAX_COMPARE}
                  @sl-change=${(e: Event) =>
                    this.toggle(run.id, (e.target as HTMLInputElement).checked)}
                >
                  <span class="mono">${run.id.slice(0, 8)}</span>
                  <span class="muted">
                    ${new Date(run.started_at).toLocaleString()}
                  </span>
                </sl-checkbox>`,
              )}
            </div>
            <div class="actions">
              ${this.endpointOptions.length
                ? html`<sl-select
                    size="small"
                    label="Endpoint"
                    class="endpoint"
                    .value=${this.endpoint}
                    @sl-change=${(e: Event) => {
                      this.endpoint = (e.target as HTMLSelectElement).value;
                      void this.compare();
                    }}
                  >
                    <sl-option value="">All (aggregate)</sl-option>
                    ${this.endpointOptions.map(
                      (e) => html`<sl-option value=${e.endpoint}>
                        ${e.endpoint}
                      </sl-option>`,
                    )}
                  </sl-select>`
                : ""}
              <sl-button
                variant="primary"
                size="small"
                ?disabled=${this.selected.size < 2 || this.loading}
                ?loading=${this.loading}
                @click=${() => void this.compare()}
              >
                Compare ${this.selected.size
                  ? `(${this.selected.size})`
                  : ""}
              </sl-button>
            </div>
          </div>
        </sl-card>

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
                    title="Requests per second"
                    .series=${this.seriesFor((r) => r.rps)}
                    yFormat="req/s"
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="Error rate"
                    .series=${this.seriesFor((r) => r.error_rate)}
                    yFormat="%"
                    .fill=${true}
                  ></broadside-chart-panel>
                </div>

                <sl-card>
                  <table>
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>p50</th>
                        <th>p95</th>
                        <th>p99</th>
                        <th>Error rate</th>
                        <th>Duration</th>
                        <th>Total requests</th>
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
                </sl-card>
              `
            : ""}
      </div>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    h1 {
      margin: 0;
      font-size: var(--text-xl);
    }
    .picker {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--space-2);
      max-height: 240px;
      overflow: auto;
    }
    .muted {
      color: var(--text-muted);
      font-size: var(--text-xs);
    }
    .actions {
      display: flex;
      align-items: flex-end;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .endpoint {
      min-width: 200px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-4);
    }
    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
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
      font-variant-numeric: tabular-nums;
    }
    .best {
      font-weight: 700;
      background: var(--brand-soft);
    }
  `;
}
