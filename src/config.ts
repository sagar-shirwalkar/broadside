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
    /** Cap on concurrently running Artillery children (each is a process). */
    maxConcurrentRuns: parseInt(
      process.env.ARTILLERY_MAX_CONCURRENT ?? "4",
      10,
    ),
  },

  ingest: {
    /** Max bytes per WebSocket message before it is dropped. */
    maxMessageBytes: parseInt(
      process.env.INGEST_MAX_MESSAGE_BYTES ?? "1048576",
      10,
    ),
    /** Max points per batch accepted from gRPC/Kafka producers. */
    maxBatchPoints: parseInt(
      process.env.INGEST_MAX_BATCH_POINTS ?? "50000",
      10,
    ),
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

  ui: {
    // Directory containing the built dashboard. Served by the API server
    // so a single process serves both. Empty disables the UI.
    distDir: process.env.UI_DIST_DIR ?? "ui/dist",
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

  slo: {
    // Overview SLO thresholds. The SLO strip marks a run as "meeting"
    // the SLO when its aggregate p95 / error rate stays under these
    // values; the strip reports the share over the last SLO_WINDOW runs.
    p95Ms: Number(process.env.SLO_P95_MS ?? "400"),
    errorRate: Number(process.env.SLO_ERROR_RATE ?? "0.01"),
    windowRuns: parseInt(process.env.SLO_WINDOW_RUNS ?? "30", 10),
    /** Fail when met > window*1.2 of the rolling median (regression panel). */
    regressionDelta: Number(process.env.SLO_REGRESSION_DELTA ?? "1.2"),
  },
} as const;
