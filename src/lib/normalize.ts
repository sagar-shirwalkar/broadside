import type { MetricPoint } from "../types.js";

/** Normalize a raw JSON point (from WebSocket or Kafka) into MetricPoint. */
export function normalizePoint(raw: Record<string, unknown>): MetricPoint {
  return {
    time: new Date(Number(raw.time_ms ?? raw.time)),
    runId: String(raw.run_id ?? raw.runId ?? ""),
    endpoint: String(raw.endpoint ?? ""),
    rps: Number(raw.rps ?? 0),
    p50: Number(raw.p50 ?? 0),
    p95: Number(raw.p95 ?? 0),
    p99: Number(raw.p99 ?? 0),
    errorRate: Number(raw.error_rate ?? raw.errorRate ?? 0),
    vusersStarted: optionalNumber(
      raw.vusers_started ?? raw.vusersStarted,
    ),
    vusersStopped: optionalNumber(
      raw.vusers_stopped ?? raw.vusersStopped,
    ),
    vusersCreated: optionalNumber(
      raw.vusers_created ?? raw.vusersCreated,
    ),
    vusersCompleted: optionalNumber(
      raw.vusers_completed ?? raw.vusersCompleted,
    ),
    errorCount: optionalNumber(raw.error_count ?? raw.errorCount),
    histMin: optionalNumber(raw.hist_min ?? raw.histMin),
    histMax: optionalNumber(raw.hist_max ?? raw.histMax),
    histP75: optionalNumber(raw.hist_p75 ?? raw.histP75),
    histP90: optionalNumber(raw.hist_p90 ?? raw.histP90),
    histP999: optionalNumber(raw.hist_p999 ?? raw.histP999),
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize a batch message (may contain single point or array). */
export function normalizeBatch(raw: Record<string, unknown>): MetricPoint[] {
  const runId = String(raw.run_id ?? raw.runId ?? "");
  const rawPoints = (raw.points as Record<string, unknown>[]) ?? [raw];
  return rawPoints.map((p) => {
    const point = normalizePoint(p);
    if (!point.runId) point.runId = runId;
    return point;
  });
}
