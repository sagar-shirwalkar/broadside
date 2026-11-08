/** API shapes, mirroring the backend rows from src/server/routes/runs.ts. */

export type RunStatus = "running" | "completed" | "failed";

export interface RunRow {
  id: string;
  started_at: string;
  duration_ms: number | null;
  total_requests: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  status: RunStatus;
  config_yaml: string | null;
  json_path: string | null;
}

export interface MetricRow {
  bucket: string;
  endpoint: string;
  rps: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  samples: number;
  /** Per-bucket VU counter deltas (2.31 CAGG sums them per bucket). */
  vusers_started: number | string | null;
  vusers_stopped: number | string | null;
  vusers_created: number | string | null;
  vusers_completed: number | string | null;
  error_count: number | string | null;
  hist_min: number | null;
  hist_max: number | null;
  hist_p75: number | null;
  hist_p90: number | null;
  hist_p999: number | null;
}

export interface RawRow {
  time: string;
  endpoint: string;
  rps: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
  vusers_started: number | string | null;
  vusers_stopped: number | string | null;
  vusers_created: number | string | null;
  vusers_completed: number | string | null;
  error_count: number | string | null;
  hist_min: number | null;
  hist_max: number | null;
  hist_p75: number | null;
  hist_p90: number | null;
  hist_p999: number | null;
}

export interface EndpointRow {
  endpoint: string;
  samples: number;
}

export interface CompareResponse {
  runs: RunRow[];
  series: Array<MetricRow & { run_id: string }>;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  database: { status: "ok" | "error" };
  flusher: { buffered: number; dropped: number; flushed: number };
  timestamp: string;
}

export interface PhaseAnnotation {
  start: string;
  end: string | null;
  name: string;
}

export type Granularity = "10s" | "1m" | "1h" | "1d";

export interface ChartPoint {
  time: number;
  value: number;
}

export interface ChartSeries {
  name: string;
  /** 1-based index into the --chart-line-N custom properties. */
  colorIndex: number;
  points: ChartPoint[];
}

/** Bigints arrive from postgres.js as strings; coerce defensively. */
export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Cumulative sum of a series of nullable counts, in time order. */
export function cumulative(
  rows: Array<{ time: number; value: number | null }>,
): ChartPoint[] {
  const out: ChartPoint[] = [];
  let acc = 0;
  for (const row of rows) {
    if (row.value === null) continue;
    acc += row.value;
    out.push({ time: row.time, value: acc });
  }
  return out;
}
