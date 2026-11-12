import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "../db/client.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { metricsFlusher } from "./flusher.js";
import type { MetricPoint } from "../types.js";

// ─── Types matching Artillery's JSON report ───

/**
 * Artillery's `--output` report uses the newer stats shape: intermediate
 * buckets expose `period` (epoch milliseconds) rather than `timestamp`.
 * `histograms` and `summaries` are both present and contain the summarized
 * distributions. Accept both shapes so reports from older Artillery versions
 * still work.
 */
export interface ArtilleryReport {
  intermediate: ArtilleryIntermediateReport[];
  aggregate: ArtillerySummary;
}

export interface ArtilleryIntermediateReport {
  timestamp?: string | number | Date;
  period?: string | number;
  counters?: Record<string, number>;
  histograms?: Record<string, ArtilleryHistogram>;
  summaries?: Record<string, ArtilleryHistogram>;
  rates?: Record<string, number>;
}

export interface ArtillerySummary {
  timestamp?: string | number | Date;
  period?: string | number;
  counters?: Record<string, number>;
  histograms?: Record<string, ArtilleryHistogram>;
  summaries?: Record<string, ArtilleryHistogram>;
  rates?: Record<string, number>;
  firstMetricAt?: number;
  lastMetricAt?: number;
}

export interface ArtilleryHistogram {
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  p50?: number;
  p75?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  p999?: number;
  count?: number;
  total?: number;
}

const DEFAULT_METRICS_NAMESPACE = "plugins.metrics-by-endpoint";
const DEFAULT_INTERVAL_SECONDS = 10;

/** Prefixes used by Artillery engines for their own response-time histograms. */
const ENGINE_METRIC_PREFIXES = new Set([
  "http",
  "socketio",
  "websocket",
  "browser",
  "vusers",
]);

// ─── Active run tracking ───

interface ActiveRun {
  id: string;
  proc: ChildProcess;
  outputFile: string;
  tmpDir: string;
  startedAt: Date;
  killed: boolean;
  settled: boolean;
}

const activeRuns = new Map<string, ActiveRun>();

// ─── Spawn ───

export interface SpawnOptions {
  runId: string;
  scriptPath: string;
  extraArgs?: string[];
}

/**
 * Spawn `artillery run` and wire up report processing. Resolves once the
 * process has been started; completion is handled asynchronously.
 */
export async function spawnArtillery(opts: SpawnOptions): Promise<void> {
  const { runId, scriptPath, extraArgs = [] } = opts;

  const tmpDir = await mkdtemp(join(tmpdir(), `artillery-${safeName(runId)}-`));
  const outputFile = join(tmpDir, "report.json");

  const args = [
    "run",
    scriptPath,
    "--output",
    outputFile,
    "--quiet",
    ...extraArgs,
  ];

  let proc: ChildProcess;
  try {
    proc = spawn("artillery", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ARTILLERY_DISABLE_TELEMETRY: "1" },
    });
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const activeRun: ActiveRun = {
    id: runId,
    proc,
    outputFile,
    tmpDir,
    startedAt: new Date(),
    killed: false,
    settled: false,
  };
  activeRuns.set(runId, activeRun);

  // Drain stderr so the child never blocks, and keep the tail for errors.
  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  let started = false;

  // Resolve only once the child has actually spawned. Spawn failures (for
  // example, a missing `artillery` binary) reject so the route can return 500.
  const ready = new Promise<void>((resolve, reject) => {
    proc.once("spawn", () => {
      started = true;
      resolve();
    });

    proc.once("error", (err) => {
      if (started) {
        void handleSpawnError(activeRun, err);
        return;
      }

      activeRun.settled = true;
      activeRuns.delete(runId);
      void rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      reject(err);
    });
  });

  proc.once("close", (code) => {
    void handleClose(activeRun, code, stderr);
  });

  await ready;
}

async function handleClose(
  activeRun: ActiveRun,
  code: number | null,
  stderr: string,
): Promise<void> {
  if (activeRun.settled) return;
  activeRun.settled = true;
  activeRuns.delete(activeRun.id);

  try {
    if (activeRun.killed) {
      await markRunFailed(activeRun, "killed");
      return;
    }

    if (code === 0) {
      await processReport(activeRun.id, activeRun.outputFile);
    } else {
      await failRun(
        activeRun,
        stderr.trim() || `artillery exited with code ${code}`,
        "artillery_exit_nonzero",
      );
    }
  } catch (err) {
    logger.error(
      { err, runId: activeRun.id },
      "[artillery] error processing run",
    );
    await failRun(activeRun, "failed to process report", "report_processing_failed");
  } finally {
    await rm(activeRun.tmpDir, { recursive: true, force: true }).catch(
      () => {},
    );
  }
}

async function handleSpawnError(
  activeRun: ActiveRun,
  err: Error,
): Promise<void> {
  if (activeRun.settled) return;
  activeRun.settled = true;
  activeRuns.delete(activeRun.id);

  logger.error({ err, runId: activeRun.id }, "[artillery] spawn error");
  await failRun(activeRun, err.message, "spawn_error");
  await rm(activeRun.tmpDir, { recursive: true, force: true }).catch(() => {});
}

async function markRunFailed(
  activeRun: ActiveRun,
  failureReason: string,
): Promise<void> {
  const durationMs = Date.now() - activeRun.startedAt.getTime();
  try {
    await sql`
      UPDATE runs SET
        status = 'failed',
        duration_ms = COALESCE(duration_ms, ${durationMs}),
        failure_reason = COALESCE(failure_reason, ${failureReason})
      WHERE id = ${activeRun.id}
    `;
  } catch (err) {
    logger.error(
      { err, runId: activeRun.id, failureReason },
      "[artillery] failed to mark run as failed",
    );
  }
}

async function failRun(
  activeRun: ActiveRun,
  reason: string,
  failureReason = "failed",
): Promise<void> {
  await markRunFailed(activeRun, failureReason);

  logger.error(
    { runId: activeRun.id, reason, failureReason },
    "[artillery] run failed",
  );
}

// ─── Parse report → metric points ───

/**
 * Convert an Artillery report into aggregate and per-endpoint metric points.
 *
 * Per-endpoint data comes from the `metrics-by-endpoint` plugin (enabled by
 * default since Artillery v2.0.1). The plugin publishes namespaced metrics:
 *
 *   plugins.metrics-by-endpoint.response_time.<endpoint>   histogram
 *   plugins.metrics-by-endpoint.<endpoint>.codes.<status>  counter
 *   plugins.metrics-by-endpoint.<endpoint>.errors.<code>   counter
 *
 * Reports generated before v2.0.1 only contain the aggregate `http.*` metrics;
 * in that case only the aggregate point (`endpoint: ""`) is emitted.
 */
export function parseReportPoints(
  report: ArtilleryReport,
  runId: string,
): MetricPoint[] {
  const intermediates = Array.isArray(report.intermediate)
    ? report.intermediate
    : [];

  const times = intermediates.map(reportTimestamp);
  const intervals = computeIntervals(times);
  const points: MetricPoint[] = [];

  intermediates.forEach((intermediate, index) => {
    const time = times[index];
    if (!time) return;

    const counters = intermediate.counters ?? {};
    const rates = intermediate.rates ?? {};
    const histograms = histogramMap(intermediate);
    const interval = intervals[index];

    const requestCount =
      counters["http.requests"] ?? counters["http.responses"] ?? 0;
    const measuredRate = finiteNumber(rates["http.request_rate"]);
    const aggregateRps =
      measuredRate ?? (interval > 0 ? requestCount / interval : 0);
    const responseTime = histograms["http.response_time"];

    const totalVUsers = counters["vusers.created"] ?? 1;
    const failedVUsers = counters["vusers.failed"] ?? 0;

    points.push({
      time,
      runId,
      endpoint: "",
      rps: aggregateRps,
      p50: responseTime?.p50 ?? 0,
      p95: responseTime?.p95 ?? 0,
      p99: responseTime?.p99 ?? 0,
      errorRate: totalVUsers > 0 ? failedVUsers / totalVUsers : 0,
      vusersStarted: counters["vusers.started"],
      vusersStopped: counters["vusers.stopped"],
      vusersCreated: counters["vusers.created"],
      vusersCompleted: counters["vusers.completed"],
      errorCount: failedVUsers,
      histMin: responseTime?.min,
      histMax: responseTime?.max,
      histP75: responseTime?.p75,
      histP90: responseTime?.p90,
      histP999: responseTime?.p999,
    });

    const endpoints = collectEndpoints(intermediate);
    for (const endpoint of endpoints.values()) {
      const count =
        endpoint.histogram?.count ??
        endpoint.histogram?.total ??
        endpoint.codes;

      // Distribute the bucket's measured RPS across endpoints by request
      // count. This keeps bucket totals consistent even when the first/last
      // intermediate covers a partial reporting window.
      const rps =
        requestCount > 0 && aggregateRps > 0
          ? (aggregateRps * count) / requestCount
          : interval > 0
            ? count / interval
            : 0;

      const requestTotal = endpoint.codes + endpoint.errors;

      points.push({
        time,
        runId,
        endpoint: endpoint.name,
        rps,
        p50: endpoint.histogram?.p50 ?? 0,
        p95: endpoint.histogram?.p95 ?? 0,
        p99: endpoint.histogram?.p99 ?? 0,
        errorRate:
          requestTotal > 0 ? endpoint.errors / requestTotal : 0,
        errorCount: endpoint.errors,
        histMin: endpoint.histogram?.min,
        histMax: endpoint.histogram?.max,
        histP75: endpoint.histogram?.p75,
        histP90: endpoint.histogram?.p90,
        histP999: endpoint.histogram?.p999,
      });
    }
  });

  return points;
}

interface EndpointStats {
  name: string;
  histogram?: ArtilleryHistogram;
  codes: number;
  errors: number;
}

/**
 * Collect per-endpoint histograms and counters from one intermediate bucket.
 * Supports the default plugin namespace and custom `metricsNamespace` values
 * inferred from response-time histogram keys.
 */
function collectEndpoints(
  report: ArtilleryIntermediateReport,
): Map<string, EndpointStats> {
  const endpoints = new Map<string, EndpointStats>();
  const namespaces = new Set<string>([DEFAULT_METRICS_NAMESPACE]);

  for (const [key, histogram] of Object.entries(histogramMap(report))) {
    const parsed = parseResponseTimeKey(key);
    if (!parsed) continue;

    namespaces.add(parsed.namespace);
    const existing = endpoints.get(parsed.endpoint);
    if (existing) {
      existing.histogram = histogram;
    } else {
      endpoints.set(parsed.endpoint, {
        name: parsed.endpoint,
        histogram,
        codes: 0,
        errors: 0,
      });
    }
  }

  for (const [key, value] of Object.entries(report.counters ?? {})) {
    for (const namespace of namespaces) {
      if (!key.startsWith(`${namespace}.`)) continue;

      const rest = key.slice(namespace.length + 1);

      const codeMatch = rest.match(/^(.*)\.codes\.(\d+)$/);
      if (codeMatch) {
        addCounter(endpoints, codeMatch[1], "codes", value);
        continue;
      }

      const errorMatch = rest.match(/^(.*)\.errors\.(.+)$/);
      if (errorMatch) {
        addCounter(endpoints, errorMatch[1], "errors", value);
      }
    }
  }

  return endpoints;
}

function addCounter(
  endpoints: Map<string, EndpointStats>,
  name: string,
  field: "codes" | "errors",
  value: number,
): void {
  const existing = endpoints.get(name);
  if (existing) {
    existing[field] += value;
    return;
  }

  endpoints.set(name, {
    name,
    codes: field === "codes" ? value : 0,
    errors: field === "errors" ? value : 0,
  });
}

function parseResponseTimeKey(
  key: string,
): { namespace: string; endpoint: string } | null {
  const marker = ".response_time.";
  const index = key.indexOf(marker);
  if (index <= 0) return null;

  const namespace = key.slice(0, index);
  const endpoint = key.slice(index + marker.length);
  if (!endpoint || ENGINE_METRIC_PREFIXES.has(namespace)) return null;

  return { namespace, endpoint };
}

function histogramMap(
  report: ArtilleryIntermediateReport | ArtillerySummary,
): Record<string, ArtilleryHistogram> {
  const histograms = report.histograms;
  if (histograms && Object.keys(histograms).length > 0) return histograms;
  return report.summaries ?? histograms ?? {};
}

function reportTimestamp(
  report: ArtilleryIntermediateReport | ArtillerySummary,
): Date | null {
  const value = report.timestamp ?? report.period;
  if (value === undefined || value === null) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    return Number.isNaN(value) ? null : new Date(value);
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeIntervals(times: Array<Date | null>): number[] {
  return times.map((time, index) => {
    if (!time) return DEFAULT_INTERVAL_SECONDS;

    const previous = previousTime(times, index);
    const next = nextTime(times, index);

    const sincePrevious = previous
      ? (time.getTime() - previous.getTime()) / 1000
      : 0;
    const untilNext = next ? (next.getTime() - time.getTime()) / 1000 : 0;

    const interval = sincePrevious > 0 ? sincePrevious : untilNext;
    return interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS;
  });
}

function previousTime(times: Array<Date | null>, index: number): Date | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const time = times[i];
    if (time) return time;
  }
  return null;
}

function nextTime(times: Array<Date | null>, index: number): Date | null {
  for (let i = index + 1; i < times.length; i += 1) {
    const time = times[i];
    if (time) return time;
  }
  return null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

// ─── Parse report → ingest metrics + update runs row ───

export async function processReport(
  runId: string,
  outputFile: string,
): Promise<void> {
  const raw = await readFile(outputFile, "utf-8");
  const report = JSON.parse(raw) as ArtilleryReport;

  const points = parseReportPoints(report, runId);
  if (points.length > 0) {
    metricsFlusher.ingest(points);
  }

  const aggregate = report.aggregate;
  const counters = aggregate.counters ?? {};
  const histograms = histogramMap(aggregate);
  const responseTime = histograms["http.response_time"];

  const totalRequests =
    counters["http.requests"] ??
    counters["http.responses"] ??
    counters["vusers.completed"] ??
    0;
  const totalCreated = counters["vusers.created"] ?? 0;
  const totalFailed = counters["vusers.failed"] ?? 0;

  const durationMs = reportDuration(report, aggregate);
  const reportPath = await persistReport(runId, raw);

  await sql`
    UPDATE runs SET
      status = 'completed',
      duration_ms = ${durationMs},
      total_requests = ${totalRequests},
      p50 = ${responseTime?.p50 ?? 0},
      p95 = ${responseTime?.p95 ?? 0},
      p99 = ${responseTime?.p99 ?? 0},
      error_rate = ${totalCreated > 0 ? totalFailed / totalCreated : 0},
      failure_reason = NULL,
      json_path = ${reportPath}
    WHERE id = ${runId}
  `;

  logger.info(
    {
      runId,
      totalRequests,
      p95: responseTime?.p95 ?? 0,
      points: points.length,
      reportPath,
    },
    "[artillery] run completed",
  );
}

function reportDuration(
  report: ArtilleryReport,
  aggregate: ArtillerySummary,
): number {
  // The aggregate metric timestamps are the most accurate wall-clock span.
  // Fall back to the distance between intermediate bucket periods, which
  // includes the boundaries of the reporting window.
  const firstMetricAt = finiteNumber(aggregate.firstMetricAt);
  const lastMetricAt = finiteNumber(aggregate.lastMetricAt);
  if (firstMetricAt !== undefined && lastMetricAt !== undefined) {
    return Math.max(0, Math.round(lastMetricAt - firstMetricAt));
  }

  const times = (report.intermediate ?? [])
    .map(reportTimestamp)
    .filter((time): time is Date => time !== null);

  if (times.length > 1) {
    return Math.round(
      times[times.length - 1].getTime() - times[0].getTime(),
    );
  }

  return 0;
}

async function persistReport(runId: string, raw: string): Promise<string> {
  const reportPath = join(
    config.artillery.reportDir,
    `${safeName(runId)}.json`,
  );
  await mkdir(config.artillery.reportDir, { recursive: true });
  await writeFile(reportPath, raw, "utf-8");
  return reportPath;
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

// ─── Kill a running run ───

export function killRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active) return false;

  active.killed = true;
  active.proc.kill("SIGTERM");
  activeRuns.delete(runId);
  return true;
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

/** Current number of running Artillery children. */
export function activeRunCount(): number {
  return activeRuns.size;
}

/** SIGTERM every active child. Called during graceful shutdown so a
 *  restart never leaves orphaned Artillery processes behind. */
export function killAllRuns(): number {
  let count = 0;
  for (const [id] of activeRuns) {
    if (killRun(id)) count += 1;
  }
  return count;
}
