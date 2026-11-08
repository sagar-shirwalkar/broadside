import { Hono } from "hono";
import { metricsFlusher } from "../../lib/flusher.js";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    uptime: process.uptime(),
    flusher: metricsFlusher.stats,
    timestamp: new Date().toISOString(),
  });
});

export default health;
