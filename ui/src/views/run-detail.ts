import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, apiGet, ApiError, RUN_STATUS_EVENT } from "../api.js";
import type {
  ChartSeries,
  Granularity,
  MetricRow,
  RawRow,
  RunRow,
} from "../types.js";
import {
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
} from "../format.js";
import { navigate } from "../router.js";
import "../components/kpi-card.js";
import "../components/chart-panel.js";
import "../components/endpoint-select.js";
import "../components/skeleton.js";
import "../components/confirm-dialog.js";
import "./not-found.js";

type ZoomRange = { from: number; to: number } | null;

const PANELS = ["rps", "latency", "errors", "volume"] as const;
type PanelKey = (typeof PANELS)[number];

@customElement("broadside-run-detail")
export class RunDetail extends LitElement {
  @property() runId = "";

  @state() private run: RunRow | null = null;
  @state() private missing = false;
  @state() private rows: MetricRow[] = [];
  @state() private rawByPanel = new Map<PanelKey, RawRow[]>();
  @state() private endpoint = "";
  @state() private granularity: Granularity = "1m";
  @state() private zoomByPanel = new Map<PanelKey, ZoomRange>();
  @state() private previous: RunRow | null = null;
  @state() private loading = true;

  @state() private confirmOpen = false;
  @state() private confirmBusy = false;

  override connectedCallback() {
    super.connectedCallback();
    void this.loadAll();
  }

  private async loadAll() {
    this.loading = true;
    try {
      this.run = await apiGet<RunRow>(
        `/api/runs/${encodeURIComponent(this.runId)}`,
      );
      window.dispatchEvent(
        new CustomEvent(RUN_STATUS_EVENT, {
          detail: this.run.status,
          bubbles: true,
          composed: true,
        }),
      );
      await Promise.all([
        this.loadMetrics(),
        this.loadPrevious(),
      ]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        this.missing = true;
      }
    } finally {
      this.loading = false;
    }
  }

  private metricParams(): string {
    const params = new URLSearchParams({ granularity: this.granularity });
    if (this.endpoint !== "") params.set("endpoint", this.endpoint);
    return params.toString();
  }

  private async loadMetrics() {
    this.rows = await apiGet<MetricRow[]>(
      `/api/runs/${encodeURIComponent(this.runId)}/metrics?${this.metricParams()}`,
    );
  }

  private async loadPrevious() {
    try {
      const list = await apiGet<RunRow[]>("/api/runs?limit=100");
      const started = new Date(this.run!.started_at).getTime();
      this.previous =
        list.find(
          (row) =>
            row.id !== this.run!.id &&
            new Date(row.started_at).getTime() < started,
        ) ?? null;
    } catch {
      this.previous = null;
    }
  }

  private points(
    rows: MetricRow[],
    pick: (r: MetricRow) => number | null,
  ): Array<{ time: number; value: number }> {
    return rows
      .map((row) => ({
        time: new Date(row.bucket).getTime(),
        value: pick(row),
      }))
      .filter(
        (p): p is { time: number; value: number } =>
          p.value !== null && !Number.isNaN(p.time),
      );
  }

  private seriesFor(key: PanelKey): ChartSeries[] {
    const zoom = this.zoomByPanel.get(key) ?? null;
    if (zoom) {
      const raw = this.rawByPanel.get(key) ?? [];
      return this.rawSeries(key, raw);
    }
    switch (key) {
      case "rps":
        return [{ name: "req/s", colorIndex: 1, points: this.points(this.rows, (r) => r.rps) }];
      case "latency":
        return [
          { name: "p50", colorIndex: 1, points: this.points(this.rows, (r) => r.p50) },
          { name: "p95", colorIndex: 2, points: this.points(this.rows, (r) => r.p95) },
          { name: "p99", colorIndex: 3, points: this.points(this.rows, (r) => r.p99) },
        ];
      case "errors":
        return [{ name: "error rate", colorIndex: 3, points: this.points(this.rows, (r) => r.error_rate) }];
      case "volume":
        return [{ name: "req/s", colorIndex: 4, points: this.points(this.rows, (r) => r.rps) }];
    }
  }

  private rawSeries(key: PanelKey, raw: RawRow[]): ChartSeries[] {
    const pts = (pick: (r: RawRow) => number | null) =>
      raw
        .map((r) => ({ time: new Date(r.time).getTime(), value: pick(r) }))
        .filter((p): p is { time: number; value: number } => p.value !== null);
    switch (key) {
      case "rps":
        return [{ name: "req/s", colorIndex: 1, points: pts((r) => r.rps) }];
      case "latency":
        return [
          { name: "p50", colorIndex: 1, points: pts((r) => r.p50) },
          { name: "p95", colorIndex: 2, points: pts((r) => r.p95) },
          { name: "p99", colorIndex: 3, points: pts((r) => r.p99) },
        ];
      case "errors":
        return [{ name: "error rate", colorIndex: 3, points: pts((r) => r.error_rate) }];
      case "volume":
        return [{ name: "req/s", colorIndex: 4, points: pts((r) => r.rps) }];
    }
  }

  private async onZoom(event: CustomEvent<{ from: number; to: number }>, key: PanelKey) {
    const { from, to } = event.detail;
    const params = new URLSearchParams({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    if (this.endpoint !== "") params.set("endpoint", this.endpoint);
    const raw = await apiGet<RawRow[]>(
      `/api/runs/${encodeURIComponent(this.runId)}/raw?${params}`,
    );
    this.zoomByPanel = new Map(this.zoomByPanel).set(key, { from, to });
    this.rawByPanel = new Map(this.rawByPanel).set(key, raw);
  }

  private resetZoom(key: PanelKey) {
    this.zoomByPanel = new Map(this.zoomByPanel).set(key, null);
    const nextRaw = new Map(this.rawByPanel);
    nextRaw.delete(key);
    this.rawByPanel = nextRaw;
  }

  private delta(current: number | null, before: number | null): number | null {
    if (current === null || before === null || before === 0) return null;
    return ((current - before) / before) * 100;
  }

  private sparkOf(pick: (r: MetricRow) => number | null): number[] {
    return this.points(this.rows, pick).map((p) => p.value);
  }

  private onEndpointChange(event: CustomEvent<{ endpoint: string }>) {
    this.endpoint = event.detail.endpoint;
    this.zoomByPanel = new Map();
    this.rawByPanel = new Map();
    void this.loadMetrics();
  }

  private async doDelete() {
    this.confirmBusy = true;
    try {
      await api(`/api/runs/${encodeURIComponent(this.runId)}`, {
        method: "DELETE",
      });
      this.confirmOpen = false;
      navigate("/");
    } finally {
      this.confirmBusy = false;
    }
  }

  override render() {
    if (this.missing) {
      return html`<broadside-not-found message="Run not found"></broadside-not-found>`;
    }
    if (this.loading || !this.run) {
      return html`<div class="page">
        <div class="kpis">
          ${[0, 1, 2, 3, 4, 5].map(
            () => html`<broadside-skeleton variant="kpi"></broadside-skeleton>`,
          )}
        </div>
        ${[0, 1, 2, 3].map(
          () => html`<broadside-skeleton variant="chart"></broadside-skeleton>`,
        )}
      </div>`;
    }

    const run = this.run;
    const prev = this.previous;
    const zoomDomain = (key: PanelKey): [number, number] | null => {
      const z = this.zoomByPanel.get(key) ?? null;
      return z ? [z.from, z.to] : null;
    };
    const started = new Date(run.started_at);
    const startedHint = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, "0")}-${String(started.getDate()).padStart(2, "0")}\n${started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`;

    return html`
      <div class="page">
        <div class="header">
          <div class="title-block">
            <button class="link-btn" @click=${() => navigate("/")}>
              ← runs
            </button>
            <h3 class="mono">${run.id.slice(0, 8)}</h3>
          </div>
          <div class="header-actions">
            <button class="btn" @click=${() => navigate(`/runs/${run.id}/live`)}>
              ● live
            </button>
            <button class="btn danger" @click=${() => (this.confirmOpen = true)}>
              ${run.status === "running" ? "✕ kill" : "✕ delete"}
            </button>
          </div>
        </div>

        <div class="kpis">
          <broadside-kpi-card
            label="requests"
            .value=${formatNumber(run.total_requests)}
            .delta=${this.delta(run.total_requests, prev?.total_requests ?? null)}
            .deltaTone=${"good"}
            dot="mint"
            .spark=${this.sparkOf((r) => (r.rps === null ? null : r.rps * 60))}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="duration"
            .value=${formatDuration(run.duration_ms)}
            dot="peach"
            .hint=${startedHint}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p50"
            .value=${formatMs(run.p50)}
            .delta=${this.delta(run.p50, prev?.p50 ?? null)}
            .deltaTone=${"good"}
            dot="mint"
            .spark=${this.sparkOf((r) => r.p50)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p95"
            .value=${formatMs(run.p95)}
            .delta=${this.delta(run.p95, prev?.p95 ?? null)}
            .deltaTone=${"good"}
            dot="peach"
            .spark=${this.sparkOf((r) => r.p95)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p99"
            .value=${formatMs(run.p99)}
            .delta=${this.delta(run.p99, prev?.p99 ?? null)}
            .deltaTone=${"good"}
            dot="blush"
            .spark=${this.sparkOf((r) => r.p99)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="error rate"
            .value=${formatPercent(run.error_rate)}
            .delta=${this.delta(run.error_rate, prev?.error_rate ?? null)}
            .deltaTone=${"bad"}
            dot="blush"
            .spark=${this.sparkOf((r) => r.error_rate)}
          ></broadside-kpi-card>
        </div>

        <div class="filters">
          <broadside-endpoint-select
            .runId=${run.id}
            .value=${this.endpoint}
            @endpoint-change=${this.onEndpointChange}
          ></broadside-endpoint-select>
          <label class="field">
            <span class="label">Granularity</span>
            <select
              class="select"
              .value=${this.granularity}
              @change=${(e: Event) => {
                this.granularity = (e.target as HTMLSelectElement)
                  .value as Granularity;
                this.zoomByPanel = new Map();
                this.rawByPanel = new Map();
                void this.loadMetrics();
              }}
            >
              <option value="1m">1 minute</option>
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
            </select>
          </label>
        </div>

        <div class="grid">
          <broadside-chart-panel
            title="requests / second"
            .series=${this.seriesFor("rps")}
            yFormat="req/s"
            yLabel="req/s"
            .fill=${true}
            .zoomed=${zoomDomain("rps") !== null}
            .domain=${zoomDomain("rps")}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "rps")}
            @reset-zoom=${() => this.resetZoom("rps")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="latency percentiles"
            .series=${this.seriesFor("latency")}
            yFormat="ms"
            yLabel="ms"
            .zoomed=${zoomDomain("latency") !== null}
            .domain=${zoomDomain("latency")}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "latency")}
            @reset-zoom=${() => this.resetZoom("latency")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="error rate"
            .series=${this.seriesFor("errors")}
            yFormat="%"
            yLabel="%"
            .fill=${true}
            .zoomed=${zoomDomain("errors") !== null}
            .domain=${zoomDomain("errors")}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "errors")}
            @reset-zoom=${() => this.resetZoom("errors")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="throughput"
            .series=${this.seriesFor("volume")}
            yFormat="req/s"
            yLabel="req/s"
            .fill=${true}
            .zoomed=${zoomDomain("volume") !== null}
            .domain=${zoomDomain("volume")}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "volume")}
            @reset-zoom=${() => this.resetZoom("volume")}
          ></broadside-chart-panel>
        </div>
      </div>

      <broadside-confirm-dialog
        .open=${this.confirmOpen}
        .busy=${this.confirmBusy}
        .title=${run.status === "running" ? "kill run?" : "delete run?"}
        .body=${run.status === "running"
          ? "This will terminate the Artillery process. Partial data may be lost."
          : "This will permanently remove the run and all its metrics."}
        .confirmLabel=${run.status === "running" ? "kill" : "delete"}
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
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-4);
      flex-wrap: wrap;
    }
    .title-block {
      display: flex;
      align-items: center;
      gap: var(--s-3);
    }
    .link-btn {
      background: transparent;
      border: none;
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      cursor: pointer;
      padding: 0;
      transition: color var(--dur-fast) var(--ease);
    }
    .link-btn:hover {
      color: var(--text);
    }
    h3 {
      margin: 0;
      font-size: var(--step-1);
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .header-actions {
      display: flex;
      gap: var(--s-2);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      padding: var(--s-1) var(--s-4);
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
    .btn.danger:hover:not(:disabled) {
      border-color: var(--bad);
      color: var(--bad);
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--s-4);
    }
    .filters {
      display: flex;
      align-items: flex-end;
      gap: var(--s-4);
      flex-wrap: wrap;
    }
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
    }
    .select {
      appearance: none;
      min-width: 140px;
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
  `;
}
