import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { logger } from "../../logger.js";
import { spawnArtillery, killRun, isRunActive } from "../../lib/artillery.js";

const runs = new Hono();

runs.get("/", async (c) => {
  const rows = await sql`
    SELECT id, started_at, duration_ms, total_requests,
           p50, p95, p99, error_rate, status
    FROM runs
    ORDER BY started_at DESC
    LIMIT 100
  `;
  return c.json(rows);
});

runs.get("/:id", async (c) => {
  const { id } = c.req.param();
  const rows = await sql`
    SELECT * FROM runs WHERE id = ${id}
  `;
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

runs.get("/:id/metrics", async (c) => {
  const { id } = c.req.param();
  const granularity = c.req.query("granularity") ?? "1m";
  if (granularity !== "1m" && granularity !== "1h" && granularity !== "1d") {
    return c.json({ error: "invalid granularity" }, 400);
  }

  const from = c.req.query("from") ? new Date(c.req.query("from")!) : null;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : null;

  const view = `metrics_${granularity}`;
  const rows = await sql`
    SELECT bucket, endpoint, rps, p50, p95, p99, error_rate, samples
    FROM ${sql.identifier(view)}
    WHERE run_id = ${id}
      AND bucket >= COALESCE(${from}::timestamptz, '-infinity')
      AND bucket <= COALESCE(${to}::timestamptz, 'infinity')
    ORDER BY bucket
  `;
  return c.json(rows);
});

runs.get("/:id/raw", async (c) => {
  const { id } = c.req.param();
  const from = c.req.query("from") ? new Date(c.req.query("from")!) : null;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : null;

  const rows = await sql`
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

// ─── Kill a running run ───

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
