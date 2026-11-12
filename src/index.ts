import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as http2 from "node:http2";
import type { Server as HttpServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createApp, createIngestApp } from "./server/app.js";
import { routes as connectRoutes } from "./server/grpc.js";
import { startKafkaConsumer, stopKafkaConsumer } from "./server/kafka.js";
import { metricsFlusher } from "./lib/flusher.js";
import { killAllRuns } from "./lib/artillery.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

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
  await startKafkaConsumer();

  // ─── REST + WebSocket (HTTP/1.1) ───
  const app = createApp();
  const wss = new WebSocketServer({ noServer: true });

  const server = serve({
    fetch: app.fetch,
    port: config.port,
    websocket: { server: wss },
  }) as HttpServer;
  tuneHttpServer(server);

  // Optional dedicated ingest listener to isolate WS accept/socket budget.
  let ingestServer: HttpServer | null = null;
  let ingestWss: WebSocketServer | null = null;
  if (config.ingestPort > 0 && config.ingestPort !== config.port) {
    const ingestApp = createIngestApp();
    ingestWss = new WebSocketServer({ noServer: true });
    ingestServer = serve({
      fetch: ingestApp.fetch,
      port: config.ingestPort,
      websocket: { server: ingestWss },
    }) as HttpServer;
    tuneHttpServer(ingestServer);
  }

  // ─── Connect / gRPC (HTTP/2) ───
  const grpcServer = http2.createServer(
    connectNodeAdapter({ routes: connectRoutes }),
  );
  grpcServer.listen(config.port + 1);

  logger.info({ port: config.port }, "[server] REST + WebSocket listening");
  if (ingestServer) {
    logger.info(
      { port: config.ingestPort },
      "[server] dedicated ingest WebSocket listening",
    );
  }
  logger.info({ port: config.port + 1 }, "[server] gRPC listening");
  logger.info(
    { enabled: config.kafka.enabled },
    `[server] kafka: ${config.kafka.enabled ? "enabled" : "disabled"}`,
  );

  const shutdown = async () => {
    logger.info("[server] shutting down");
    await metricsFlusher.stop();
    await stopKafkaConsumer();
    // Orphaned Artillery children outlive their parent — terminate them so
    // a restart does not leak running load tests (and their memory).
    const killed = killAllRuns();
    if (killed > 0) {
      logger.info({ killed }, "[server] terminated artillery child processes");
    }
    wss.close();
    ingestWss?.close();
    server.close();
    ingestServer?.close();
    grpcServer.close();
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
