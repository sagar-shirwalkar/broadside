import { Hono } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { structuredLogger } from "@hono/structured-logger";
import { logger, type AppEnv } from "../logger.js";
import { normalizeBatch } from "../lib/normalize.js";
import { metricsFlusher } from "../lib/flusher.js";
import runs from "./routes/runs.js";
import health from "./routes/health.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    structuredLogger<AppEnv, typeof logger>({
      createLogger: () => logger,
      onResponse: (log, c, elapsedMs) => {
        log.info(
          {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
            durationMs: Math.round(elapsedMs),
          },
          "request completed",
        );
      },
      onError: (log, err, c, elapsedMs) => {
        log.error(
          {
            err,
            method: c.req.method,
            path: c.req.path,
            durationMs: Math.round(elapsedMs),
          },
          "request failed",
        );
      },
    }),
  );

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
