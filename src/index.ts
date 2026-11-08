import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as http2 from "node:http2";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createApp } from "./server/app.js";
import { routes as connectRoutes } from "./server/grpc.js";
import { startKafkaConsumer, stopKafkaConsumer } from "./server/kafka.js";
import { metricsFlusher } from "./lib/flusher.js";
import { config } from "./config.js";

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

  console.log(`[server] REST + WS  → :${config.port}`);
  console.log(`[server] gRPC       → :${config.port + 1}`);
  console.log(`[server] kafka: ${config.kafka.enabled ? "enabled" : "disabled"}`);

  const shutdown = async () => {
    console.log("\n[server] shutting down...");
    metricsFlusher.stop();
    await stopKafkaConsumer();
    wss.close();
    server.close();
    grpcServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] fatal", err);
  process.exit(1);
});
