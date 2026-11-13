import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
  const pluginCode = renderBroadsideReporterPlugin();
  const pluginPath = join(tmpDir, "artillery-plugin-broadside-reporter.js");
  await writeFile(pluginPath, pluginCode, "utf-8");
  const pluginPkgDir = join(tmpDir, "node_modules", "artillery-plugin-broadside-reporter");
  await mkdir(pluginPkgDir, { recursive: true });
  await writeFile(join(pluginPkgDir, "index.js"), pluginCode, "utf-8");
  await writeFile(
    join(pluginPkgDir, "package.json"),
    JSON.stringify({ name: "artillery-plugin-broadside-reporter", main: "index.js" }),
    "utf-8",
  );

  const ingestUrl = resolveIngestWsUrl();
  const effectiveScriptPath = await prepareScriptForLive(scriptPath, tmpDir);

  const args = [
    "run",
    effectiveScriptPath,
    "--output",
    outputFile,
    "--quiet",
    ...extraArgs,
  ];

  let proc: ChildProcess;
  try {
    const resourceLimits: Record<string, number> = {};
    if (config.artillery.childMaxOldGenerationMb > 0) {
      resourceLimits.maxOldGenerationSizeMb = config.artillery.childMaxOldGenerationMb;
    }
    if (config.artillery.childMaxYoungGenerationMb > 0) {
      resourceLimits.maxYoungGenerationSizeMb = config.artillery.childMaxYoungGenerationMb;
    }
    const childEnv = {
      ...process.env,
      ARTILLERY_DISABLE_TELEMETRY: "1",
      BROADSIDE_RUN_ID: runId,
      BROADSIDE_INGEST_URL: ingestUrl,
      NODE_PATH: [tmpDir, process.env.NODE_PATH].filter(Boolean).join(":"),
    };
    logger.info(
      {
        runId,
        argv: ["artillery", ...args],
        ingestUrl,
        scriptPath: effectiveScriptPath,
        pluginPath,
      },
      "[artillery] spawning run (live streaming enabled)",
    );
    proc = spawn("artillery", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: childEnv,
      ...(Object.keys(resourceLimits).length > 0 ? { resourceLimits } : {}),
    } as any);
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

  // Drain output so the child never blocks, keep tails for diagnostics.
  let stderr = "";
  let stdout = "";
  proc.stdout?.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
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
    void handleClose(activeRun, code, stderr, stdout);
  });

  await ready;
}

async function handleClose(
  activeRun: ActiveRun,
  code: number | null,
  stderr: string,
  stdout = "",
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
      if (stdout.trim() || stderr.trim()) {
        logger.debug(
          { runId: activeRun.id, stdout: stdout.trim().slice(-4000), stderr: stderr.trim().slice(-4000) },
          "[artillery] child output",
        );
      }
    } else {
      await failRun(
        activeRun,
        (stderr || stdout).trim() || `artillery exited with code ${code}`,
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

  // Ensure any late-streamed points are flushed, then replace provisional
  // streamed metrics with the authoritative final report.
  await metricsFlusher.flush();
  await sql`DELETE FROM metrics WHERE run_id = ${runId}`;

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

function resolveIngestWsUrl(): string {
  const configured = (config.ingestUrl ?? "").trim();
  let url = "";
  if (configured) {
    if (configured.startsWith("http://")) url = `ws://${configured.slice("http://".length)}`;
    else if (configured.startsWith("https://")) url = `wss://${configured.slice("https://".length)}`;
    else if (configured.startsWith("ws://") || configured.startsWith("wss://")) url = configured;
    else url = configured;
  } else if (config.serviceRole === "api") {
    // In split deployments the API/orchestrator container cannot reach ingest on localhost.
    throw new Error(
      "INGEST_URL is required for SERVICE_ROLE=api to stream orchestrated run metrics (e.g. ws://ingest:3002/ws)",
    );
  } else {
    const port = config.ingestPort > 0 ? config.ingestPort : config.port;
    url = `ws://127.0.0.1:${port}`;
  }
  if (!/\/ws(\/|\?|$)/.test(url)) url = url.replace(/\/$/, "") + "/ws";
  return url;
}

async function prepareScriptForLive(scriptPath: string, tmpDir: string): Promise<string> {
  if (!/\.ya?ml$/i.test(scriptPath)) return scriptPath;
  try {
    const raw = await readFile(scriptPath, "utf-8");
    const parsed = parseYaml(raw) as any;
    if (!parsed || typeof parsed !== "object") return scriptPath;
    parsed.config = parsed.config && typeof parsed.config === "object" ? parsed.config : {};
    if (parsed.config.statsInterval == null) parsed.config.statsInterval = 1;
    parsed.config.plugins =
      parsed.config.plugins && typeof parsed.config.plugins === "object"
        ? parsed.config.plugins
        : {};
    // Register temp live-stream reporter plugin (resolved via NODE_PATH in tmpDir).
    parsed.config.plugins["broadside-reporter"] = {
      ...(parsed.config.plugins["broadside-reporter"] ?? {}),
    };
    const outPath = join(tmpDir, "script.live.yml");
    await writeFile(outPath, stringifyYaml(parsed), "utf-8");
    return outPath;
  } catch {
    return scriptPath;
  }
}

function renderBroadsideReporterPlugin(): string {
  let wsRequireExpr = "require('ws')";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    wsRequireExpr = `require(${JSON.stringify(require.resolve("ws"))})`;
  } catch {
    wsRequireExpr = `(function(){ try { return require('ws'); } catch (e) { return require(require.resolve('ws', { paths: [process.cwd()] })); } })()`;
  }

  return `'use strict';
console.error('[broadside-reporter] module loaded', __filename);
const WebSocket = ${wsRequireExpr};

const DEFAULT_METRICS_NAMESPACE = 'plugins.metrics-by-endpoint';
const DEFAULT_INTERVAL_SECONDS = 10;
const ENGINE_METRIC_PREFIXES = new Set(['http','socketio','websocket','browser','vusers']);

function finiteNumber(v){ return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }
function histogramMap(report){
  const h = report && report.histograms;
  if (h && Object.keys(h).length > 0) return h;
  return (report && report.summaries) || h || {};
}
function reportTimestamp(report){
  const value = report && (report.timestamp ?? report.period);
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isNaN(value) ? null : new Date(value);
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseResponseTimeKey(key){
  const marker = '.response_time.';
  const index = key.indexOf(marker);
  if (index <= 0) return null;
  const namespace = key.slice(0, index);
  const endpoint = key.slice(index + marker.length);
  if (!endpoint || ENGINE_METRIC_PREFIXES.has(namespace)) return null;
  return { namespace, endpoint };
}
function addCounter(endpoints, name, field, value){
  const existing = endpoints.get(name);
  if (existing) { existing[field] += value; return; }
  endpoints.set(name, { name, histogram: undefined, codes: field==='codes'?value:0, errors: field==='errors'?value:0 });
}
function collectEndpoints(report){
  const endpoints = new Map();
  const namespaces = new Set([DEFAULT_METRICS_NAMESPACE]);
  for (const [key, histogram] of Object.entries(histogramMap(report))){
    const parsed = parseResponseTimeKey(key);
    if (!parsed) continue;
    namespaces.add(parsed.namespace);
    const existing = endpoints.get(parsed.endpoint);
    if (existing) existing.histogram = histogram;
    else endpoints.set(parsed.endpoint, { name: parsed.endpoint, histogram, codes: 0, errors: 0 });
  }
  for (const [key, value] of Object.entries((report && report.counters) || {})){
    for (const namespace of namespaces){
      if (!key.startsWith(namespace + '.')) continue;
      const rest = key.slice(namespace.length + 1);
      const codeMatch = rest.match(/^(.*)\\.codes\\.(\\d+)$/);
      if (codeMatch){ addCounter(endpoints, codeMatch[1], 'codes', value); continue; }
      const errorMatch = rest.match(/^(.*)\\.errors\\.(.+)$/);
      if (errorMatch){ addCounter(endpoints, errorMatch[1], 'errors', value); }
    }
  }
  return endpoints;
}
function toPoint(time, runId, endpoint, rps, hist, errorRate, extra){
  const p = {
    time_ms: time.getTime(),
    run_id: runId,
    endpoint: endpoint || '',
    rps: rps || 0,
    p50: (hist && hist.p50) || 0,
    p95: (hist && hist.p95) || 0,
    p99: (hist && hist.p99) || 0,
    error_rate: errorRate || 0,
  };
  if (extra){
    for (const k of Object.keys(extra)) { if (extra[k] !== undefined) p[k] = extra[k]; }
  }
  if (hist){
    if (hist.min != null) p.hist_min = hist.min;
    if (hist.max != null) p.hist_max = hist.max;
    if (hist.p75 != null) p.hist_p75 = hist.p75;
    if (hist.p90 != null) p.hist_p90 = hist.p90;
    if (hist.p999 != null) p.hist_p999 = hist.p999;
  }
  return p;
}
function transformStats(runId, stats, state){
  const time = reportTimestamp(stats) || new Date();
  const counters = (stats && stats.counters) || {};
  const rates = (stats && stats.rates) || {};
  const histograms = histogramMap(stats);
  const prev = state.lastTime;
  state.lastTime = time;
  const interval = prev ? Math.max((time.getTime() - prev.getTime()) / 1000, 0) : DEFAULT_INTERVAL_SECONDS;
  const effectiveInterval = interval > 0 ? interval : DEFAULT_INTERVAL_SECONDS;

  const requestCount = counters['http.requests'] ?? counters['http.responses'] ?? 0;
  const measuredRate = finiteNumber(rates['http.request_rate']);
  const aggregateRps = measuredRate ?? (effectiveInterval > 0 ? requestCount / effectiveInterval : 0);
  const responseTime = histograms['http.response_time'];
  const totalVUsers = counters['vusers.created'] ?? 1;
  const failedVUsers = counters['vusers.failed'] ?? 0;

  const points = [];
  points.push(toPoint(time, runId, '', aggregateRps, responseTime, totalVUsers > 0 ? failedVUsers / totalVUsers : 0, {
    vusers_started: counters['vusers.started'],
    vusers_stopped: counters['vusers.stopped'],
    vusers_created: counters['vusers.created'],
    vusers_completed: counters['vusers.completed'],
    error_count: failedVUsers,
  }));

  const endpoints = collectEndpoints(stats);
  for (const endpoint of endpoints.values()){
    const count = (endpoint.histogram && (endpoint.histogram.count ?? endpoint.histogram.total)) ?? endpoint.codes;
    const rps = requestCount > 0 && aggregateRps > 0
      ? (aggregateRps * count) / requestCount
      : (effectiveInterval > 0 ? count / effectiveInterval : 0);
    const requestTotal = endpoint.codes + endpoint.errors;
    points.push(toPoint(time, runId, endpoint.name, rps, endpoint.histogram, requestTotal > 0 ? endpoint.errors / requestTotal : 0, {
      error_count: endpoint.errors,
    }));
  }
  return points;
}

class BroadsideReporter {
  constructor(scriptOrConfig, events){
    const cfg = scriptOrConfig && scriptOrConfig.config ? (scriptOrConfig.config.plugins && scriptOrConfig.config.plugins['broadside-reporter']) || {} : (scriptOrConfig || {});
    this.runId = cfg.runId || process.env.BROADSIDE_RUN_ID;
    this.ingestUrl = cfg.ingestUrl || process.env.BROADSIDE_INGEST_URL || 'ws://127.0.0.1:3000/ws';
    if (this.ingestUrl && !/\\/ws(\\?|$)/.test(this.ingestUrl)) {
      this.ingestUrl = this.ingestUrl.replace(/\\/$/, '') + '/ws';
    }
    this.ws = null;
    this.connected = false;
    this.buffer = [];
    this.reconnectTimer = null;
    this.slowdownUntil = 0;
    this.maxBuffer = 5000;
    this.state = { lastTime: null };
    this.sentBatches = 0;
    this.sentPoints = 0;
    if (!this.runId) {
      console.error('[broadside-reporter] missing BROADSIDE_RUN_ID, disabled');
      return;
    }
    console.error('[broadside-reporter] init', JSON.stringify({ runId: this.runId, ingestUrl: this.ingestUrl }));
    if (events && events.on){
      events.on('stats', (stats) => this.onStats(stats));
      events.on('done', () => this.close());
    }
    this.connect();
  }
  connect(){
    console.error('[broadside-reporter] connecting to', this.ingestUrl);
    try {
      this.ws = new WebSocket(this.ingestUrl);
    } catch (err) { console.error('[broadside-reporter] connect error', err && err.message); this.scheduleReconnect(); return; }
    this.ws.on('open', () => { this.connected = true; console.error('[broadside-reporter] ws open'); this.flush(); });
    this.ws.on('message', (raw) => {
      try {
        const ctrl = JSON.parse(raw.toString());
        if (ctrl && ctrl.type === 'slow_down') {
          const hz = ctrl.target_hz || 1;
          this.slowdownUntil = Date.now() + (1000 / Math.max(1, hz)) * 2;
        }
      } catch {}
    });
    this.ws.on('close', (code) => { this.connected = false; console.error('[broadside-reporter] ws close', code); this.scheduleReconnect(); });
    this.ws.on('error', (err) => { console.error('[broadside-reporter] ws error', err && err.message); });
  }
  scheduleReconnect(){
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2000);
  }
  onStats(stats){
    if (Date.now() < this.slowdownUntil) return;
    let points = [];
    try { points = transformStats(this.runId, stats, this.state) || []; } catch (err) { console.error('[broadside-reporter] transform error', err && err.message); return; }
    if (!points.length) return;
    if (this.buffer.length + points.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length + points.length - this.maxBuffer);
    }
    this.buffer.push(...points);
    this.flush();
  }
  flush(){
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.buffer.length) return;
    const batch = this.buffer.splice(0, 5000);
    try {
      this.ws.send(JSON.stringify({ run_id: this.runId, points: batch }));
      this.sentBatches += 1;
      this.sentPoints += batch.length;
      if (this.sentBatches <= 3 || this.sentBatches % 20 === 0) {
        console.error('[broadside-reporter] sent batch', JSON.stringify({ batches: this.sentBatches, points: this.sentPoints }));
      }
    }
    catch (err) { console.error('[broadside-reporter] send error', err && err.message); this.buffer.unshift(...batch); }
  }
  close(){
    try { this.flush(); } catch {}
    try { if (this.ws) this.ws.close(); } catch {}
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    console.error('[broadside-reporter] closed', JSON.stringify({ batches: this.sentBatches, points: this.sentPoints }));
  }
}

function Plugin(script, events){ return new BroadsideReporter(script, events); }
module.exports = { Plugin };
module.exports.Plugin = Plugin;
module.exports.default = Plugin;
`;
}

// ─── Kill a running run ───

export function killRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active) return false;

  active.killed = true;
  try {
    active.proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  // Escalate if the child does not exit promptly.
  setTimeout(() => {
    try {
      if (!active.proc.killed) active.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 5000).unref?.();
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
