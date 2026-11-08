import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: vi.fn() }));

const envKeys = [
  "PORT",
  "DATABASE_URL",
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
    });
  });

  it("reads overrides from the environment", async () => {
    process.env.PORT = "4000";
    process.env.DATABASE_URL = "postgres://user:pass@db:5432/broadside";
    process.env.KAFKA_BROKERS = "broker-a:9092,broker-b:9092";
    process.env.KAFKA_TOPIC = "custom.metrics";
    process.env.RING_CAPACITY = "256";
    process.env.FLUSH_BATCH_SIZE = "128";
    process.env.FLUSH_INTERVAL_MS = "250";

    const { config } = await import("../src/config.js");

    expect(config).toEqual({
      port: 4000,
      databaseUrl: "postgres://user:pass@db:5432/broadside",
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
    });
  });
});
