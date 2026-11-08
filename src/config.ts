import { config as loadEnv } from "dotenv";
loadEnv();

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  databaseUrl: process.env.DATABASE_URL!,

  log: {
    level: process.env.LOG_LEVEL ?? "info",
    pretty: process.env.LOG_PRETTY === "true",
  },

  artillery: {
    reportDir: process.env.ARTILLERY_REPORT_DIR ?? "data/reports",
  },

  auth: {
    // Empty disables authentication (local development default). Set a
    // non-empty token to require `Authorization: Bearer <token>` (or
    // `?token=` for WebSocket/SSE clients that cannot set headers).
    token: process.env.API_TOKEN ?? "",
  },

  cors: {
    // Comma-separated allow-list of browser origins. Defaults to the Vite
    // dev server. Set to "*" to allow any origin.
    origins: (
      process.env.CORS_ORIGINS ??
      "http://localhost:5173,http://127.0.0.1:5173"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  kafka: {
    enabled: Boolean(process.env.KAFKA_BROKERS),
    brokers: process.env.KAFKA_BROKERS?.split(",") ?? [],
    topic: process.env.KAFKA_TOPIC ?? "artillery.metrics",
  },

  ring: {
    capacity: parseInt(process.env.RING_CAPACITY ?? "16384", 10),
    batchSize: parseInt(process.env.FLUSH_BATCH_SIZE ?? "5000", 10),
    flushIntervalMs: parseInt(process.env.FLUSH_INTERVAL_MS ?? "500", 10),
  },
} as const;
