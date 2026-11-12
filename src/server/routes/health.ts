import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { metricsFlusher } from "../../lib/flusher.js";
import { logger } from "../../logger.js";

const health = new Hono();

function livenessPayload() {
  return {
    status: "ok" as const,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

async function readinessPayload() {
  let database: "ok" | "error" = "ok";
  try {
    await sql`SELECT 1`;
  } catch (err) {
    database = "error";
    logger.error({ err }, "[readyz] database check failed");
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

// Liveness: static, no DB.
health.get("/", (c) => c.json(livenessPayload()));
health.get("/live", (c) => c.json(livenessPayload()));

// Readiness: DB + flusher telemetry.
health.get("/ready", async (c) => {
  const payload = await readinessPayload();
  return c.json(payload, payload.status === "degraded" ? 503 : 200);
});

export default health;
