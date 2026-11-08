import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { apiGet } from "../api.js";
import type {
  ChartSeries,
  CompareResponse,
  EndpointRow,
  Granularity,
  MetricRow,
  RunRow,
} from "../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent, latencyClass } from "../format.js";
import {
  activeVusers,
  cdfFromLatest,
  errorCount,
  histogramFromLatest,
  tailSpread,
  toBucket,
  vusersIo,
  type Bucket,
} from "../derived-series.js";
import "../components/chart-panel.js";
import "../components/skeleton.js";

const MAX_COMPARE = 5;

@customElement("broadside-compare-view")
export class CompareView extends LitElement {
  @state() private runs: RunRow[] = [];
  @state() private selected = new Set<string>();
  @state() private data: CompareResponse | null = null;
  @state() private loading = false;
  @state() private endpoint = "";
  @state() private granularity: Granularity = "10s";
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
      const params = new URLSearchParams({
        ids,
        granularity: this.granularity,
      });
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

  /** CAGG rows for one run, scoped to the selected endpoint (aggregate by
   *  default) so series never double-count. */
  private rowsFor(runId: string): MetricRow[] {
    return [...(this.data!.series ?? [])]
      .filter(
        (row) =>
          row.run_id === runId &&
          (row.endpoint ?? "") === this.endpoint,
      )
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  private seriesFor(
    pick: (r: MetricRow) => number | null,
  ): ChartSeries[] {
    if (!this.data) return [];
    return this.data.runs.map((run, index) => {
      const points = this.rowsFor(run.id)
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

  /** Rows for one run in time order, normalized into buckets. */
  private runBuckets(runId: string): Bucket[] {
    return this.rowsFor(runId).map((row) =>
      toBucket(row, new Date(row.bucket).getTime()),
    );
  }

  /** One series per comparable run, tagged with run color order. */
  private multiSeries(
    pick: (buckets: Bucket[]) => ChartSeries["points"],
  ): ChartSeries[] {
    if (!this.data) return [];
    return this.data.runs.map((run, index) => ({
      name: run.id.slice(0, 8),
      colorIndex: (index % 5) + 1,
      points: pick(this.runBuckets(run.id)),
    }));
  }

  /** Points of one run from a raw bucket projection. */
  private runPoints(
    buckets: Bucket[],
    pick: (b: Bucket) => number | null,
  ): ChartSeries["points"] {
    return buckets
      .map((b) => ({ time: b.time, value: pick(b) }))
      .filter((p): p is { time: number; value: number } => p.value !== null);
  }

  private cdfRun(runId: string): ChartSeries[] {
    const last = this.runBuckets(runId).at(-1);
    return last ? cdfFromLatest([last]) : [];
  }

  private histogramRun(runId: string): ChartSeries[] {
    const last = this.runBuckets(runId).at(-1);
    return last ? histogramFromLatest([last]) : [];
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
        <h1>Compare Runs</h1>

        <div class="card">
          <div class="actions">
            ${this.endpointOptions.length
              ? html`<label class="field">
                  <span class="label">Endpoint</span>
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
            <label class="field">
              <span class="label">Granularity</span>
              <select
                class="select"
                .value=${this.granularity}
                @change=${(e: Event) => {
                  this.granularity = (e.target as HTMLSelectElement)
                    .value as Granularity;
                  if (this.data) void this.compare();
                }}
              >
                <option value="10s">10 seconds</option>
                <option value="1m">1 minute</option>
                <option value="1h">1 hour</option>
                <option value="1d">1 day</option>
              </select>
            </label>
            <span class="count">
              ${this.selected.size} selected (max ${MAX_COMPARE})
            </span>
            <button
              class="btn primary"
              ?disabled=${this.selected.size < 2 || this.loading}
              @click=${() => void this.compare()}
            >
              ${this.loading ? "loading…" : "compare →"}
            </button>
          </div>

          <div class="picker">
            <table>
              <thead>
                <tr>
                  <th>select</th>
                  <th>run</th>
                  <th>started</th>
                  <th>duration</th>
                  <th>requests</th>
                  <th>p95</th>
                  <th>errors</th>
                  <th>status</th>
                </tr>
              </thead>
              <tbody>
                ${this.runs.map(
                  (run) => {
                    const checked = this.selected.has(run.id);
                    return html`<tr class=${checked ? "selected" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          .checked=${checked}
                          ?disabled=${!checked && this.selected.size >= MAX_COMPARE}
                          aria-label="Select run ${run.id}"
                          @change=${(e: Event) =>
                            this.toggle(run.id, (e.target as HTMLInputElement).checked)}
                        />
                      </td>
                      <td class="mono">${run.id.slice(0, 8)}</td>
                      <td class="muted">${new Date(run.started_at).toLocaleString()}</td>
                      <td>${formatDuration(run.duration_ms)}</td>
                      <td>${formatNumber(run.total_requests)}</td>
                      <td class=${latencyClass(run.p95)}>${formatMs(run.p95)}</td>
                      <td>${formatPercent(run.error_rate)}</td>
                      <td>${run.status}</td>
                    </tr>`;
                  },
                )}
              </tbody>
            </table>
          </div>
        </div>

        ${this.loading && !this.data
          ? html`<broadside-skeleton variant="chart"></broadside-skeleton>`
          : this.data
            ? html`
                <div class="grid">
                  <broadside-chart-panel
                    title="throughput"
                    .series=${this.seriesFor((r) => r.rps)}
                    yFormat="req/s"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="p95 latency"
                    .series=${this.seriesFor((r) => r.p95)}
                    yFormat="ms"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="error rate"
                    .series=${this.seriesFor((r) => r.error_rate)}
                    yFormat="%"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="active virtual users"
                    .series=${this.multiSeries((b) => activeVusers(b))}
                    yFormat="count"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="tail latency spread"
                    .series=${this.multiSeries((b) => tailSpread(b))}
                    yFormat="count"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="error count"
                    .series=${this.multiSeries((b) => errorCount(b))}
                    yFormat="count"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="vusers created vs completed"
                    .series=${this.data.runs.flatMap(
                      (run, index) => {
                        const io = vusersIo(this.runBuckets(run.id));
                        return io.map((s, j) => ({
                          name: `${run.id.slice(0, 8)} ${s.name}`,
                          colorIndex: ((index + j) % 5) + 1,
                          points: s.points,
                        }));
                      },
                    )}
                    yFormat="count"
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="latency CDF"
                    .series=${this.data.runs
                      .map((run, index) => ({
                        series: this.cdfRun(run.id)[0],
                        name: run.id.slice(0, 8),
                        colorIndex: (index % 5) + 1,
                      }))
                      .filter((s) => s.series !== undefined)
                      .map(({ series, name, colorIndex }) => ({
                        ...series!,
                        name,
                        colorIndex,
                      }))}
                    yFormat="%"
                    kind="step"
                    xFormat="number"
                    .fill=${true}
                  ></broadside-chart-panel>
                  <broadside-chart-panel
                    title="latency histogram"
                    .series=${this.data.runs
                      .map((run, index) => ({
                        series: this.histogramRun(run.id)[0],
                        name: run.id.slice(0, 8),
                        colorIndex: (index % 5) + 1,
                      }))
                      .filter((s) => s.series !== undefined)
                      .map(({ series, name, colorIndex }) => ({
                        ...series!,
                        name,
                        colorIndex,
                      }))}
                    yFormat="%"
                    kind="bars"
                    xFormat="number"
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
    .actions {
      display: flex;
      align-items: flex-end;
      gap: var(--s-3);
      flex-wrap: wrap;
      margin-bottom: var(--s-4);
    }
    .count {
      margin-left: auto;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      padding-bottom: var(--s-2);
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
    .picker {
      max-height: calc(10 * 41px); /* ~10 rows, then scrolls */
      overflow-y: auto;
      margin: 0 calc(var(--s-5) * -1);
      padding: 0 var(--s-5);
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
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
      position: sticky;
      top: 0;
      background: var(--surface);
    }
    td {
      padding: var(--s-3) var(--s-4);
      border-bottom: 1px solid var(--border);
      color: var(--text-dim);
    }
    tbody tr:hover {
      background: color-mix(in oklab, var(--surface) 50%, transparent);
    }
    tr.selected {
      box-shadow: inset 0 0 0 1px var(--amber);
    }
    tr.selected td {
      border-bottom-color: var(--amber);
    }
    td input[type="checkbox"] {
      accent-color: var(--amber);
      cursor: pointer;
      width: 16px;
      height: 16px;
    }
    .muted {
      color: var(--mute);
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
    .best {
      font-weight: 500;
      color: var(--ok);
    }
  `;
}
