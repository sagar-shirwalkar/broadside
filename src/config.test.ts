import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

const envKeys = [
  "PORT",
  "INGEST_PORT",
  "SERVICE_ROLE",
  "INGEST_URL",
  "DATABASE_URL",
  "LOG_LEVEL",
  "LOG_PRETTY",
  "SERVER_KEEP_ALIVE_TIMEOUT_MS",
  "SERVER_HEADERS_TIMEOUT_MS",
  "SERVER_REQUEST_TIMEOUT_MS",
  "SERVER_MAX_REQUESTS_PER_SOCKET",
  "ARTILLERY_REPORT_DIR",
  "ARTILLERY_MAX_CONCURRENT",
  "ARTILLERY_CHILD_MAX_OLD_MB",
  "ARTILLERY_CHILD_MAX_YOUNG_MB",
  "INGEST_MAX_MESSAGE_BYTES",
  "INGEST_MAX_BATCH_POINTS",
  "API_TOKEN",
  "CORS_ORIGINS",
  "UI_DIST_DIR",
  "KAFKA_BROKERS",
  "KAFKA_TOPIC",
  "RING_CAPACITY",
  "FLUSH_BATCH_SIZE",
  "FLUSH_INTERVAL_MS",
  "FLUSH_SHARDS",
  "INGEST_SLOWDOWN_THRESHOLD",
  "SLO_P95_MS",
  "SLO_ERROR_RATE",
  "SLO_WINDOW_RUNS",
  "SLO_REGRESSION_DELTA",
] as const;

const originalEnv = { ...process.env };

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key of envKeys) delete process.env[key];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("applies defaults when environment variables are absent", async () => {
    const { config } = await import("./config.js");

    expect(config).toEqual({
      port: 3000,
      ingestPort: 0,
      serviceRole: "all",
      ingestUrl: "",
      databaseUrl: undefined,
      log: {
        level: "info",
        pretty: false,
      },
      server: {
        keepAliveTimeoutMs: 65000,
        headersTimeoutMs: 66000,
        requestTimeoutMs: 120000,
        maxRequestsPerSocket: 1000,
      },
      artillery: {
        reportDir: "data/reports",
        maxConcurrentRuns: 4,
        childMaxOldGenerationMb: 0,
        childMaxYoungGenerationMb: 0,
      },
      ingest: {
        maxMessageBytes: 1048576,
        maxBatchPoints: 50000,
      },
      auth: {
        token: "",
      },
      cors: {
        origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
      },
      ui: {
        distDir: "ui/dist",
      },
      kafka: {
        enabled: false,
        brokers: [],
        topic: "artillery.metrics",
      },
      ring: {
        capacity: 16384,
        batchSize: 5000,
        flushIntervalMs: 500,
        shards: 4,
        slowDownThreshold: 0.8,
      },
      slo: {
        p95Ms: 400,
        errorRate: 0.01,
        windowRuns: 30,
        regressionDelta: 1.2,
      },
    });
  });

  it("reads overrides from the environment", async () => {
    process.env.PORT = "4000";
    process.env.INGEST_PORT = "3002";
    process.env.SERVICE_ROLE = "ingest";
    process.env.INGEST_URL = "http://ingest:3002";
    process.env.DATABASE_URL = "postgres://user:pass@db:5432/broadside";
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_PRETTY = "true";
    process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS = "70000";
    process.env.SERVER_HEADERS_TIMEOUT_MS = "71000";
    process.env.SERVER_REQUEST_TIMEOUT_MS = "130000";
    process.env.SERVER_MAX_REQUESTS_PER_SOCKET = "500";
    process.env.ARTILLERY_REPORT_DIR = "/var/lib/broadside/reports";
    process.env.ARTILLERY_MAX_CONCURRENT = "2";
    process.env.ARTILLERY_CHILD_MAX_OLD_MB = "512";
    process.env.ARTILLERY_CHILD_MAX_YOUNG_MB = "64";
    process.env.INGEST_MAX_MESSAGE_BYTES = "8192";
    process.env.INGEST_MAX_BATCH_POINTS = "1000";
    process.env.API_TOKEN = "test-token";
    process.env.CORS_ORIGINS = " https://dashboard.example.com , https://app.example.com ";
    process.env.UI_DIST_DIR = "/srv/broadside/ui";
    process.env.KAFKA_BROKERS = "broker-a:9092,broker-b:9092";
    process.env.KAFKA_TOPIC = "custom.metrics";
    process.env.RING_CAPACITY = "256";
    process.env.FLUSH_BATCH_SIZE = "128";
    process.env.FLUSH_INTERVAL_MS = "250";
    process.env.FLUSH_SHARDS = "2";
    process.env.INGEST_SLOWDOWN_THRESHOLD = "0.7";
    process.env.SLO_P95_MS = "650";
    process.env.SLO_ERROR_RATE = "0.05";
    process.env.SLO_WINDOW_RUNS = "50";
    process.env.SLO_REGRESSION_DELTA = "1.5";

    const { config } = await import("./config.js");

    expect(config).toEqual({
      port: 4000,
      ingestPort: 3002,
      serviceRole: "ingest",
      ingestUrl: "http://ingest:3002",
      databaseUrl: "postgres://user:pass@db:5432/broadside",
      log: {
        level: "debug",
        pretty: true,
      },
      server: {
        keepAliveTimeoutMs: 70000,
        headersTimeoutMs: 71000,
        requestTimeoutMs: 130000,
        maxRequestsPerSocket: 500,
      },
      artillery: {
        reportDir: "/var/lib/broadside/reports",
        maxConcurrentRuns: 2,
        childMaxOldGenerationMb: 512,
        childMaxYoungGenerationMb: 64,
      },
      ingest: {
        maxMessageBytes: 8192,
        maxBatchPoints: 1000,
      },
      auth: {
        token: "test-token",
      },
      cors: {
        origins: ["https://dashboard.example.com", "https://app.example.com"],
      },
      ui: {
        distDir: "/srv/broadside/ui",
      },
      kafka: {
        enabled: true,
        brokers: ["broker-a:9092", "broker-b:9092"],
        topic: "custom.metrics",
      },
      ring: {
        capacity: 256,
        batchSize: 128,
        flushIntervalMs: 250,
        shards: 2,
        slowDownThreshold: 0.7,
      },
      slo: {
        p95Ms: 650,
        errorRate: 0.05,
        windowRuns: 50,
        regressionDelta: 1.5,
      },
    });
  });
});
