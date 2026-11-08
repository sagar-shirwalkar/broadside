import { Hono } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { structuredLogger } from "@hono/structured-logger";
import { cors } from "hono/cors";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  // Dashboard (built into config.ui.distDir). Missing files fall through to
  // the notFound handler below, which serves the SPA entry point.
  const uiIndex = join(config.ui.distDir, "index.html");
  app.use(serveStatic({ root: config.ui.distDir }));

  app.notFound((c) => {
    const { path, method } = c.req;
    const assetLike = path.split("/").at(-1)?.includes(".") ?? false;
    if (
      method !== "GET" ||
      path.startsWith("/api/") ||
      path === "/ws" ||
      assetLike ||
      !existsSync(uiIndex)
    ) {
      return c.json({ error: "not found" }, 404);
    }
    return c.html(readFileSync(uiIndex, "utf-8"));
  });

  return app;
}
