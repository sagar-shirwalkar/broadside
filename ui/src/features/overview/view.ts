import { html, type TemplateResult } from "lit";
import { navigate } from "../../router.js";
import type { ChartPoint, ChartSeries } from "../../types.js";
import type { Cmd } from "../../core/types.js";
import "../../components/line-chart.js";
import "../../components/kpi-card.js";
import "../../components/chart-panel.js";
import "../../components/info-tip.js";
import "../../components/status-dot.js";
import "../../components/select.js";
import { loadOverview } from "./cmds.js";
import type { Action, RecentRun, Regression, SloEntry, State, TrendPoint, WorstEndpoint } from "./types.js";

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

function sloSummary(state: State): { pct: number; tone: "ok" | "warn" | "bad" | "nodata"; target: string } {
  const slo = state.data?.slo ?? [];
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

function sloStrip(state: State): TemplateResult {
  const { pct: pctVal, tone, target } = sloSummary(state);
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

function sloCards(state: State): TemplateResult | TemplateResult[] {
  if (!state.data?.slo.length) {
    return html`<div class="panel muted">No runs yet — SLOs need history.</div>`;
  }
  return state.data.slo.map((s) => {
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
    const value = s.total === 0 ? "—" : `${Math.round(s.metPct * 100)}%`;
    const hintBase =
      s.total === 0
        ? "no completed runs yet"
        : `${s.met} of ${s.total} last runs meet ${s.label} ${unit}`;
    const hint = `${hintBase} (${sloStatusCopy(s.status)})`;
    return html`<broadside-kpi-card
      label=${`SLO — ${s.label}`}
      value=${value}
      hint=${hint}
      dot=${tone}
      .spark=${[]}
    ></broadside-kpi-card>`;
  });
}

function trends(state: State, dispatch: (a: Action) => void, run: (c: Cmd<Action>) => void): TemplateResult {
  const p95 = state.data?.trends.p95 ?? [];
  const err = state.data?.trends.errorRate ?? [];
  const points = (pts: TrendPoint[]): ChartPoint[] =>
    pts.map((p) => ({ time: new Date(p.time).getTime(), value: p.value }));
  const now = Date.now();
  const domain: [number, number] = [now - Number(state.trendDays) * 86400_000, now];
  const onTrendDays = (e: CustomEvent<{ value: string }>) => {
    dispatch({ type: "trend_days_changed", value: e.detail.value });
    run(loadOverview(e.detail.value, state.frequencyInterval));
  };
  return html`
    <broadside-chart-panel
      title="Trend: p95 over time"
      .info=${"The single most important chart. One point per run — a slow upward drift is invisible in individual run views but obvious here."}
      .series=${[{ name: "p95", colorIndex: 1, points: points(p95) } satisfies ChartSeries]}
      yFormat="ms"
      xFormat="time"
      .showDots=${true}
      .showLegend=${false}
      .domain=${domain}
      .height=${200}
    >
      <div slot="controls">
        <broadside-select
          .options=${TREND_OPTIONS}
          .value=${state.trendDays}
          @change=${onTrendDays}
        ></broadside-select>
      </div>
      <div class="chart-footer">${latestRunCaption(p95.at(-1))}</div>
    </broadside-chart-panel>
    <broadside-chart-panel
      title="Trend: error rate"
      .info=${"Catches 'still fast but starting to fail' — errors creeping up while latency looks fine."}
      .series=${[{ name: "error rate", colorIndex: 4, points: points(err) } satisfies ChartSeries]}
      yFormat="%"
      xFormat="time"
      .showDots=${true}
      .showLegend=${false}
      .domain=${domain}
      .height=${200}
    >
      <div slot="controls">
        <broadside-select
          .options=${TREND_OPTIONS}
          .value=${state.trendDays}
          @change=${onTrendDays}
        ></broadside-select>
      </div>
      <div class="chart-footer">${latestRunCaption(err.at(-1))}</div>
    </broadside-chart-panel>
  `;
}

function frequency(state: State, dispatch: (a: Action) => void, run: (c: Cmd<Action>) => void): TemplateResult {
  const pts: ChartPoint[] = (state.data?.frequency ?? []).map((f) => ({
    time: new Date(f.day).getTime(),
    value: f.runs,
  }));
  const now = Date.now();
  const domain: [number, number] = [now - 30 * 86400_000, now];
  const onFrequency = (e: CustomEvent<{ value: string }>) => {
    dispatch({ type: "frequency_changed", value: e.detail.value });
    run(loadOverview(state.trendDays, e.detail.value));
  };
  return html`
    <broadside-chart-panel
      title="Run frequency"
      .info=${"Testing cadence. A gap means nobody is running load tests — coverage you think you have, you don't."}
      .series=${[{ name: "runs", colorIndex: 2, points: pts } satisfies ChartSeries]}
      yFormat="count"
      xFormat="time"
      kind="bars"
      .showLegend=${false}
      .domain=${domain}
      .height=${160}
    >
      <div slot="controls">
        <broadside-select
          .options=${FREQUENCY_OPTIONS}
          .value=${state.frequencyInterval}
          @change=${onFrequency}
        ></broadside-select>
      </div>
    </broadside-chart-panel>
  `;
}

function worst(state: State): TemplateResult {
  const rows = state.data?.worst ?? [];
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
            (r: WorstEndpoint) => html`<tr>
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

function regressions(state: State): TemplateResult {
  const regs = state.data?.regressions ?? [];
  if (!regs.length) {
    return html`<div class="panel muted">No regressions detected — every endpoint within 20% of its rolling median.</div>`;
  }
  return html`
    <div class="panel table-wrap">
      <div class="panel-head">Regression alerts</div>
      <ul class="alert-list">
        ${regs.map(
          (r: Regression) => html`<li>
            <span class="mono">${r.endpoint}</span>
            <span class="alert-delta">+${Math.round(r.deltaPct)}%</span>
            <span class="muted">
              ${Math.round(r.latestP95)}ms vs ${Math.round(r.baselineP95)}ms
              baseline (${r.baselineRuns} runs)
            </span>
            <a class="run-link" href="#/runs/${encodeURIComponent(r.runId)}" @click=${(e: Event) => {
              e.preventDefault();
              navigate(`/runs/${encodeURIComponent(r.runId)}`);
            }}>run →</a>
          </li>`,
        )}
      </ul>
    </div>
  `;
}

function recentRuns(state: State): TemplateResult {
  const rows = state.data?.recentRuns ?? [];
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
            (r: RecentRun) => html`<tr @click=${() => navigate(`/runs/${encodeURIComponent(r.id)}`)}>
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

export function view(state: State, dispatch: (a: Action) => void, run: (c: Cmd<Action>) => void): TemplateResult {
  if (state.error) {
    return html`<div class="panel error">${state.error}</div>`;
  }
  if (state.loading || !state.data) {
    return html`<div class="panel muted">Loading overview…</div>`;
  }
  return html`
    <section class="slo-strip-wrap">${sloStrip(state)}</section>
    <section class="grid-slos">${sloCards(state)}</section>
    <section class="grid-2">${trends(state, dispatch, run)}</section>
    <section class="grid-2">${frequency(state, dispatch, run)}${regressions(state)}</section>
    <section class="grid-2">${worst(state)}${recentRuns(state)}</section>
  `;
}
