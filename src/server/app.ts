import { Hono } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { normalizeBatch } from "../lib/normalize.js";
import { metricsFlusher } from "../lib/flusher.js";
import runs from "./routes/runs.js";
import health from "./routes/health.js";

export function createApp(): Hono {
  const app = new Hono();

  // WebSocket ingestion
  app.get("/ws", upgradeWebSocket(() => ({
    onMessage(event, ws) {
      try {
        const raw = JSON.parse(String(event.data));
        const points = normalizeBatch(raw);
        if (points.length > 0) {
          metricsFlusher.ingest(points);
        }
      } catch {
        ws.send(JSON.stringify({ error: "invalid message" }));
      }
    },
  })));

  // REST API
  app.route("/api/runs", runs);
  app.route("/api/health", health);

  return app;
}
