import { Hono } from "hono";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { structuredLogger } from "@hono/structured-logger";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
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

  // Security headers on every response, including static assets served
  // below. Shoelace/Lit inject inline styles, so style-src needs
  // 'unsafe-inline'; scripts stay 'self'-only.
  app.use(async (c, next) => {
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (c.req.url.startsWith("https://")) {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
    await next();
  });

  // Gzip JSON payloads (the /raw endpoint can be megabytes). SSE is
  // excluded by hono/compress's own content-type + chunked-encoding rules.
  app.use(compress());

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
        const text = String(event.data);
        // Bound a single message: the flusher will shed load anyway, but
        // parsing a multi-megabyte JSON blob just to drop it is wasteful
        // and blocks the event loop.
        if (text.length > config.ingest.maxMessageBytes) {
          ws.send(JSON.stringify({ error: "message too large" }));
          return;
        }
        const raw = JSON.parse(text);
        const points = normalizeBatch(raw);
        const capped = points.slice(0, config.ingest.maxBatchPoints);
        if (capped.length > 0) {
          metricsFlusher.ingest(capped);
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
  // the notFound handler below, which serves the SPA entry point. The entry
  // point is read once at startup; rebuild the app (or restart) to pick up a
  // new bundle.
  const uiIndex = join(config.ui.distDir, "index.html");
  const uiIndexHtml = existsSync(uiIndex)
    ? readFileSync(uiIndex, "utf-8")
    : null;
  app.use(serveStatic({ root: config.ui.distDir }));

  app.notFound((c) => {
    const { path, method } = c.req;
    const assetLike = path.split("/").at(-1)?.includes(".") ?? false;
    if (
      method !== "GET" ||
      path.startsWith("/api/") ||
      path === "/ws" ||
      assetLike ||
      uiIndexHtml === null
    ) {
      return c.json({ error: "not found" }, 404);
    }
    return c.html(uiIndexHtml);
  });

  return app;
}
