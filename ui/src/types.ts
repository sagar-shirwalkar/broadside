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
}

export interface RawRow {
  time: string;
  endpoint: string;
  rps: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  error_rate: number | null;
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

export type Granularity = "1m" | "1h" | "1d";

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
