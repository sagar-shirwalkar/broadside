import { config as loadEnv } from "dotenv";
import { Validation } from "@broadside/fp/validation";

loadEnv();

type ConfigError = string;

type AppConfig = {
  readonly port: number;
  readonly ingestPort: number;
  readonly serviceRole: "all" | "api" | "ingest";
  readonly ingestUrl: string;
  readonly databaseUrl: string;
  readonly log: { readonly level: string; readonly pretty: boolean };
  readonly server: {
    readonly keepAliveTimeoutMs: number;
    readonly headersTimeoutMs: number;
    readonly requestTimeoutMs: number;
    readonly maxRequestsPerSocket: number;
    readonly maxConnections: number;
  };
  readonly artillery: {
    readonly reportDir: string;
    readonly maxConcurrentRuns: number;
    readonly childMaxOldGenerationMb: number;
    readonly childMaxYoungGenerationMb: number;
  };
  readonly ingest: { readonly maxMessageBytes: number; readonly maxBatchPoints: number };
  readonly auth: { readonly token: string };
  readonly cors: { readonly origins: string[] };
  readonly ui: { readonly distDir: string };
  readonly kafka: { readonly enabled: boolean; readonly brokers: string[]; readonly topic: string };
  readonly ring: {
    readonly capacity: number;
    readonly batchSize: number;
    readonly flushIntervalMs: number;
    readonly shards: number;
    readonly slowDownThreshold: number;
  };
  readonly slo: {
    readonly p95Ms: number;
    readonly errorRate: number;
    readonly windowRuns: number;
    readonly regressionDelta: number;
  };
};

function parseIntEnv(
  name: string,
  fallback: string,
): Validation<ConfigError, number> {
  const raw = process.env[name] ?? fallback;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return Validation.fail(`${name} must be an integer (got "${raw}")`);
  }
  return Validation.ok(value);
}

function parseNumberEnv(
  name: string,
  fallback: string,
): Validation<ConfigError, number> {
  const raw = process.env[name] ?? fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return Validation.fail(`${name} must be a finite number (got "${raw}")`);
  }
  return Validation.ok(value);
}

function parseServiceRole(): Validation<ConfigError, "all" | "api" | "ingest"> {
  const raw = process.env.SERVICE_ROLE ?? "all";
  if (raw === "all" || raw === "api" || raw === "ingest") {
    return Validation.ok(raw);
  }
  return Validation.fail(
    `SERVICE_ROLE must be one of "all" | "api" | "ingest" (got "${raw}")`,
  );
}

function parseConfig(): Validation<ConfigError, AppConfig> {
  // Collect all independent validation errors instead of failing on the first.
  const errors: ConfigError[] = [];
  const take = <T>(v: Validation<ConfigError, T>, fallback: T): T => {
    if (v.isFail()) {
      errors.push(...v.violationArray);
      return fallback;
    }
    return v.valueOrUndefined as T;
  };

  const port = take(parseIntEnv("PORT", "3000"), 3000);
  const ingestPort = take(parseIntEnv("INGEST_PORT", "0"), 0);
  const serviceRole = take(parseServiceRole(), "all");
  const ingestUrl = process.env.INGEST_URL ?? "";
  const databaseUrl = process.env.DATABASE_URL!;

  const log = {
    level: process.env.LOG_LEVEL ?? "info",
    pretty: process.env.LOG_PRETTY === "true",
  };

  const server = {
    keepAliveTimeoutMs: take(parseIntEnv("SERVER_KEEP_ALIVE_TIMEOUT_MS", "65000"), 65000),
    headersTimeoutMs: take(parseIntEnv("SERVER_HEADERS_TIMEOUT_MS", "66000"), 66000),
    requestTimeoutMs: take(parseIntEnv("SERVER_REQUEST_TIMEOUT_MS", "120000"), 120000),
    maxRequestsPerSocket: take(parseIntEnv("SERVER_MAX_REQUESTS_PER_SOCKET", "1000"), 1000),
    maxConnections: take(parseIntEnv("SERVER_MAX_CONNECTIONS", "0"), 0),
  };

  const artillery = {
    reportDir: process.env.ARTILLERY_REPORT_DIR ?? "data/reports",
    maxConcurrentRuns: take(parseIntEnv("ARTILLERY_MAX_CONCURRENT", "4"), 4),
    childMaxOldGenerationMb: take(parseIntEnv("ARTILLERY_CHILD_MAX_OLD_MB", "0"), 0),
    childMaxYoungGenerationMb: take(parseIntEnv("ARTILLERY_CHILD_MAX_YOUNG_MB", "0"), 0),
  };

  const ingest = {
    maxMessageBytes: take(parseIntEnv("INGEST_MAX_MESSAGE_BYTES", "1048576"), 1048576),
    maxBatchPoints: take(parseIntEnv("INGEST_MAX_BATCH_POINTS", "50000"), 50000),
  };

  const auth = {
    token: process.env.API_TOKEN ?? "",
  };

  const cors = {
    origins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };

  const ui = {
    distDir: process.env.UI_DIST_DIR ?? "ui/dist",
  };

  const kafka = {
    enabled: Boolean(process.env.KAFKA_BROKERS),
    brokers: process.env.KAFKA_BROKERS?.split(",") ?? [],
    topic: process.env.KAFKA_TOPIC ?? "artillery.metrics",
  };

  const ring = {
    capacity: take(parseIntEnv("RING_CAPACITY", "16384"), 16384),
    batchSize: take(parseIntEnv("FLUSH_BATCH_SIZE", "5000"), 5000),
    flushIntervalMs: take(parseIntEnv("FLUSH_INTERVAL_MS", "500"), 500),
    shards: Math.max(1, take(parseIntEnv("FLUSH_SHARDS", "4"), 4)),
    slowDownThreshold: take(parseNumberEnv("INGEST_SLOWDOWN_THRESHOLD", "0.8"), 0.8),
  };

  const slo = {
    p95Ms: take(parseNumberEnv("SLO_P95_MS", "400"), 400),
    errorRate: take(parseNumberEnv("SLO_ERROR_RATE", "0.01"), 0.01),
    windowRuns: take(parseIntEnv("SLO_WINDOW_RUNS", "30"), 30),
    regressionDelta: take(parseNumberEnv("SLO_REGRESSION_DELTA", "1.2"), 1.2),
  };

  const built: AppConfig = {
    port,
    ingestPort,
    serviceRole,
    ingestUrl,
    databaseUrl,
    log,
    server,
    artillery,
    ingest,
    auth,
    cors,
    ui,
    kafka,
    ring,
    slo,
  };

  if (errors.length > 0) {
    return Validation.failFromArray<ConfigError, AppConfig>(errors);
  }
  return Validation.ok(built);
}

export const config = parseConfig().match({
  fail: (errors) => {
    throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
  },
  ok: (value) => value,
});