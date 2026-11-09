import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

const envKeys = [
  "PORT",
  "DATABASE_URL",
  "LOG_LEVEL",
  "LOG_PRETTY",
  "ARTILLERY_REPORT_DIR",
  "ARTILLERY_MAX_CONCURRENT",
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
    const { config } = await import("../src/config.js");

    expect(config).toEqual({
      port: 3000,
      databaseUrl: undefined,
      log: {
        level: "info",
        pretty: false,
      },
      artillery: {
        reportDir: "data/reports",
        maxConcurrentRuns: 4,
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
    process.env.DATABASE_URL = "postgres://user:pass@db:5432/broadside";
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_PRETTY = "true";
    process.env.ARTILLERY_REPORT_DIR = "/var/lib/broadside/reports";
    process.env.ARTILLERY_MAX_CONCURRENT = "2";
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
    process.env.SLO_P95_MS = "650";
    process.env.SLO_ERROR_RATE = "0.05";
    process.env.SLO_WINDOW_RUNS = "50";
    process.env.SLO_REGRESSION_DELTA = "1.5";

    const { config } = await import("../src/config.js");

    expect(config).toEqual({
      port: 4000,
      databaseUrl: "postgres://user:pass@db:5432/broadside",
      log: {
        level: "debug",
        pretty: true,
      },
      artillery: {
        reportDir: "/var/lib/broadside/reports",
        maxConcurrentRuns: 2,
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
