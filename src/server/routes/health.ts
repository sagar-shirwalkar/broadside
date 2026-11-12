import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { metricsFlusher } from "../../lib/flusher.js";
import { logger } from "../../logger.js";

const health = new Hono();

async function readinessPayload() {
  let database: "ok" | "error" = "ok";
  try {
    await sql`SELECT 1`;
  } catch (err) {
    database = "error";
    logger.error({ err }, "[health] database check failed");
  }

  const degraded = database !== "ok";
  return {
    status: degraded ? "degraded" : "ok",
    uptime: process.uptime(),
    database: { status: database },
    flusher: metricsFlusher.stats,
    timestamp: new Date().toISOString(),
  } as const;
}

// Detailed health (readiness-style) kept at /api/health for UI/probe compatibility.
health.get("/", async (c) => {
  const payload = await readinessPayload();
  return c.json(payload, payload.status === "degraded" ? 503 : 200);
});

// Explicit readiness probe (DB + flusher stats).
health.get("/ready", async (c) => {
  const payload = await readinessPayload();
  return c.json(payload, payload.status === "degraded" ? 503 : 200);
});

// Cheap liveness probe: no DB access.
health.get("/live", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default health;
