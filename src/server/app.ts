import { Hono } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { structuredLogger } from "@hono/structured-logger";
import { cors } from "hono/cors";
import { logger, type AppEnv } from "../logger.js";
import { config } from "../config.js";
import { normalizeBatch } from "../lib/normalize.js";
import { metricsFlusher } from "../lib/flusher.js";
import { createAuthMiddleware } from "./middleware/auth.js";
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

  // CORS before authentication: preflight (OPTIONS) requests never carry
  // credentials, and the CORS middleware answers them itself.
  app.use(
    cors({
      origin: config.cors.origins.includes("*")
        ? "*"
        : config.cors.origins,
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    }),
  );

  // Bearer token on the data plane. The health endpoint stays public so
  // load balancers and uptime monitors can probe it.
  const auth = createAuthMiddleware(config.auth.token);
  app.use("/api/runs/*", auth);
  app.use("/ws", auth);

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
