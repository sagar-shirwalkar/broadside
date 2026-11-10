import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ref } from "lit/directives/ref.js";
import { api, apiGet, ApiError, RUN_STATUS_EVENT } from "../../services/api.js";
import type {
  ChartPoint,
  ChartSeries,
  EndpointRow,
  Granularity,
  MetricRow,
  PhaseAnnotation,
  RawRow,
  RunRow,
} from "../../types.js";
import { num } from "../../types.js";
import {
  activeVusers,
  cdfFromLatest,
  errorCount,
  histogramFromLatest,
  tailSpread,
  toBucket,
  vusersIo,
} from "../../derived-series.js";
import { decimateForRender } from "../../lttb.js";
import {
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
} from "../../format.js";
import { navigate } from "../../router.js";
import "../../components/kpi-card.js";
import "../../components/chart-panel.js";
import "../../components/endpoint-select.js";
import "../../components/status-dot.js";
import "../../components/select.js";
import "../../components/skeleton.js";
import "../../components/confirm-dialog.js";
import "../not-found/index.js";

type ZoomRange = { from: number; to: number } | null;

const PANELS = ["rps", "latency", "errors", "volume"] as const;
type PanelKey = (typeof PANELS)[number];

const MAX_ENDPOINT_SERIES = 8;

/** Steady-state-friendly tooltips (one scannable line each). */
const INFO = {
  throughput:
    "Requests per second over time — the load the system actually felt.",
  latency:
    "p50 / p95 / p99 latency over time — how slow is the typical, slow and slowest request?",
  errorRate:
    "Failed share of requests per interval — is the error budget holding?",
  activeVusers:
    "started minus stopped, cumulative — the load shape: ramp, hold, teardown. RPS tells you what happened; VUsers tell you why.",
  tailSpread:
    "p99 divided by p50. Flat means the tail tracks the median; a spike means some requests are much slower than others — GC pauses, lock contention, pool exhaustion.",
  cdf:
    "Share of requests at or under each latency. The knee shows where most traffic lands; the long tail shows the outliers. Approximated from the report's percentiles.",
  perEndpoint:
    "p95 latency per endpoint — which endpoint is the problem, without filtering anything away.",
  errorCount:
    "Absolute error count, cumulative. The rate hides volume: 0.1% of 1M requests is still a thousand errors.",
  vusersIo:
    "Created vs. completed VUsers. Created running ahead of completed means in-flight work accumulating — backpressure.",
  histogram:
    "Approximate distribution shape from the report's percentiles — watch for a bimodal shape (two code paths with very different latencies).",
};

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
  @state() private annotations: PhaseAnnotation[] = [];
  @state() private endpointSeries: ChartSeries[] = [];
  /** Per-endpoint fan-out (1 + N requests) only starts once its panel
   *  scrolls near the viewport — keeps first paint to 3–4 queries. */
  @state() private endpointsLoaded = false;
  private endpointObserver: IntersectionObserver | null = null;
  private endpointSentinelBound = false;

  @state() private confirmOpen = false;
  @state() private confirmBusy = false;

  override connectedCallback() {
    super.connectedCallback();
    void this.loadAll();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.endpointObserver?.disconnect();
  }

  /** Arms the per-endpoint fetch when its slot approaches the viewport. */
  private bindEndpointSentinel = (el: Element | undefined) => {
    if (!el || this.endpointSentinelBound || this.endpointsLoaded) return;
    this.endpointSentinelBound = true;
    if (typeof IntersectionObserver === "undefined") {
      void this.loadEndpointSeries();
      return;
    }
    this.endpointObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.endpointObserver?.disconnect();
          void this.loadEndpointSeries();
        }
      },
      { rootMargin: "200px" },
    );
    this.endpointObserver.observe(el);
  };

  private async loadAll() {
    this.loading = true;
    try {
      this.run = await apiGet<RunRow>(
        `/api/runs/${encodeURIComponent(this.runId)}`,
      );
      // A 1-minute rollup collapses sub-2-minute runs into a single
      // bucket — offer the 10s CAGG instead so charts have shape.
      this.granularity =
        (this.run.duration_ms ?? Infinity) < 120_000 ? "10s" : "1m";
      window.dispatchEvent(
        new CustomEvent(RUN_STATUS_EVENT, {
          detail: this.run.status,
          bubbles: true,
          composed: true,
        }),
      );
      // Deliberately NOT loadEndpointSeries — see the sentinel observer.
      await Promise.all([
        this.loadMetrics(),
        this.loadPrevious(),
        this.loadAnnotations(),
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

  /** The rows for the selected endpoint only. Without this filter, the
   *  aggregate and per-endpoint rows blend into a single muddy series
   *  and cumulative VUs/error counts double-count. */
  private viewRows(): MetricRow[] {
    return this.rows.filter((r) => (r.endpoint ?? "") === this.endpoint);
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

  private async loadAnnotations() {
    try {
      this.annotations = await apiGet<PhaseAnnotation[]>(
        `/api/runs/${encodeURIComponent(this.runId)}/phases`,
      );
    } catch {
      this.annotations = [];
    }
  }

  /** Multi-line p95, one color per endpoint, via the metrics-by-endpoint
   *  plugin data. Empty when the plugin produced nothing. */
  private async loadEndpointSeries() {
    try {
      const endpoints = await apiGet<EndpointRow[]>(
        `/api/runs/${encodeURIComponent(this.runId)}/endpoints`,
      );
      const picked = endpoints.slice(0, MAX_ENDPOINT_SERIES);
      const series = await Promise.all(
        picked.map(async (e, i) => {
          const params = new URLSearchParams({
            granularity: this.granularity,
            endpoint: e.endpoint,
          });
          const rows = await apiGet<MetricRow[]>(
            `/api/runs/${encodeURIComponent(this.runId)}/metrics?${params}`,
          );
          const points = rows
            .map((r) => ({
              time: new Date(r.bucket).getTime(),
              value: num(r.p95),
            }))
            .filter((p): p is { time: number; value: number } => p.value !== null);
          return {
            name: e.endpoint,
            colorIndex: (i % 5) + 1,
            points,
          } satisfies ChartSeries;
        }),
      );
      this.endpointSeries = series.filter((s) => s.points.length > 0);
      this.endpointsLoaded = true;
    } catch {
      this.endpointSeries = [];
      this.endpointsLoaded = true;
    }
  }

  private points(
    rows: MetricRow[],
    pick: (r: MetricRow) => number | null,
  ): ChartPoint[] {
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
    const rows = this.viewRows();
    switch (key) {
      case "rps":
        return [{ name: "req/s", colorIndex: 1, points: this.points(rows, (r) => r.rps) }];
      case "latency":
        return [
          { name: "p50", colorIndex: 1, points: this.points(rows, (r) => r.p50) },
          { name: "p95", colorIndex: 2, points: this.points(rows, (r) => r.p95) },
          { name: "p99", colorIndex: 3, points: this.points(rows, (r) => r.p99) },
        ];
      case "errors":
        return [{ name: "error rate", colorIndex: 3, points: this.points(rows, (r) => r.error_rate) }];
      case "volume":
        return [{ name: "req/s", colorIndex: 4, points: this.points(rows, (r) => r.rps) }];
    }
  }

  private rawSeries(key: PanelKey, raw: RawRow[]): ChartSeries[] {
    // Zoomed raw data can be huge; decimate to the render cap (LTTB)
    // before building SVG paths.
    const pts = (pick: (r: RawRow) => number | null) =>
      decimateForRender(
        raw
          .map((r) => ({ time: new Date(r.time).getTime(), value: pick(r) }))
          .filter((p): p is { time: number; value: number } => p.value !== null),
      );
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

  // ─── Derived new-chart series ───

  private buckets() {
    return this.viewRows().map((r) => toBucket(r, new Date(r.bucket).getTime()));
  }

  private activeVusers(): ChartPoint[] {
    return activeVusers(this.buckets());
  }

  private tailSpread(): ChartPoint[] {
    return tailSpread(this.buckets());
  }

  private errorCount(): ChartPoint[] {
    return errorCount(this.buckets());
  }

  private vusersIo(): ChartSeries[] {
    return vusersIo(this.buckets());
  }

  private cdfSeries(): ChartSeries[] {
    return cdfFromLatest(this.buckets());
  }

  private histogramSeries(): ChartSeries[] {
    return histogramFromLatest(this.buckets());
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
    return this.points(this.viewRows(), pick).map((p) => p.value);
  }

  private onEndpointChange(event: CustomEvent<{ endpoint: string }>) {
    this.endpoint = event.detail.endpoint;
    this.zoomByPanel = new Map();
    this.rawByPanel = new Map();
    void this.loadMetrics();
  }

  private onGranularityChange(event: CustomEvent<{ value: string }>) {
    this.granularity = event.detail.value as Granularity;
    this.zoomByPanel = new Map();
    this.rawByPanel = new Map();
    void this.loadMetrics();
    if (this.endpointsLoaded) void this.loadEndpointSeries();
  }

  private async doDelete() {
    this.confirmBusy = true;
    try {
      await api(`/api/runs/${encodeURIComponent(this.runId)}`, {
        method: "DELETE",
      });
      this.confirmOpen = false;
      navigate("/runs");
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
            <button class="link-btn" @click=${() => navigate("/runs")}>
              ← runs
            </button>
            <h3 class="mono">${run.id.slice(0, 8)}</h3>
          </div>
          <div class="header-actions">
            ${run.status === "running"
              ? html`<button
                  class="btn status-btn"
                  @click=${() => navigate(`/runs/${run.id}/live`)}
                  title="watch this run live"
                >
                  <broadside-status-dot tone="warn" pulse></broadside-status-dot>
                  live
                </button>`
              : html`<span class="run-status ${run.status === "failed" ? "bad" : "ok"}">
                  <broadside-status-dot
                    tone=${run.status === "failed" ? "bad" : "ok"}
                  ></broadside-status-dot>
                  ${run.status}
                </span>`}
            <button
              class="btn danger icon-text-btn"
              @click=${() => (this.confirmOpen = true)}
            >
              <svg
                class="icon"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path d="M3 4h10M6 4V3h4v1M5 4v8h6V4M7 6v4M9 6v4" />
              </svg>
              ${run.status === "running" ? "kill" : "delete"}
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
            label="errors"
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
          <broadside-select
            label="Granularity"
            .options=${[
              { value: "10s", label: "10 seconds" },
              { value: "1m", label: "1 minute" },
              { value: "1h", label: "1 hour" },
              { value: "1d", label: "1 day" },
            ]}
            .value=${this.granularity}
            @change=${this.onGranularityChange}
          ></broadside-select>
        </div>

        <div class="grid">
          <broadside-chart-panel
            title="throughput"
            .info=${INFO.throughput}
            .series=${this.seriesFor("rps")}
            yFormat="req/s"
            yLabel="req/s"
            .fill=${true}
            .zoomed=${zoomDomain("rps") !== null}
            .domain=${zoomDomain("rps")}
            .annotations=${this.annotations}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "rps")}
            @reset-zoom=${() => this.resetZoom("rps")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="latency percentiles"
            .info=${INFO.latency}
            .series=${this.seriesFor("latency")}
            yFormat="ms"
            yLabel="ms"
            .zoomed=${zoomDomain("latency") !== null}
            .domain=${zoomDomain("latency")}
            .annotations=${this.annotations}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "latency")}
            @reset-zoom=${() => this.resetZoom("latency")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="error rate"
            .info=${INFO.errorRate}
            .series=${this.seriesFor("errors")}
            yFormat="%"
            yLabel="%"
            .fill=${true}
            .zoomed=${zoomDomain("errors") !== null}
            .domain=${zoomDomain("errors")}
            .annotations=${this.annotations}
            @zoom=${(e: CustomEvent) => void this.onZoom(e, "errors")}
            @reset-zoom=${() => this.resetZoom("errors")}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="active virtual users"
            .info=${INFO.activeVusers}
            .series=${[{ name: "active vusers", colorIndex: 4, points: this.activeVusers() }]}
            yFormat="count"
            yLabel="vusers"
            .fill=${true}
            .annotations=${this.annotations}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="tail latency spread"
            .info=${INFO.tailSpread}
            .series=${[{ name: "p99 / p50", colorIndex: 2, points: this.tailSpread() }]}
            yFormat="count"
            yLabel="×"
            .fill=${true}
            .annotations=${this.annotations}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="latency CDF"
            .info=${INFO.cdf}
            .series=${this.cdfSeries()}
            yFormat="%"
            yLabel="share"
            kind="step"
            xFormat="number"
            .fill=${true}
          ></broadside-chart-panel>
          <div class="sentinel" ${ref(this.bindEndpointSentinel)}>
            ${this.endpointsLoaded
              ? this.endpointSeries.length > 0
                ? html`<broadside-chart-panel
                    title="per-endpoint p95"
                    .info=${INFO.perEndpoint}
                    .series=${this.endpointSeries}
                    yFormat="ms"
                    yLabel="ms"
                    kind="line"
                    .annotations=${this.annotations}
                  ></broadside-chart-panel>`
                : html`<div class="card hint-card">
                    <span class="hint-title">per-endpoint p95</span>
                    <p class="hint">enable the metrics-by-endpoint plugin in your Artillery YAML for per-endpoint charts</p>
                  </div>`
              : html`<broadside-skeleton variant="chart"></broadside-skeleton>`}
          </div>
          <broadside-chart-panel
            title="error count"
            .info=${INFO.errorCount}
            .series=${[{ name: "errors", colorIndex: 3, points: this.errorCount() }]}
            yFormat="count"
            yLabel="errors"
            .fill=${true}
            .annotations=${this.annotations}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="vusers created vs completed"
            .info=${INFO.vusersIo}
            .series=${this.vusersIo()}
            yFormat="count"
            yLabel="vusers"
            .annotations=${this.annotations}
          ></broadside-chart-panel>
          <broadside-chart-panel
            title="latency histogram"
            .info=${INFO.histogram}
            .series=${this.histogramSeries()}
            yFormat="%"
            yLabel="share"
            kind="bars"
            xFormat="number"
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
      min-width: 0;
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
      color: var(--amber);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      cursor: pointer;
      padding: 0;
      transition: color var(--dur-fast) var(--ease);
    }
    .link-btn:hover {
      color: var(--amber-dim);
    }
    .icon-text-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--s-1);
    }
    .icon-text-btn .icon {
      flex: none;
    }
    h3 {
      margin: 0;
      font-size: var(--step-1);
      font-weight: 500;
      letter-spacing: 0.01em;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .status-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
    }
    .run-status {
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: var(--s-1) var(--s-3);
    }
    .run-status.ok {
      color: var(--ok);
    }
    .run-status.bad {
      color: var(--bad);
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
      gap: var(--s-4);
    }
    @media (min-width: 700px) {
      .kpis {
        grid-template-columns: repeat(6, 1fr);
      }
    }
    @media (max-width: 699px) {
      .kpis {
        grid-template-columns: repeat(2, 1fr);
      }
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
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--s-4);
      min-width: 0;
    }
    .grid > * {
      min-width: 0;
    }
    @media (max-width: 1024px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .hint-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-5);
      min-width: 0;
    }
    .hint-title {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: var(--s-3);
    }
    .hint {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      line-height: 1.6;
    }
  `;
}
