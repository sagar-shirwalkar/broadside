import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { config } from "../../config.js";

/**
 * Overview aggregates for the dashboard's landing page.
 *
 * Each panel answers the Overview question — "are we drifting?"
 * Individual runs look fine in isolation; the trend across the last
 * 30 runs/days is where slow degradation shows. Data sources:
 * - `runs` — per-run aggregates (one row per run, `started_at`).
 * - `metrics_1d` — the daily CAGG, grouped by `run_id` for the
 *   per-run trend points (so directly-ingested WS points still show
 *   up even without an orchestrated run row) and by `endpoint` for
 *   worst-endpoint ranking (no separate `metrics_1d_endpoint` CAGG:
 *   the daily rollup already carries the endpoint dimension, and
 *   aggregating it per endpoint is cheap).
 */

const overview = new Hono();

const WORST_ENDPOINTS_LIMIT = 10;
const REGRESSION_RUNS_BASELINE = 10;
const REGRESSION_LIMIT = 10;

function sloStatus(total: number, met: number): string {
  if (total === 0) return "nodata";
  const pct = met / total;
  if (pct >= 0.9) return "pass";
  if (pct >= 0.75) return "warn";
  return "fail";
}

interface SloRow {
  total: number | string;
  met_p95: number | string;
  met_error: number | string;
}

type SloKey = "p95" | "errorRate";

function toSlo(key: SloKey, total: number, met: number): Record<string, unknown> {
  return {
    key,
    label: key === "p95" ? "p95" : "error rate",
    threshold: key === "p95" ? config.slo.p95Ms : config.slo.errorRate,
    unit: key === "p95" ? "ms" : "frac",
    total,
    met,
    metPct: total === 0 ? 0 : met / total,
    status: sloStatus(total, met),
  };
}

overview.get("/", async (c) => {
  const [slo, trends, frequency, worst, regressions, recentRuns] =
    await Promise.all([
      overviewSlo(),
      overviewTrends(),
      overviewFrequency(),
      overviewWorst(),
      overviewRegressions(),
      overviewRecentRuns(),
    ]);

  return c.json({ slo, trends, frequency, worst, regressions, recentRuns });
});

async function overviewSlo(): Promise<Record<string, unknown>[]> {
  const rows = (await sql`
    WITH windowed AS (
      SELECT p95, error_rate
      FROM runs
      WHERE status = 'completed' AND p95 IS NOT NULL
      ORDER BY started_at DESC
      LIMIT ${config.slo.windowRuns}
    )
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE p95 <= ${config.slo.p95Ms})::bigint AS met_p95,
      count(*) FILTER (WHERE error_rate <= ${config.slo.errorRate})::bigint AS met_error
    FROM windowed
  `) as SloRow[];

  const row = rows[0];
  const total = Number(row?.total ?? 0);
  if (!row) {
    return [
      toSlo("p95", 0, 0),
      toSlo("errorRate", 0, 0),
    ];
  }
  return [
    toSlo("p95", total, Number(row.met_p95)),
    toSlo("errorRate", total, Number(row.met_error)),
  ];
}

interface TrendRow {
  bucket: string | Date | number;
  run_id: string;
  p95: number | string;
  error_rate: number | string;
}

/**
 * One point per run over the last 30 days: the CAGG grouped by
 * `run_id`. A run spanning several daily buckets contributes the
 * average of its bucket averages, at its earliest bucket.
 */
async function overviewTrends(): Promise<Record<string, unknown>> {
  const rows = (await sql`
    SELECT
      min(bucket) AS bucket,
      run_id,
      avg(p95) AS p95,
      avg(error_rate) AS error_rate
    FROM metrics_1d
    WHERE bucket > now() - INTERVAL '30 days'
    GROUP BY run_id
    ORDER BY bucket
  `) as TrendRow[];

  return {
    p95: rows.map((r) => ({
      time: new Date(r.bucket).toISOString(),
      value: Number(r.p95),
      runId: r.run_id,
    })),
    errorRate: rows.map((r) => ({
      time: new Date(r.bucket).toISOString(),
      value: Number(r.error_rate),
      runId: r.run_id,
    })),
  };
}

interface FrequencyRow {
  day: string;
  runs: number | string;
}

async function overviewFrequency(): Promise<unknown[]> {
  const rows = (await sql`
    SELECT date_trunc('day', started_at)::date AS day, count(*)::bigint AS runs
    FROM runs
    WHERE started_at > now() - INTERVAL '30 days'
    GROUP BY day
    ORDER BY day
  `) as FrequencyRow[];

  return rows.map((r) => ({
    day: new Date(r.day).toISOString().slice(0, 10),
    runs: Number(r.runs),
  }));
}

interface WorstRow {
  endpoint: string;
  avg_p95: number | string;
  avg_error_rate: number | string;
  runs: number | string;
}

/**
 * Slowest endpoints across the last 30 days. The aggregate row
 * (`endpoint = ''`) is excluded. No separate per-endpoint CAGG is
 * maintained: `metrics_1d` already carries the endpoint dimension, and
 * grouping it per endpoint at read time is cheap at this scale.
 */
async function overviewWorst(): Promise<Record<string, unknown>[]> {
  const rows = (await sql`
    SELECT
      endpoint,
      avg(p95) AS avg_p95,
      avg(error_rate) AS avg_error_rate,
      count(DISTINCT run_id)::bigint AS runs
    FROM metrics_1d
    WHERE bucket > now() - INTERVAL '30 days'
      AND endpoint IS NOT NULL AND endpoint <> ''
    GROUP BY endpoint
    ORDER BY avg_p95 DESC
    LIMIT ${WORST_ENDPOINTS_LIMIT}
  `) as WorstRow[];

  return rows.map((r) => ({
    endpoint: r.endpoint,
    avgP95: Number(r.avg_p95),
    avgErrorRate: Number(r.avg_error_rate),
    runs: Number(r.runs),
  }));
}

interface RegressionRow {
  endpoint: string;
  latest_run_id: string;
  latest_p95: number | string;
  baseline_p95: number | string;
  baseline_runs: number | string;
}

/**
 * Regression alerts: the most recent completed run's per-endpoint p95
 * vs. the rolling median of the previous `REGRESSION_RUNS_BASELINE`
 * runs on the same endpoint. An endpoint is flagged when the latest
 * run exceeds the median by more than `SLO_REGRESSION_DELTA` (default
 * 1.2 = +20%).
 */
async function overviewRegressions(): Promise<Record<string, unknown>[]> {
  const rows = (await sql`
    WITH run_endpoint AS (
      SELECT
        m.run_id,
        m.endpoint,
        avg(m.p95) AS avg_p95,
        max(r.started_at) AS started_at
      FROM metrics_1d m
      JOIN runs r ON r.id = m.run_id
      WHERE m.bucket > now() - INTERVAL '30 days'
        AND m.endpoint IS NOT NULL AND m.endpoint <> ''
        AND r.status = 'completed'
      GROUP BY m.run_id, m.endpoint
    ),
    ranked AS (
      SELECT
        endpoint,
        run_id,
        avg_p95,
        row_number() OVER (PARTITION BY endpoint ORDER BY started_at DESC) AS rn
      FROM run_endpoint
    ),
    baseline AS (
      SELECT
        endpoint,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY avg_p95) AS median_p95,
        count(*) AS baseline_runs
      FROM ranked
      WHERE rn BETWEEN 2 AND ${REGRESSION_RUNS_BASELINE + 1}
      GROUP BY endpoint
      HAVING count(*) >= 2
    )
    SELECT
      r.endpoint,
      r.run_id AS latest_run_id,
      r.avg_p95 AS latest_p95,
      b.median_p95 AS baseline_p95,
      b.baseline_runs
    FROM ranked r
    JOIN baseline b ON b.endpoint = r.endpoint
    WHERE r.rn = 1
      AND b.median_p95 > 0
      AND r.avg_p95 > b.median_p95 * ${config.slo.regressionDelta}
    ORDER BY (r.avg_p95 / b.median_p95) DESC
    LIMIT ${REGRESSION_LIMIT}
  `) as RegressionRow[];

  return rows.map((r) => {
    const latest = Number(r.latest_p95);
    const baseline = Number(r.baseline_p95);
    return {
      endpoint: r.endpoint,
      latestP95: latest,
      baselineP95: baseline,
      deltaPct: baseline === 0 ? 0 : ((latest - baseline) / baseline) * 100,
      runId: r.latest_run_id,
      baselineRuns: Number(r.baseline_runs),
    };
  }).filter((r) => r.baselineP95 > 0);
}

async function overviewRecentRuns(): Promise<Record<string, unknown>[]> {
  const rows = (await sql`
    SELECT id, started_at, duration_ms, total_requests,
           p50, p95, p99, error_rate, status
    FROM runs
    ORDER BY started_at DESC
    LIMIT 5
  `) as unknown as Record<string, unknown>[];
  return rows;
}

export default overview;
