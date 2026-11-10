import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { apiGet, RUN_STATUS_EVENT, sseUrl } from "../api.js";
import {
  activeVusers,
  cdfFromLatest,
  errorCount,
  histogramFromLatest,
  tailSpread,
  toBucket,
  vusersIo,
} from "../derived-series.js";
import type { ChartSeries, RawRow, RunRow } from "../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent } from "../format.js";
import { navigate } from "../router.js";
import "../components/chart-panel.js";
import "../components/endpoint-select.js";
import "../components/skeleton.js";
import "../components/status-dot.js";

interface LivePoint {
  time: string;
  endpoint: string;
  rps: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  vusers_started?: number | string | null;
  vusers_stopped?: number | string | null;
  vusers_created?: number | string | null;
  vusers_completed?: number | string | null;
  error_count?: number | string | null;
  hist_min?: number | null;
  hist_max?: number | null;
  hist_p75?: number | null;
  hist_p90?: number | null;
  hist_p999?: number | null;
}

const BUFFER = 600; // 10 min at 1 Hz

/** The server is the only writer of this stream, but a malformed event must
 *  not kill the listener (and with it, the whole live feed). */
function parseSsePayload<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

@customElement("broadside-live-view")
export class LiveView extends LitElement {
  @property() runId = "";

  @state() private points: LivePoint[] = [];
  @state() private finished: RunRow | null = null;
  @state() private reconnecting = false;
  @state() private endpoint = "";
  @state() private bootstrapping = true;

  private source: EventSource | null = null;

  override connectedCallback() {
    super.connectedCallback();
    window.dispatchEvent(
      new CustomEvent(RUN_STATUS_EVENT, {
        detail: "running",
        bubbles: true,
        composed: true,
      }),
    );
    void this.seed();
    this.connect();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.source?.close();
    this.source = null;
  }

  /** Seed from already-flushed data so the charts are not empty while the
   *  stream catches up. */
  private async seed() {
    try {
      const since = new Date(Date.now() - BUFFER * 1000).toISOString();
      const raw = await apiGet<RawRow[]>(
        `/api/runs/${encodeURIComponent(this.runId)}/raw?from=${since}`,
      );
      if (raw.length) {
        this.points = [...this.points, ...raw].slice(-BUFFER);
      }
    } catch {
      // The live stream itself reports failures; seeding is best-effort.
    } finally {
      this.bootstrapping = false;
    }
  }

  private connect() {
    const params = new URLSearchParams({ interval_ms: "1000" });
    if (this.endpoint !== "") params.set("endpoint", this.endpoint);
    const url = sseUrl(
      `/api/runs/${encodeURIComponent(this.runId)}/live?${params}`,
    );
    const source = new EventSource(url);
    this.source = source;

    source.addEventListener("metric", (event) => {
      const data = parseSsePayload<LivePoint>((event as MessageEvent).data);
      if (!data) return;
      this.points = [...this.points, data].slice(-BUFFER);
      this.reconnecting = false;
    });

    source.addEventListener("run", (event) => {
      const summary = parseSsePayload<{
        status: RunRow["status"];
        duration_ms: number | null;
        total_requests: number | null;
        p50: number | null;
        p95: number | null;
        p99: number | null;
        error_rate: number | null;
      }>((event as MessageEvent).data);
      if (!summary) return;
      this.finished = {
        id: this.runId,
        started_at: "",
        config_yaml: null,
        json_path: null,
        ...summary,
      };
      window.dispatchEvent(
        new CustomEvent(RUN_STATUS_EVENT, {
          detail: summary.status,
          bubbles: true,
          composed: true,
        }),
      );
      source.close();
    });

    source.onerror = () => {
      // EventSource retries on its own; flag the overlay while it does.
      if (!this.finished) {
        this.reconnecting = source.readyState === EventSource.CONNECTING;
      }
    };
  }

  private series(pick: (p: LivePoint) => number | null, endpoint: string): ChartSeries[] {
    const rows = this.points.filter((p) => p.endpoint === endpoint);
    const points = rows
      .map((p) => ({ time: new Date(p.time).getTime(), value: pick(p) }))
      .filter((p): p is { time: number; value: number } => p.value !== null);
    return [{ name: endpoint || "aggregate", colorIndex: 1, points }];
  }

  private latencySeries(): ChartSeries[] {
    const rows = this.points.filter((p) => p.endpoint === "");
    const pts = (pick: (p: LivePoint) => number | null) =>
      rows
        .map((p) => ({ time: new Date(p.time).getTime(), value: pick(p) }))
        .filter((p): p is { time: number; value: number } => p.value !== null);
    return [
      { name: "p50", colorIndex: 1, points: pts((p) => p.p50) },
      { name: "p95", colorIndex: 2, points: pts((p) => p.p95) },
      { name: "p99", colorIndex: 3, points: pts((p) => p.p99) },
    ];
  }

  /** Aggregate buckets in time order for the derived charts. */
  private buckets() {
    return this.points
      .filter((p) => p.endpoint === "")
      .map((p) =>
        toBucket(
          {
            vusers_created: p.vusers_created ?? null,
            vusers_completed: p.vusers_completed ?? null,
            error_count: p.error_count ?? null,
            p50: p.p50,
            p95: p.p95,
            p99: p.p99,
            hist_min: p.hist_min ?? null,
            hist_max: p.hist_max ?? null,
            hist_p75: p.hist_p75 ?? null,
            hist_p90: p.hist_p90 ?? null,
            hist_p999: p.hist_p999 ?? null,
          },
          new Date(p.time).getTime(),
        ),
      );
  }

  override render() {
    const aggregate = this.series((p) => p.rps, "");
    const endpointSeries =
      this.endpoint === "" ? [] : this.series((p) => p.rps, this.endpoint);
    const errorSeries = this.series((p) => p.error_rate, "");
    const buckets = this.buckets();

    return html`
      <div class="page">
        <div class="header">
          <div class="title-block">
            <button class="link-btn" @click=${() => navigate("/runs")}>
              ← runs
            </button>
            <h3 class="mono">${this.runId.slice(0, 8)}</h3>
            ${this.finished
              ? html`<span class="status ${this.finished.status === "failed" ? "bad" : "ok"}">
                  <broadside-status-dot
                    tone=${this.finished.status === "failed" ? "bad" : "ok"}
                  ></broadside-status-dot>
                  ${this.finished.status}
                </span>`
              : html`<span class="status warn">
                  <broadside-status-dot tone="warn" pulse></broadside-status-dot>
                  live
                </span>`}
          </div>
          <broadside-endpoint-select
            .runId=${this.runId}
            .value=${this.endpoint}
            @endpoint-change=${(e: CustomEvent<{ endpoint: string }>) => {
              this.endpoint = e.detail.endpoint;
              this.source?.close();
              this.connect();
            }}
          ></broadside-endpoint-select>
        </div>

        ${this.reconnecting
          ? html`<p class="notice">⚠ stream disconnected — reconnecting…</p>`
          : ""}
        ${this.finished
          ? html`<p class="notice ${this.finished.status === "failed" ? "notice-bad" : "notice-ok"}">
              ${this.finished.status === "failed" ? "✕" : "✓"} run
              ${this.finished.status} — ${formatDuration(this.finished.duration_ms)},
              ${formatNumber(this.finished.total_requests)} requests,
              p95 ${formatMs(this.finished.p95)},
              errors ${formatPercent(this.finished.error_rate)}.
              <a href="#/runs/${this.runId}">view full report →</a>
            </p>`
          : ""}

        ${this.bootstrapping && this.points.length === 0
          ? html`<broadside-skeleton variant="chart"></broadside-skeleton>`
          : html`<div class="grid">
              <broadside-chart-panel
                title="throughput"
                .info=${"Requests per second over time — the load the system actually felt."}
                .series=${[...aggregate, ...endpointSeries]}
                yFormat="req/s"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="latency percentiles"
                .info=${"p50 / p95 / p99 latency over time — how slow is the typical, slow and slowest request?"}
                .series=${this.latencySeries()}
                yFormat="ms"
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="error rate"
                .info=${"Failed share of requests per interval — is the error budget holding?"}
                .series=${errorSeries}
                yFormat="%"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="active virtual users"
                .info=${"started minus stopped, cumulative — the load shape: ramp, hold, teardown. RPS tells you what happened; VUsers tell you why."}
                .series=${[{ name: "active vusers", colorIndex: 4, points: activeVusers(buckets) }]}
                yFormat="count"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="tail latency spread"
                .info=${"p99 divided by p50. Flat means the tail tracks the median; a spike means some requests are much slower than others."}
                .series=${[{ name: "p99 / p50", colorIndex: 2, points: tailSpread(buckets) }]}
                yFormat="count"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="error count"
                .info=${"Absolute error count, cumulative. The rate hides volume: 0.1% of 1M requests is still a thousand errors."}
                .series=${[{ name: "errors", colorIndex: 3, points: errorCount(buckets) }]}
                yFormat="count"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="vusers created vs completed"
                .info=${"Created vs. completed VUsers. Created running ahead of completed means in-flight work accumulating — backpressure."}
                .series=${vusersIo(buckets)}
                yFormat="count"
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="latency CDF"
                .info=${"Share of requests at or under each latency. The knee shows where most traffic lands; the long tail shows the outliers. Approximated from the report's percentiles."}
                .series=${cdfFromLatest(buckets)}
                yFormat="%"
                kind="step"
                xFormat="number"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="latency histogram"
                .info=${"Approximate distribution shape from the report's percentiles."}
                .series=${histogramFromLatest(buckets)}
                yFormat="%"
                kind="bars"
                xFormat="number"
              ></broadside-chart-panel>
            </div>`}
      </div>
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
    h1 {
      margin: 0;
      font-size: var(--step-3);
    }
    .status {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
    }
    .status.ok {
      color: var(--ok);
    }
    .status.bad {
      color: var(--bad);
    }
    .status.warn {
      color: var(--warn);
    }
    .notice {
      margin: 0;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--warn);
      background: var(--surface);
      border: 1px solid var(--border);
      border-left: 4px solid var(--warn);
      border-radius: var(--radius);
      padding: var(--s-3);
    }
    .notice-ok {
      color: var(--ok);
      border-left-color: var(--ok);
    }
    .notice-bad {
      color: var(--bad);
      border-left-color: var(--bad);
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
