import { Hono } from "hono";
import { sql } from "../../db/client.js";
import { metricsFlusher } from "../../lib/flusher.js";
import { logger } from "../../logger.js";

const health = new Hono();

health.get("/", async (c) => {
  let database: "ok" | "error" = "ok";
  try {
    await sql`SELECT 1`;
  } catch (err) {
    database = "error";
    logger.error({ err }, "[health] database check failed");
  }

  const degraded = database !== "ok";
  return c.json(
    {
      status: degraded ? "degraded" : "ok",
      uptime: process.uptime(),
      database: { status: database },
      flusher: metricsFlusher.stats,
      timestamp: new Date().toISOString(),
    },
    degraded ? 503 : 200,
  );
});

export default health;
