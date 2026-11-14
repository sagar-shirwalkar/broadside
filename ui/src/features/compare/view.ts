import { html, type TemplateResult } from "lit";
import type { Cmd } from "../../core/types.ts";
import type { ChartSeries, Granularity, MetricRow, RunRow } from "../../types.ts";
import { formatDuration, formatMs, formatNumber, formatPercent, latencyClass } from "../../lib/format.ts";
import {
  activeVusers, cdfFromLatest, errorCount, histogramFromLatest, tailSpread, toBucket, vusersIo, type Bucket,
} from "../../derived-series.ts";
import "../../components/select.js";
import "../../components/chart-panel.js";
import "../../components/skeleton.js";
import { compareRuns, loadEndpointOptions } from "./cmds.ts";
import type { Action, State } from "./types.ts";

const MAX_COMPARE = 5;

function rowsFor(state: State, runId: string): MetricRow[] {
  return [...(state.data!.series ?? [])]
    .filter((row) => row.run_id === runId && (row.endpoint ?? "") === state.endpoint)
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}
function runStartedAt(state: State, runId: string): string {
  return state.data?.runs.find((r) => r.id === runId)?.started_at ?? state.runs.find((r) => r.id === runId)?.started_at ?? new Date(0).toISOString();
}
function runBuckets(state: State, runId: string): Bucket[] {
  const started = new Date(runStartedAt(state, runId)).getTime();
  return rowsFor(state, runId).map((row) => toBucket(row, new Date(row.bucket).getTime() - started));
}
function seriesFor(state: State, pick: (r: MetricRow) => number | null): ChartSeries[] {
  if (!state.data) return [];
  return state.data.runs.map((run, index) => {
    const startedAt = new Date(runStartedAt(state, run.id)).getTime();
    const points = rowsFor(state, run.id)
      .map((row) => ({ time: new Date(row.bucket).getTime() - startedAt, value: pick(row) }))
      .filter((p): p is { time: number; value: number } => p.value !== null);
    return { name: run.id.slice(0, 8), colorIndex: (index % 5) + 1, points };
  });
}
function multiSeries(state: State, pick: (buckets: Bucket[]) => ChartSeries["points"]): ChartSeries[] {
  if (!state.data) return [];
  return state.data.runs.map((run, index) => ({
    name: run.id.slice(0, 8), colorIndex: (index % 5) + 1, points: pick(runBuckets(state, run.id)),
  }));
}
function cdfRun(state: State, runId: string): ChartSeries[] {
  const last = runBuckets(state, runId).at(-1);
  return last ? cdfFromLatest([last]) : [];
}
function histogramRun(state: State, runId: string): ChartSeries[] {
  const last = runBuckets(state, runId).at(-1);
  return last ? histogramFromLatest([last]) : [];
}
function bestIn(state: State, column: (r: RunRow) => number | null, lowest = true): string | null {
  let best: string | null = null;
  let bestValue = lowest ? Infinity : -Infinity;
  for (const run of state.data?.runs ?? []) {
    const value = column(run);
    if (value === null) continue;
    if (lowest ? value < bestValue : value > bestValue) { bestValue = value; best = run.id; }
  }
  return best;
}

export function view(state: State, dispatch: (a: Action) => void, run: (c: Cmd<Action>) => void): TemplateResult {
  const doCompare = () => {
    const ids = [...state.selected];
    if (ids.length < 2) return;
    dispatch({ type: "compare_started" });
    run(compareRuns(ids, state.granularity, state.endpoint));
    if (state.endpoint === "" && ids[0]) run(loadEndpointOptions(ids[0]));
  };
  const bestP95 = bestIn(state, (r) => r.p95);
  const bestP50 = bestIn(state, (r) => r.p50);
  const bestErrors = bestIn(state, (r) => r.error_rate);
  const bestVolume = bestIn(state, (r) => r.total_requests, false);

  return html`
    <div class="page">
      <h1>Compare Runs</h1>
      <div class="card">
        <div class="actions">
          ${state.endpointOptions.length
            ? html`<broadside-select
                label="Endpoint"
                .options=${[{ value: "", label: "all (aggregate)" }, ...state.endpointOptions.map((e) => ({ value: e.endpoint, label: e.endpoint }))]}
                .value=${state.endpoint}
                @change=${(e: CustomEvent<{ value: string }>) => {
                  dispatch({ type: "endpoint_changed", endpoint: e.detail.value });
                  if (state.selected.size >= 2) {
                    dispatch({ type: "compare_started" });
                    run(compareRuns([...state.selected], state.granularity, e.detail.value));
                  }
                }}
              ></broadside-select>`
            : ""}
          <broadside-select
            label="Granularity"
            .options=${[
              { value: "10s", label: "10 seconds" }, { value: "1m", label: "1 minute" },
              { value: "1h", label: "1 hour" }, { value: "1d", label: "1 day" },
            ]}
            .value=${state.granularity}
            @change=${(e: CustomEvent<{ value: string }>) => {
              dispatch({ type: "granularity_changed", granularity: e.detail.value as Granularity });
              if (state.data && state.selected.size >= 2) {
                dispatch({ type: "compare_started" });
                run(compareRuns([...state.selected], e.detail.value as Granularity, state.endpoint));
              }
            }}
          ></broadside-select>
          <span class="count">${state.selected.size} selected (max ${MAX_COMPARE})</span>
          <button class="btn primary" ?disabled=${state.selected.size < 2 || state.loading} @click=${doCompare}>
            ${state.loading ? "loading…" : "compare →"}
          </button>
        </div>

        <div class="picker">
          <table>
            <thead>
              <tr><th>select</th><th>run</th><th>started</th><th>duration</th><th>requests</th><th>p95</th><th>errors</th><th>status</th></tr>
            </thead>
            <tbody>
              ${state.runs.map((run) => {
                const checked = state.selected.has(run.id);
                return html`<tr class=${checked ? "selected" : ""}>
                  <td>
                    <input type="checkbox" .checked=${checked} ?disabled=${!checked && state.selected.size >= MAX_COMPARE}
                      aria-label="Select run ${run.id}"
                      @change=${(e: Event) => dispatch({ type: "toggle_selected", id: run.id, checked: (e.target as HTMLInputElement).checked })} />
                  </td>
                  <td class="mono">${run.id.slice(0, 8)}</td>
                  <td class="muted">${new Date(run.started_at).toLocaleString()}</td>
                  <td>${formatDuration(run.duration_ms)}</td>
                  <td>${formatNumber(run.total_requests)}</td>
                  <td class=${latencyClass(run.p95)}>${formatMs(run.p95)}</td>
                  <td>${formatPercent(run.error_rate)}</td>
                  <td>${run.status}</td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      </div>

      ${state.loading && !state.data
        ? html`<broadside-skeleton variant="chart"></broadside-skeleton>`
        : state.data
          ? html`
              <p class="elapsed-note">time axis: elapsed since each run's own start (t+)</p>
              <div class="grid">
                <broadside-chart-panel title="throughput" .series=${seriesFor(state, (r) => r.rps)} yFormat="req/s" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="p95 latency" .series=${seriesFor(state, (r) => r.p95)} yFormat="ms" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="error rate" .series=${seriesFor(state, (r) => r.error_rate)} yFormat="%" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="active virtual users" .series=${multiSeries(state, (b) => activeVusers(b))} yFormat="count" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="tail latency spread" .series=${multiSeries(state, (b) => tailSpread(b))} yFormat="count" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="error count" .series=${multiSeries(state, (b) => errorCount(b))} yFormat="count" xFormat="elapsed" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="vusers created vs completed" .series=${state.data.runs.flatMap((run, index) => {
                  const io = vusersIo(runBuckets(state, run.id));
                  return io.map((s, j) => ({ name: `${run.id.slice(0, 8)} ${s.name}`, colorIndex: ((index + j) % 5) + 1, points: s.points }));
                })} yFormat="count" xFormat="elapsed"></broadside-chart-panel>
                <broadside-chart-panel title="latency CDF" .series=${state.data.runs.map((run, index) => ({ series: cdfRun(state, run.id)[0], name: run.id.slice(0, 8), colorIndex: (index % 5) + 1 })).filter((s) => s.series).map(({ series, name, colorIndex }) => ({ ...series!, name, colorIndex }))} yFormat="%" kind="step" xFormat="number" .fill=${true}></broadside-chart-panel>
                <broadside-chart-panel title="latency histogram" .series=${state.data.runs.map((run, index) => ({ series: histogramRun(state, run.id)[0], name: run.id.slice(0, 8), colorIndex: (index % 5) + 1 })).filter((s) => s.series).map(({ series, name, colorIndex }) => ({ ...series!, name, colorIndex }))} yFormat="%" kind="bars" xFormat="number"></broadside-chart-panel>
              </div>
              <div class="card table-card">
                <table>
                  <thead><tr><th>run</th><th>p50</th><th>p95</th><th>p99</th><th>error rate</th><th>duration</th><th>total requests</th></tr></thead>
                  <tbody>
                    ${state.data.runs.map((run) => html`<tr>
                      <td class="mono">${run.id.slice(0, 8)}</td>
                      <td class=${bestP50 === run.id ? "best" : ""}>${formatMs(run.p50)}</td>
                      <td class=${bestP95 === run.id ? "best" : ""}>${formatMs(run.p95)}</td>
                      <td>${formatMs(run.p99)}</td>
                      <td class=${bestErrors === run.id ? "best" : ""}>${formatPercent(run.error_rate)}</td>
                      <td>${formatDuration(run.duration_ms)}</td>
                      <td class=${bestVolume === run.id ? "best" : ""}>${formatNumber(run.total_requests)}</td>
                    </tr>`)}
                  </tbody>
                </table>
              </div>
            `
          : ""}
    </div>
  `;
}
