import { Hono } from "hono";
import { sql } from "../../db/client.js";

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

runs.post("/", async (c) => {
  const body = await c.req.json();
  const { id, config: configYaml } = body;

  await sql`
    INSERT INTO runs (id, status, config_yaml)
    VALUES (${id}, 'running', ${configYaml ?? null})
    ON CONFLICT (id) DO NOTHING
  `;

  // TODO: spawn artillery process, stream output
  // const proc = spawn("artillery", ["run", yamlPath, "--output", "stream.json"]);

  return c.json({ id, status: "running" }, 201);
});

export default runs;
