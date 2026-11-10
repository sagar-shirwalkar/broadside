import type { Cmd } from "../../core/types.js";
import { api, apiGet, ApiError } from "../../services/api.js";
import type { ChartSeries, EndpointRow, Granularity, MetricRow, PhaseAnnotation, RawRow, RunRow } from "../../types.js";
import { num } from "../../types.js";
import type { Action, PanelKey } from "./types.js";

const MAX_ENDPOINT_SERIES = 8;

export function fetchRun(runId: string): Cmd<Action> {
  return async () => {
    try {
      const run = await apiGet<RunRow>(`/api/runs/${encodeURIComponent(runId)}`);
      return { type: "run_loaded", run };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return { type: "missing" };
      return { type: "loading_done" };
    }
  };
}

export function fetchMetrics(runId: string, granularity: Granularity, endpoint: string): Cmd<Action> {
  return async () => {
    try {
      const params = new URLSearchParams({ granularity });
      if (endpoint !== "") params.set("endpoint", endpoint);
      const rows = await apiGet<MetricRow[]>(`/api/runs/${encodeURIComponent(runId)}/metrics?${params}`);
      return { type: "metrics_loaded", rows };
    } catch {
      return { type: "metrics_loaded", rows: [] };
    }
  };
}

export function fetchPrevious(run: RunRow): Cmd<Action> {
  return async () => {
    try {
      const list = await apiGet<RunRow[]>("/api/runs?limit=100");
      const started = new Date(run.started_at).getTime();
      const previous = list.find((row) => row.id !== run.id && new Date(row.started_at).getTime() < started) ?? null;
      return { type: "previous_loaded", previous };
    } catch {
      return { type: "previous_loaded", previous: null };
    }
  };
}

export function fetchAnnotations(runId: string): Cmd<Action> {
  return async () => {
    try {
      const annotations = await apiGet<PhaseAnnotation[]>(`/api/runs/${encodeURIComponent(runId)}/phases`);
      return { type: "annotations_loaded", annotations };
    } catch {
      return { type: "annotations_loaded", annotations: [] };
    }
  };
}

export function fetchEndpointSeries(runId: string, granularity: Granularity): Cmd<Action> {
  return async () => {
    try {
      const endpoints = await apiGet<EndpointRow[]>(`/api/runs/${encodeURIComponent(runId)}/endpoints`);
      const picked = endpoints.slice(0, MAX_ENDPOINT_SERIES);
      const series = await Promise.all(
        picked.map(async (e, i) => {
          const params = new URLSearchParams({ granularity, endpoint: e.endpoint });
          const rows = await apiGet<MetricRow[]>(`/api/runs/${encodeURIComponent(runId)}/metrics?${params}`);
          const points = rows
            .map((r) => ({ time: new Date(r.bucket).getTime(), value: num(r.p95) }))
            .filter((p): p is { time: number; value: number } => p.value !== null);
          return { name: e.endpoint, colorIndex: (i % 5) + 1, points } satisfies ChartSeries;
        }),
      );
      return { type: "endpoint_series_loaded", series: series.filter((s) => s.points.length > 0) };
    } catch {
      return { type: "endpoint_series_loaded", series: [] };
    }
  };
}

export function fetchZoom(runId: string, key: PanelKey, from: number, to: number, endpoint: string): Cmd<Action> {
  return async () => {
    const params = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    if (endpoint !== "") params.set("endpoint", endpoint);
    const raw = await apiGet<RawRow[]>(`/api/runs/${encodeURIComponent(runId)}/raw?${params}`);
    return { type: "zoom_loaded", key, range: { from, to }, raw };
  };
}

export function deleteRun(runId: string): Cmd<Action> {
  return async () => {
    await api(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
    return { type: "confirm_open", open: false };
  };
}
