import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { apiGet } from "../api.js";
import { navigate } from "../router.js";
import type { ChartPoint, ChartSeries } from "../types.js";
import "../components/line-chart.js";
import "../components/kpi-card.js";
import "../components/chart-panel.js";
import "../components/info-tip.js";
import "../components/status-dot.js";
import "../components/select.js";

interface SloEntry {
  key: string;
  label: string;
  threshold: number;
  unit: string;
  total: number;
  met: number;
  metPct: number;
  status: "pass" | "warn" | "fail" | "nodata";
}

interface TrendPoint {
  time: string;
  value: number;
  runId: string;
}

interface FrequencyPoint {
  day: string;
  runs: number;
}

interface WorstEndpoint {
  endpoint: string;
  avgP95: number;
  avgErrorRate: number;
  runs: number;
}

interface Regression {
  endpoint: string;
  latestP95: number;
  baselineP95: number;
  deltaPct: number;
  runId: string;
  baselineRuns: number;
}

interface RecentRun {
  id: string;
  started_at: string;
  duration_ms: number | null;
  total_requests: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  status: string;
}

interface Overview {
  slo: SloEntry[];
  trends: { p95: TrendPoint[]; errorRate: TrendPoint[] };
  frequency: FrequencyPoint[];
  worst: WorstEndpoint[];
  regressions: Regression[];
  recentRuns: RecentRun[];
  meta: { trendDays: number; frequencyInterval: string };
}

const TREND_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

const FREQUENCY_OPTIONS = [
  { value: "day", label: "per day" },
  { value: "week", label: "per week" },
];

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Math.round(v)}ms`;
}

function sloStatusCopy(status: SloEntry["status"]): string {
  switch (status) {
    case "pass":
      return "met";
    case "warn":
      return "at risk";
    case "fail":
      return "missed";
    case "nodata":
      return "no data";
  }
}

function latestRunCaption(point: TrendPoint | undefined): string {
  if (!point) return "";
  return `Latest: ${new Date(point.time).toLocaleDateString()} · ${point.runId.slice(0, 12)}`;
}

function statusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "completed") return "ok";
  if (status === "failed") return "bad";
  return "warn";
}

/**
 * Overview landing page: "are we drifting?" — the SLO strip, the
 * per-run p95/error trend, run cadence, worst endpoints, recent
 * runs, and regression alerts. Single GET of /api/overview; empty
 * states everywhere so a fresh install looks right.
 */
@customElement("broadside-overview-view")
export class OverviewView extends LitElement {
  @state() private data: Overview | null = null;
  @state() private error: string | null = null;
  @state() private trendDays = "30";
  @state() private frequencyInterval = "week";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    this.error = null;
    try {
      this.data = await apiGet<Overview>(
        `/api/overview?days=${this.trendDays}&frequency=${this.frequencyInterval}`,
      );
    } catch {
      this.error = "Could not load overview data";
    }
  }

  private onTrendDays(e: CustomEvent<{ value: string }>) {
    this.trendDays = e.detail.value;
    void this.load();
  }

  private onFrequency(e: CustomEvent<{ value: string }>) {
    this.frequencyInterval = e.detail.value;
    void this.load();
  }

  /** Aggregate SLO status: average met-rate across all SLOs. */
  private sloSummary(): { pct: number; tone: "ok" | "warn" | "bad" | "nodata"; target: string } {
    const slo = this.data?.slo ?? [];
    if (!slo.length || slo.every((s) => s.total === 0)) {
      return { pct: 0, tone: "nodata", target: "—" };
    }
    const avg = slo.reduce((acc, s) => acc + s.metPct, 0) / slo.length;
    const tone = avg >= 0.9 ? "ok" : avg >= 0.75 ? "warn" : "bad";
    const targets = slo
      .map((s) =>
        s.unit === "ms"
          ? `p95 ≤ ${s.threshold}ms`
          : `errors ≤ ${(s.threshold * 100).toFixed(1)}%`,
      )
      .join(" · ");
    return { pct: avg, tone, target: targets };
  }

  private sloStrip() {
    const { pct: pctVal, tone, target } = this.sloSummary();
    const pctText = tone === "nodata" ? "—" : `${Math.round(pctVal * 100)}%`;
    return html`
      <div class="slo-strip">
        <span class="slo-left">
          <span class="slo-label">SLO Status</span>
          <broadside-status-dot tone=${tone}></broadside-status-dot>
          <span class="slo-value">${pctText}</span>
        </span>
        <span class="slo-right">
          <span class="slo-target-label">SLO Target</span>
          <span class="slo-target">${target}</span>
          <broadside-info-tip
            .text=${"The Service Level Objective percentage indicates current performance against its defined reliability target."}
            .label=${"about SLO status"}
          ></broadside-info-tip>
        </span>
      </div>
    `;
  }

  private sloCards() {
    if (!this.data?.slo.length) {
      return html`<div class="panel muted">No runs yet — SLOs need history.</div>`;
    }
    return this.data.slo.map((s) => {
      const tone =
        s.status === "pass"
          ? "mint"
          : s.status === "warn"
            ? "peach"
            : s.status === "fail"
              ? "blush"
              : "peach";
      const unit =
        s.unit === "ms" ? `≤ ${s.threshold}ms` : `≤ ${(s.threshold * 100).toFixed(1)}%`;
      const value =
        s.total === 0 ? "—" : `${Math.round(s.metPct * 100)}%`;
      const hint =
        s.total === 0
          ? "no completed runs yet"
          : `${s.met} of ${s.total} last runs meet ${s.label} ${unit}`;
      return html`<broadside-kpi-card
        label=${`SLO — ${s.label}`}
        value=${value}
        hint=${sloSummary(s, hint)}
        dot=${tone}
        .spark=${[]}
      ></broadside-kpi-card>`;
    });
  }

  private trends() {
    const p95 = this.data?.trends.p95 ?? [];
    const err = this.data?.trends.errorRate ?? [];
    const points = (pts: TrendPoint[]): ChartPoint[] =>
      pts.map((p) => ({ time: new Date(p.time).getTime(), value: p.value }));
    const now = Date.now();
    const domain: [number, number] = [now - Number(this.trendDays) * 86400_000, now];
    return html`
      <broadside-chart-panel
        title="Trend: p95 over time"
        .info=${"The single most important chart. One point per run — a slow upward drift is invisible in individual run views but obvious here."}
      >
        <div slot="controls">
          <broadside-select
            .options=${TREND_OPTIONS}
            .value=${this.trendDays}
            @change=${this.onTrendDays}
          ></broadside-select>
        </div>
        <broadside-line-chart
          .series=${[{ name: "p95", colorIndex: 1, points: points(p95) } satisfies ChartSeries]}
          yFormat="ms"
          xFormat="time"
          .showDots=${true}
          .domain=${domain}
          height=${200}
        ></broadside-line-chart>
        <div class="chart-footer">${latestRunCaption(p95.at(-1))}</div>
      </broadside-chart-panel>
      <broadside-chart-panel
        title="Trend: error rate"
        .info=${"Catches 'still fast but starting to fail' — errors creeping up while latency looks fine."}
      >
        <div slot="controls">
          <broadside-select
            .options=${TREND_OPTIONS}
            .value=${this.trendDays}
            @change=${this.onTrendDays}
          ></broadside-select>
        </div>
        <broadside-line-chart
          .series=${[{ name: "error rate", colorIndex: 4, points: points(err) } satisfies ChartSeries]}
          yFormat="%"
          xFormat="time"
          .showDots=${true}
          .domain=${domain}
          height=${200}
        ></broadside-line-chart>
        <div class="chart-footer">${latestRunCaption(err.at(-1))}</div>
      </broadside-chart-panel>
    `;
  }

  private frequency() {
    const pts: ChartPoint[] = (this.data?.frequency ?? []).map((f) => ({
      time: new Date(f.day).getTime(),
      value: f.runs,
    }));
    const now = Date.now();
    const domain: [number, number] = [now - 30 * 86400_000, now];
    return html`
      <broadside-chart-panel
        title="Run frequency"
        .info=${"Testing cadence. A gap means nobody is running load tests — coverage you think you have, you don't."}
      >
        <div slot="controls">
          <broadside-select
            .options=${FREQUENCY_OPTIONS}
            .value=${this.frequencyInterval}
            @change=${this.onFrequency}
          ></broadside-select>
        </div>
        <broadside-line-chart
          .series=${[{ name: "runs", colorIndex: 2, points: pts } satisfies ChartSeries]}
          yFormat="count"
          xFormat="time"
          kind="bars"
          .domain=${domain}
          height=${160}
        ></broadside-line-chart>
      </broadside-chart-panel>
    `;
  }

  private worst() {
    const rows = this.data?.worst ?? [];
    if (!rows.length) {
      return html`<div class="panel muted">No per-endpoint data yet.</div>`;
    }
    return html`
      <div class="panel table-wrap">
        <div class="panel-head">Worst endpoints <span class="muted">(avg p95, last 30 days)</span></div>
        <table class="data-table" aria-label="Worst endpoints">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Avg p95</th>
              <th>Avg errors</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr>
                <td class="mono">${r.endpoint}</td>
                <td>${ms(r.avgP95)}</td>
                <td>${pct(r.avgErrorRate)}</td>
                <td>${r.runs}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  private regressions() {
    const regs = this.data?.regressions ?? [];
    if (!regs.length) {
      return html`<div class="panel muted">No regressions detected — every endpoint within 20% of its rolling median.</div>`;
    }
    return html`
      <div class="panel table-wrap">
        <div class="panel-head">Regression alerts</div>
        <ul class="alert-list">
          ${regs.map(
            (r) => html`<li>
              <span class="mono">${r.endpoint}</span>
              <span class="alert-delta">+${Math.round(r.deltaPct)}%</span>
              <span class="muted">
                ${Math.round(r.latestP95)}ms vs ${Math.round(r.baselineP95)}ms
                baseline (${r.baselineRuns} runs)
              </span>
              <a href="#/runs/${encodeURIComponent(r.runId)}" @click=${(e: Event) => {
                e.preventDefault();
                navigate(`/runs/${encodeURIComponent(r.runId)}`);
              }}>run →</a>
            </li>`,
          )}
        </ul>
      </div>
    `;
  }

  private recentRuns() {
    const rows = this.data?.recentRuns ?? [];
    if (!rows.length) {
      return html`<div class="panel muted">No runs yet. Launch one with ▶ New Run.</div>`;
    }
    return html`
      <div class="panel table-wrap">
        <div class="panel-head">Recent runs</div>
        <table class="data-table" aria-label="Recent runs">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>p95</th>
              <th>Errors</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) => html`<tr @click=${() => navigate(`/runs/${encodeURIComponent(r.id)}`)}>
                <td>${new Date(r.started_at).toLocaleString()}</td>
                <td class="status-cell">
                  <broadside-status-dot
                    tone=${statusTone(r.status)}
                    .pulse=${r.status === "running"}
                  ></broadside-status-dot>
                  ${r.status}
                </td>
                <td>${ms(r.p95)}</td>
                <td>${pct(r.error_rate)}</td>
                <td>${r.duration_ms === null ? "—" : `${(r.duration_ms / 1000).toFixed(1)}s`}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  override render() {
    if (this.error) {
      return html`<div class="panel error">${this.error}</div>`;
    }
    if (!this.data) {
      return html`<div class="panel muted">Loading overview…</div>`;
    }
    return html`
      <section class="slo-strip-wrap">${this.sloStrip()}</section>
      <section class="grid-slos">
        ${this.sloCards()}
      </section>
      <section class="grid-2">${this.trends()}</section>
      <section class="grid-2">${this.frequency()}${this.regressions()}</section>
      <section class="grid-2">${this.worst()}${this.recentRuns()}</section>
    `;
  }

  static styles = css`
    :host {
      display: block;
      color: var(--text-primary);
    }
    .slo-strip-wrap {
      margin-bottom: 12px;
    }
    .slo-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      padding: var(--s-3) var(--s-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
    }
    .slo-left,
    .slo-right {
      display: inline-flex;
      align-items: center;
      gap: var(--s-3);
    }
    .slo-label,
    .slo-target-label {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .slo-value {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 600;
      color: var(--text);
    }
    .slo-target {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      color: var(--text);
    }
    .grid-slos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      margin-bottom: 12px;
    }
    @media (max-width: 1100px) {
      .grid-2,
      .grid-slos {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .chart-footer {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .table-wrap {
      overflow: auto;
    }
    .panel-head {
      margin: 0 0 10px;
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: var(--tracking-wide);
      color: var(--text-muted);
      padding: 6px 8px;
      border-bottom: 1px solid var(--hairline);
    }
    .data-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--hairline);
      white-space: nowrap;
    }
    .data-table tbody tr {
      cursor: pointer;
    }
    .data-table tbody tr:hover {
      background: var(--surface-2);
    }
    .status-cell {
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .muted {
      color: var(--text-muted);
    }
    .panel {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-xs);
      padding: 12px;
    }
    .panel.error {
      color: var(--red);
      border-color: var(--red);
    }
    .alert-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .alert-list li {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid var(--hairline);
      font-size: 13px;
    }
    .alert-delta {
      color: var(--red);
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .alert-list a {
      color: var(--accent);
      text-decoration: none;
      margin-left: auto;
    }
    .mono {
      font-family: var(--font-mono);
    }
  `;
}

function sloSummary(s: SloEntry, hint: string): string {
  return `${hint} (${sloStatusCopy(s.status)})`;
}
