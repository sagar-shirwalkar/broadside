import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { apiGet, sseUrl } from "../api.js";
import type { ChartSeries, RawRow, RunRow } from "../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent } from "../format.js";
import { navigate } from "../router.js";
import "../components/chart-panel.js";
import "../components/endpoint-select.js";
import "../components/skeleton.js";

interface LivePoint {
  time: string;
  endpoint: string;
  rps: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
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

  override render() {
    const aggregate = this.series((p) => p.rps, "");
    const endpointSeries =
      this.endpoint === "" ? [] : this.series((p) => p.rps, this.endpoint);
    const errorSeries = this.series((p) => p.error_rate, "");

    return html`
      <div class="page">
        <div class="header">
          <div class="title-block">
            <button class="link-btn" @click=${() => navigate("/")}>
              ← runs
            </button>
            <h1 class="mono">${this.runId.slice(0, 8)}</h1>
            ${this.finished
              ? html`<span class="status ${this.finished.status === "failed" ? "status-failed" : "status-done"}">
                  ${this.finished.status === "failed" ? "✕" : "✓"} ${this.finished.status}
                </span>`
              : html`<span class="status status-running"><span class="dot" aria-hidden="true"></span>live</span>`}
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
                title="requests / second"
                .series=${[...aggregate, ...endpointSeries]}
                yFormat="req/s"
                .fill=${true}
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="latency percentiles"
                .series=${this.latencySeries()}
                yFormat="ms"
              ></broadside-chart-panel>
              <broadside-chart-panel
                title="error rate"
                .series=${errorSeries}
                yFormat="%"
                .fill=${true}
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
    .status .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 8px var(--ok);
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
