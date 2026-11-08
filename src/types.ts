export interface MetricPoint {
  time: Date;
  runId: string;
  endpoint: string;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}

export interface RunSummary {
  id: string;
  startedAt: Date;
  durationMs: number;
  totalRequests: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  status: "running" | "completed" | "failed";
}

export interface QueryParams {
  runId: string;
  granularity: "1m" | "1h" | "1d";
  from?: Date;
  to?: Date;
  endpoint?: string;
}

export interface MetricBatch {
  run_id: string;
  points: MetricPoint[];
}
