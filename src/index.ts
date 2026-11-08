import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as http2 from "node:http2";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createApp } from "./server/app.js";
import { routes as connectRoutes } from "./server/grpc.js";
import { startKafkaConsumer, stopKafkaConsumer } from "./server/kafka.js";
import { metricsFlusher } from "./lib/flusher.js";
import { killAllRuns } from "./lib/artillery.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

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
  });

  // ─── Connect / gRPC (HTTP/2) ───
  const grpcServer = http2.createServer(
    connectNodeAdapter({ routes: connectRoutes })
  );
  grpcServer.listen(config.port + 1);

  logger.info({ port: config.port }, "[server] REST + WebSocket listening");
  logger.info({ port: config.port + 1 }, "[server] gRPC listening");
  logger.info(
    { enabled: config.kafka.enabled },
    `[server] kafka: ${config.kafka.enabled ? "enabled" : "disabled"}`,
  );

  const shutdown = async () => {
    logger.info("[server] shutting down");
    metricsFlusher.stop();
    await stopKafkaConsumer();
    // Orphaned Artillery children outlive their parent — terminate them so
    // a restart does not leak running load tests (and their memory).
    const killed = killAllRuns();
    if (killed > 0) {
      logger.info({ killed }, "[server] terminated artillery child processes");
    }
    wss.close();
    server.close();
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
