export interface MetricPoint {
  time: Date;
  runId: string;
  endpoint: string;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  /** Per-bucket VU counters (deltas); summed by the CAGGs. */
  vusersStarted?: number;
  vusersStopped?: number;
  vusersCreated?: number;
  vusersCompleted?: number;
  /** Absolute error count in the bucket. */
  errorCount?: number;
  /** Response-time histogram quantiles (ms) for CDF/histogram charts. */
  histMin?: number;
  histMax?: number;
  histP75?: number;
  histP90?: number;
  histP999?: number;
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

/** One Artillery phase boundary for chart annotations. */
export interface PhaseAnnotation {
  /** Absolute timestamp when the phase starts (ISO 8601). */
  start: string;
  /** Absolute timestamp when the phase ends, if bounded (ISO 8601). */
  end: string | null;
  name: string;
}
