import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sql } from "../../db/client.js";
import { logger } from "../../logger.js";
import { spawnArtillery, killRun, isRunActive } from "../../lib/artillery.js";

const runs = new Hono();

const GRANULARITIES = ["1m", "1h", "1d"] as const;
type Granularity = (typeof GRANULARITIES)[number];

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 100;
const MAX_COMPARE_IDS = 10;

const DEFAULT_LIVE_INTERVAL_MS = 1_000;
const MIN_LIVE_INTERVAL_MS = 100;
const MAX_LIVE_INTERVAL_MS = 60_000;
const LIVE_PAGE_SIZE = 5_000;

function parseGranularity(value: string | undefined): Granularity | null {
  const candidate = value ?? "1m";
  return (GRANULARITIES as readonly string[]).includes(candidate)
    ? (candidate as Granularity)
    : null;
}

function parseTime(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function parseIntParam(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  if (value.trim() === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseCompareIds(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

// ─── List runs (paginated) ───

runs.get("/", async (c) => {
  const limit = parseIntParam(
    c.req.query("limit"),
    DEFAULT_PAGE_LIMIT,
    1,
    MAX_PAGE_LIMIT,
  );
  if (limit === null) return c.json({ error: "invalid limit" }, 400);

  const offset = parseIntParam(
    c.req.query("offset"),
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (offset === null) return c.json({ error: "invalid offset" }, 400);

  const rows = await sql`
    SELECT id, started_at, duration_ms, total_requests,
           p50, p95, p99, error_rate, status
    FROM runs
    ORDER BY started_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return c.json(rows);
});

// ─── Compare multiple runs ───
// Registered before `/:id` so the static path wins regardless of router.

runs.get("/compare", async (c) => {
  const ids = parseCompareIds(c.req.query("ids"));

  if (ids.length === 0) {
    return c.json({ error: "ids is required" }, 400);
  }
  if (ids.length < 2) {
    return c.json({ error: "at least two ids are required" }, 400);
  }
  if (ids.length > MAX_COMPARE_IDS) {
    return c.json(
      { error: `at most ${MAX_COMPARE_IDS} ids are allowed` },
      400,
    );
  }

  const granularity = parseGranularity(c.req.query("granularity"));
  if (!granularity) {
    return c.json({ error: "invalid granularity" }, 400);
  }

  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const endpoint = c.req.query("endpoint");
  const view = `metrics_${granularity}`;

  const runRows = await sql`
    SELECT id, started_at, duration_ms, total_requests,
           p50, p95, p99, error_rate, status
    FROM runs
    WHERE id = ANY(${ids})
    ORDER BY started_at DESC
  `;

  const series = endpoint !== undefined
    ? await sql`
        SELECT bucket, run_id, endpoint, rps, p50, p95, p99, error_rate, samples
        FROM ${sql.identifier(view)}
        WHERE run_id = ANY(${ids})
          AND bucket >= COALESCE(${from}::timestamptz, '-infinity')
          AND bucket <= COALESCE(${to}::timestamptz, 'infinity')
          AND endpoint = ${endpoint}
        ORDER BY bucket, run_id, endpoint
      `
    : await sql`
        SELECT bucket, run_id, endpoint, rps, p50, p95, p99, error_rate, samples
        FROM ${sql.identifier(view)}
        WHERE run_id = ANY(${ids})
          AND bucket >= COALESCE(${from}::timestamptz, '-infinity')
          AND bucket <= COALESCE(${to}::timestamptz, 'infinity')
        ORDER BY bucket, run_id, endpoint
      `;

  return c.json({ runs: runRows, series });
});

// ─── Single run ───

runs.get("/:id", async (c) => {
  const { id } = c.req.param();
  const rows = await sql`
    SELECT * FROM runs WHERE id = ${id}
  `;
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// ─── Endpoint listing ───

runs.get("/:id/endpoints", async (c) => {
  const { id } = c.req.param();
  const rows = await sql`
    SELECT endpoint, count(*)::int AS samples
    FROM metrics
    WHERE run_id = ${id}
      AND endpoint IS NOT NULL
      AND endpoint <> ''
    GROUP BY endpoint
    ORDER BY endpoint
  `;
  return c.json(rows);
});

// ─── Aggregated metrics ───

runs.get("/:id/metrics", async (c) => {
  const { id } = c.req.param();
  const granularity = parseGranularity(c.req.query("granularity"));
  if (!granularity) {
    return c.json({ error: "invalid granularity" }, 400);
  }

  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const endpoint = c.req.query("endpoint");
  const view = `metrics_${granularity}`;

  const rows = endpoint !== undefined
    ? await sql`
        SELECT bucket, endpoint, rps, p50, p95, p99, error_rate, samples
        FROM ${sql.identifier(view)}
        WHERE run_id = ${id}
          AND bucket >= COALESCE(${from}::timestamptz, '-infinity')
          AND bucket <= COALESCE(${to}::timestamptz, 'infinity')
          AND endpoint = ${endpoint}
        ORDER BY bucket
      `
    : await sql`
        SELECT bucket, endpoint, rps, p50, p95, p99, error_rate, samples
        FROM ${sql.identifier(view)}
        WHERE run_id = ${id}
          AND bucket >= COALESCE(${from}::timestamptz, '-infinity')
          AND bucket <= COALESCE(${to}::timestamptz, 'infinity')
        ORDER BY bucket
      `;

  return c.json(rows);
});

// ─── Raw points ───

runs.get("/:id/raw", async (c) => {
  const { id } = c.req.param();
  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const endpoint = c.req.query("endpoint");

  const rows = endpoint !== undefined
    ? await sql`
        SELECT time, endpoint, rps, p50, p95, p99, error_rate
        FROM metrics
        WHERE run_id = ${id}
          AND time >= COALESCE(${from}::timestamptz, '-infinity')
          AND time <= COALESCE(${to}::timestamptz, 'infinity')
          AND endpoint = ${endpoint}
        ORDER BY time
        LIMIT 100000
      `
    : await sql`
        SELECT time, endpoint, rps, p50, p95, p99, error_rate
        FROM metrics
        WHERE run_id = ${id}
          AND time >= COALESCE(${from}::timestamptz, '-infinity')
          AND time <= COALESCE(${to}::timestamptz, 'infinity')
        ORDER BY time
        LIMIT 100000
      `;

  return c.json(rows);
});

// ─── Live stream (SSE) ───

runs.get("/:id/live", async (c) => {
  const { id } = c.req.param();
  const from = parseTime(c.req.query("from"));
  const to = parseTime(c.req.query("to"));
  const endpoint = c.req.query("endpoint");
  const intervalMs = parseIntParam(
    c.req.query("interval_ms"),
    DEFAULT_LIVE_INTERVAL_MS,
    MIN_LIVE_INTERVAL_MS,
    MAX_LIVE_INTERVAL_MS,
  );
  if (intervalMs === null) {
    return c.json({ error: "invalid interval_ms" }, 400);
  }

  return streamSSE(c, async (stream) => {
    // Live reads the raw hypertable so points that share a timestamp (the
    // aggregate row plus every endpoint in one Artillery bucket) are not
    // skipped. Keyset pagination keeps the feed ordered and duplicate-free.
    let cursorTime = from ?? new Date(0);
    let cursorEndpoint = "";

    while (!stream.aborted) {
      const rows = endpoint !== undefined
        ? await sql`
            SELECT time, endpoint, rps, p50, p95, p99, error_rate
            FROM metrics
            WHERE run_id = ${id}
              AND (time, COALESCE(endpoint, '')) > (${cursorTime}::timestamptz, ${cursorEndpoint})
              AND time <= COALESCE(${to}::timestamptz, 'infinity')
              AND endpoint = ${endpoint}
            ORDER BY time, endpoint
            LIMIT ${LIVE_PAGE_SIZE}
          `
        : await sql`
            SELECT time, endpoint, rps, p50, p95, p99, error_rate
            FROM metrics
            WHERE run_id = ${id}
              AND (time, COALESCE(endpoint, '')) > (${cursorTime}::timestamptz, ${cursorEndpoint})
              AND time <= COALESCE(${to}::timestamptz, 'infinity')
            ORDER BY time, endpoint
            LIMIT ${LIVE_PAGE_SIZE}
          `;

      for (const row of rows) {
        await stream.writeSSE({ event: "metric", data: JSON.stringify(row) });

        const time = row.time;
        cursorTime = time instanceof Date
          ? time
          : new Date(time as string | number);
        cursorEndpoint = String(row.endpoint ?? "");
      }

      const runRows = await sql`
        SELECT status, duration_ms, total_requests, p50, p95, p99, error_rate
        FROM runs
        WHERE id = ${id}
      `;
      const current = runRows[0];

      if (current && current.status !== "running") {
        await stream.writeSSE({ event: "run", data: JSON.stringify(current) });
        break;
      }

      // Drain a full page immediately; otherwise wait for the next poll.
      if (rows.length < LIVE_PAGE_SIZE) {
        await stream.sleep(intervalMs);
      }
    }
  });
});

// ─── Trigger a new run ───

runs.post("/", async (c) => {
  const body = await c.req.json<{
    id?: string;
    script_path: string;
    config?: string;
    extra_args?: string[];
  }>();

  const runId = body.id ?? crypto.randomUUID();
  const scriptPath = body.script_path;

  if (typeof scriptPath !== "string" || scriptPath.trim() === "") {
    return c.json({ error: "script_path is required" }, 400);
  }

  // Validate script path (basic: no traversal)
  if (scriptPath.includes("..")) {
    return c.json({ error: "invalid script path" }, 400);
  }

  // Check if already running
  if (isRunActive(runId)) {
    return c.json({ error: "run already active" }, 409);
  }

  // Insert run row
  await sql`
    INSERT INTO runs (id, status, config_yaml)
    VALUES (${runId}, 'running', ${body.config ?? null})
    ON CONFLICT (id) DO NOTHING
  `;

  try {
    await spawnArtillery({
      runId,
      scriptPath,
      extraArgs: body.extra_args,
    });
  } catch (err) {
    logger.error({ err, runId }, "[artillery] failed to start run");
    await sql`UPDATE runs SET status = 'failed' WHERE id = ${runId}`;
    return c.json({ error: "failed to start run" }, 500);
  }

  return c.json({ id: runId, status: "running" }, 201);
});

// ─── Kill or delete a run ───

runs.delete("/:id", async (c) => {
  const { id } = c.req.param();

  if (isRunActive(id)) {
    killRun(id);
    await sql`UPDATE runs SET status = 'failed' WHERE id = ${id}`;
    return c.json({ id, status: "killed" });
  }

  const rows = await sql`SELECT id FROM runs WHERE id = ${id}`;
  if (rows.length === 0) return c.json({ error: "not found" }, 404);

  // Delete completed run + its metrics
  await sql`DELETE FROM metrics WHERE run_id = ${id}`;
  await sql`DELETE FROM runs WHERE id = ${id}`;
  return c.json({ id, status: "deleted" });
});

export default runs;
