import type { ChartPoint, ChartSeries } from "./types.ts";
import { cumulative, num } from "./types.ts";

/**
 * Shared derived series for the metric charts (run detail + live view):
 * active VUsers, tail latency, cumulative errors, CDF and histogram
 * approximations from per-bucket quantiles.
 *
 * Each helper takes rows sorted by time, already filtered to the series
 * of interest (aggregate or one endpoint).
 */

export interface Bucket {
  time: number;
  vusersCreated: number | null;
  vusersCompleted: number | null;
  errorCount: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  histMin: number | null;
  histMax: number | null;
  histP75: number | null;
  histP90: number | null;
  histP999: number | null;
}

/** Normalize a metric row into the shape the helpers expect. */
export function toBucket(
  row: {
    vusers_created: number | string | null;
    vusers_completed: number | string | null;
    error_count: number | string | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    hist_min: number | null;
    hist_max: number | null;
    hist_p75: number | null;
    hist_p90: number | null;
    hist_p999: number | null;
  },
  time: number,
): Bucket {
  return {
    time,
    vusersCreated: num(row.vusers_created),
    vusersCompleted: num(row.vusers_completed),
    errorCount: num(row.error_count),
    p50: num(row.p50 as number | null),
    p95: num(row.p95 as number | null),
    p99: num(row.p99 as number | null),
    histMin: num(row.hist_min),
    histMax: num(row.hist_max),
    histP75: num(row.hist_p75),
    histP90: num(row.hist_p90),
    histP999: num(row.hist_p999),
  };
}

/** Artillery reports no started/stopped counters — the usable signal is
 *  created − completed − failed (a VU still in flight). */
export function activeVusers(rows: Bucket[]): ChartPoint[] {
  return cumulative(
    rows.map((r) => ({
      time: r.time,
      value:
        r.vusersCreated !== null &&
        r.vusersCompleted !== null &&
        r.errorCount !== null
          ? r.vusersCreated - r.vusersCompleted - r.errorCount
          : null,
    })),
  );
}

export function tailSpread(rows: Bucket[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const r of rows) {
    if (r.p50 && r.p99 && r.p50 > 0) {
      out.push({ time: r.time, value: r.p99 / r.p50 });
    }
  }
  return out;
}

export function errorCount(points: Bucket[]): ChartPoint[] {
  return cumulative(
    points.map((r) => ({ time: r.time, value: r.errorCount })),
  );
}

export function vusersIo(rows: Bucket[]): ChartSeries[] {
  return [
    {
      name: "created",
      colorIndex: 1,
      points: cumulative(
        rows.map((r) => ({ time: r.time, value: r.vusersCreated })),
      ),
    },
    {
      name: "completed",
      colorIndex: 2,
      points: cumulative(
        rows.map((r) => ({ time: r.time, value: r.vusersCompleted })),
      ),
    },
  ];
}

/** CDF from the latest row's quantiles: (latency ms → share of requests),
 *  approximated from the report's percentile points. */
export function cdfFromLatest(rows: Bucket[]): ChartSeries[] {
  const last = rows[rows.length - 1];
  if (!last) return [];
  const quantiles: Array<[number | null, number]> = [
    [num(last.histMin), 0.001],
    [num(last.p50), 0.5],
    [num(last.histP75), 0.75],
    [num(last.histP90), 0.9],
    [num(last.p95), 0.95],
    [num(last.p99), 0.99],
    [num(last.histP999), 0.999],
    [num(last.histMax), 1.0],
  ];
  const points = quantiles
    .filter((q): q is [number, number] => q[0] !== null)
    .map(([ms, frac]) => ({ time: ms, value: frac }));
  return points.length > 0
    ? [{ name: "share of requests", colorIndex: 1, points }]
    : [];
}

/** Quantile shares as histogram bars (how traffic falls in each band). */
export function histogramFromLatest(rows: Bucket[]): ChartSeries[] {
  const last = rows[rows.length - 1];
  if (!last) return [];
  const edges: Array<[number | null, number]> = [
    [num(last.p50), 0.5],
    [num(last.histP75), 0.75],
    [num(last.histP90), 0.9],
    [num(last.p95), 0.95],
    [num(last.p99), 0.99],
    [num(last.histP999), 0.999],
    [num(last.histMax), 1.0],
  ];
  const points: ChartPoint[] = [];
  let prev = 0;
  for (const [ms, frac] of edges) {
    if (ms === null) continue;
    points.push({ time: ms, value: (frac - prev) * 100 });
    prev = frac;
    if (frac >= 1.0) break;
  }
  return points.length > 0
    ? [{ name: "share of requests", colorIndex: 1, points }]
    : [];
}


