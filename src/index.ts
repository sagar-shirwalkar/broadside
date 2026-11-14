import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as http2 from "node:http2";
import type { Server as HttpServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createApp, createIngestApp } from "./server/app.ts";
import { routes as connectRoutes } from "./server/grpc.ts";
import { startKafkaConsumer, stopKafkaConsumer } from "./server/kafka.ts";
import { metricsFlusher } from "./lib/flusher.ts";
import { killAllRuns } from "./lib/artillery.ts";
import { ingestTracker } from "./lib/ingest-tracker.ts";
import { config } from "./config.ts";
import { logger } from "./logger.ts";

function tuneHttpServer(server: HttpServer): void {
  server.keepAliveTimeout = config.server.keepAliveTimeoutMs;
  // headersTimeout must exceed keepAliveTimeout to avoid premature resets.
  server.headersTimeout = Math.max(
    config.server.headersTimeoutMs,
    server.keepAliveTimeout + 1000,
  );
  if (config.server.requestTimeoutMs > 0) {
    server.requestTimeout = config.server.requestTimeoutMs;
  }
  if (config.server.maxRequestsPerSocket > 0) {
    server.maxRequestsPerSocket = config.server.maxRequestsPerSocket;
  }
}

async function main() {
  metricsFlusher.start();
  ingestTracker.start();
  if (config.serviceRole === "ingest" || config.serviceRole === "all") {
    await startKafkaConsumer();
  }

  let server: HttpServer | null = null;
  let wss: WebSocketServer | null = null;
  let ingestServer: HttpServer | null = null;
  let ingestWss: WebSocketServer | null = null;
  let grpcServer: http2.Http2Server | null = null;

  if (config.serviceRole === "api" || config.serviceRole === "all") {
    // ─── REST + (optional) WebSocket (HTTP/1.1) ───
    const app = createApp();
    wss = new WebSocketServer({ noServer: true });
    server = serve({
      fetch: app.fetch,
      port: config.port,
      websocket: { server: wss },
    }) as HttpServer;
    tuneHttpServer(server);

    // Optional dedicated ingest listener on same instance to isolate WS accept/socket budget.
    if (
      config.serviceRole === "all" &&
      config.ingestPort > 0 &&
      config.ingestPort !== config.port
    ) {
      const ingestApp = createIngestApp();
      ingestWss = new WebSocketServer({ noServer: true });
      ingestServer = serve({
        fetch: ingestApp.fetch,
        port: config.ingestPort,
        websocket: { server: ingestWss },
      }) as HttpServer;
      tuneHttpServer(ingestServer);
    }
  }

  if (config.serviceRole === "ingest") {
    const ingestApp = createIngestApp();
    ingestWss = new WebSocketServer({ noServer: true });
    ingestServer = serve({
      fetch: ingestApp.fetch,
      port: config.ingestPort > 0 ? config.ingestPort : config.port,
      websocket: { server: ingestWss },
    }) as HttpServer;
    tuneHttpServer(ingestServer);
  }

  if (config.serviceRole === "api" || config.serviceRole === "all") {
    // ─── Connect / gRPC (HTTP/2) ───
    grpcServer = http2.createServer(
      connectNodeAdapter({ routes: connectRoutes }),
    );
    grpcServer.listen(config.port + 1);
  }

  if (server) logger.info({ port: config.port, role: config.serviceRole }, "[server] REST listening");
  if (ingestServer) {
    logger.info(
      { port: config.ingestPort > 0 ? config.ingestPort : config.port, role: config.serviceRole },
      "[server] ingest WebSocket listening",
    );
  }
  if (grpcServer) logger.info({ port: config.port + 1 }, "[server] gRPC listening");
  logger.info(
    { enabled: config.kafka.enabled },
    `[server] kafka: ${config.kafka.enabled ? "enabled" : "disabled"}`,
  );

  const shutdown = async () => {
    logger.info("[server] shutting down");
    ingestTracker.stop();
    await metricsFlusher.stop();
    await stopKafkaConsumer();
    const killed = killAllRuns();
    if (killed > 0) {
      logger.info({ killed }, "[server] terminated artillery child processes");
    }
    wss?.close();
    ingestWss?.close();
    server?.close();
    ingestServer?.close();
    grpcServer?.close();
    logger.flush();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "[server] fatal");
  logger.flush();
  process.exit(1);
});
