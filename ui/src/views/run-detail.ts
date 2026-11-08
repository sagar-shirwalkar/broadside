import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/badge/badge.js";
import "@shoelace-style/shoelace/dist/components/select/select.js";
import "@shoelace-style/shoelace/dist/components/option/option.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import { api, apiGet, ApiError } from "../api.js";
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
  formatRps,
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
        return [{ name: "req/min", colorIndex: 4, points: this.points(this.rows, (r) => (r.rps === null ? null : r.rps * 60)) }];
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
        return [{ name: "req/min", colorIndex: 4, points: pts((r) => (r.rps === null ? null : r.rps * 60)) }];
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

    return html`
      <div class="page">
        <div class="header">
          <div class="title-block">
            <sl-button variant="text" size="small" @click=${() => navigate("/")}>
              <sl-icon slot="prefix" name="arrow-left"></sl-icon>
              Runs
            </sl-button>
            <h1 class="mono">${run.id.slice(0, 8)}…</h1>
            ${run.status === "running"
              ? html`<sl-badge variant="success" class="pulse">running</sl-badge>`
              : run.status === "failed"
                ? html`<sl-badge variant="danger">failed</sl-badge>`
                : html`<sl-badge variant="neutral">completed</sl-badge>`}
          </div>
          <div class="header-actions">
            <sl-button
              size="small"
              @click=${() => navigate(`/runs/${run.id}/live`)}
            >
              <sl-icon slot="prefix" name="broadcast"></sl-icon>
              Live
            </sl-button>
            <sl-button
              size="small"
              variant="danger"
              outline
              @click=${() => (this.confirmOpen = true)}
            >
              <sl-icon slot="prefix" name="trash"></sl-icon>
              ${run.status === "running" ? "Kill" : "Delete"}
            </sl-button>
          </div>
        </div>

        <div class="kpis">
          <broadside-kpi-card
            label="Total Requests"
            .value=${formatNumber(run.total_requests)}
            .delta=${this.delta(run.total_requests, prev?.total_requests ?? null)}
            .deltaTone=${"good"}
            chip="mint"
            icon="graph-up"
            .spark=${this.sparkOf((r) => (r.rps === null ? null : r.rps * 60))}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="Duration"
            .value=${formatDuration(run.duration_ms)}
            chip="peach"
            icon="clock"
            hint=${new Date(run.started_at).toLocaleString()}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p50"
            .value=${formatMs(run.p50)}
            .delta=${this.delta(run.p50, prev?.p50 ?? null)}
            .deltaTone=${"good"}
            chip="mint"
            icon="speedometer"
            .spark=${this.sparkOf((r) => r.p50)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p95"
            .value=${formatMs(run.p95)}
            .delta=${this.delta(run.p95, prev?.p95 ?? null)}
            .deltaTone=${"good"}
            chip="peach"
            icon="speedometer"
            .spark=${this.sparkOf((r) => r.p95)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="p99"
            .value=${formatMs(run.p99)}
            .delta=${this.delta(run.p99, prev?.p99 ?? null)}
            .deltaTone=${"good"}
            chip="blush"
            icon="speedometer"
            .spark=${this.sparkOf((r) => r.p99)}
          ></broadside-kpi-card>
          <broadside-kpi-card
            label="Error Rate"
            .value=${formatPercent(run.error_rate)}
            .delta=${this.delta(run.error_rate, prev?.error_rate ?? null)}
            .deltaTone=${"bad"}
            chip="blush"
            icon="exclamation-triangle"
            .spark=${this.sparkOf((r) => r.error_rate)}
          ></broadside-kpi-card>
        </div>

        <div class="filters">
          <broadside-endpoint-select
            .runId=${run.id}
            .value=${this.endpoint}
            @endpoint-change=${this.onEndpointChange}
          ></broadside-endpoint-select>
          <sl-select
            size="small"
            label="Granularity"
            .value=${this.granularity}
            @sl-change=${(e: Event) => {
              this.granularity = (e.target as HTMLSelectElement)
                .value as Granularity;
              this.zoomByPanel = new Map();
              this.rawByPanel = new Map();
              void this.loadMetrics();
            }}
          >
            <sl-option value="1m">1 minute</sl-option>
            <sl-option value="1h">1 hour</sl-option>
            <sl-option value="1d">1 day</sl-option>
          </sl-select>
        </div>

        <div class="grid">
          <broadside-chart-panel
            title="Requests per second"
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
            title="Latency percentiles"
            .series=${this.seriesFor("latency")}
            yFormat="ms"
            yLabel="ms"
            .zoomed=${zoomDomain("latency") !== null}
            .domain=${zoomDomain("latency")}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "latency")}
            @reset-zoom=${() => this.resetZoom("latency")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="Error rate"
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
            title="Throughput (req/min, rps × 60)"
            .series=${this.seriesFor("volume")}
            yFormat="count"
            yLabel="req/min"
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
        .title=${run.status === "running" ? "Kill run?" : "Delete run?"}
        .body=${run.status === "running"
          ? "This will terminate the Artillery process. Partial data may be lost."
          : "This will permanently remove the run and all its metrics."}
        .confirmLabel=${run.status === "running" ? "Kill" : "Delete"}
        @close=${() => (this.confirmOpen = false)}
        @confirm=${() => void this.doDelete()}
      ></broadside-confirm-dialog>
    `;
  }

  static styles = css`
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      flex-wrap: wrap;
    }
    .title-block {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    h1 {
      margin: 0;
      font-size: var(--text-xl);
    }
    .header-actions {
      display: flex;
      gap: var(--space-2);
    }
    .pulse {
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--space-4);
    }
    .filters {
      display: flex;
      align-items: flex-end;
      gap: var(--space-4);
      flex-wrap: wrap;
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
  `;
}
