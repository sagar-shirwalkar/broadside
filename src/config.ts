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
  const ingestUrl = process.env.INGEST_URL ?? "";
  const databaseUrl = process.env.DATABASE_URL!;

  const log = {
    level: process.env.LOG_LEVEL ?? "info",
    pretty: process.env.LOG_PRETTY === "true",
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

  const reportDir = process.env.ARTILLERY_REPORT_DIR ?? "data/reports";

  const server = Validation.ok<
    ConfigError,
    (
      keepAliveTimeoutMs: number,
    ) => (
      headersTimeoutMs: number,
    ) => (
      requestTimeoutMs: number,
    ) => (
      maxRequestsPerSocket: number,
    ) => (maxConnections: number) => AppConfig["server"]
  >(
    (keepAliveTimeoutMs) =>
      (headersTimeoutMs) =>
        (requestTimeoutMs) =>
          (maxRequestsPerSocket) =>
            (maxConnections) => ({
              keepAliveTimeoutMs,
              headersTimeoutMs,
              requestTimeoutMs,
              maxRequestsPerSocket,
              maxConnections,
            }),
  )
    .ap(parseIntEnv("SERVER_KEEP_ALIVE_TIMEOUT_MS", "65000"))
    .ap(parseIntEnv("SERVER_HEADERS_TIMEOUT_MS", "66000"))
    .ap(parseIntEnv("SERVER_REQUEST_TIMEOUT_MS", "120000"))
    .ap(parseIntEnv("SERVER_MAX_REQUESTS_PER_SOCKET", "1000"))
    .ap(parseIntEnv("SERVER_MAX_CONNECTIONS", "0"));

  const artillery = Validation.ok<
    ConfigError,
    (
      maxConcurrentRuns: number,
    ) => (
      childMaxOldGenerationMb: number,
    ) => (childMaxYoungGenerationMb: number) => AppConfig["artillery"]
  >(
    (maxConcurrentRuns) =>
      (childMaxOldGenerationMb) =>
        (childMaxYoungGenerationMb) => ({
          reportDir,
          maxConcurrentRuns,
          childMaxOldGenerationMb,
          childMaxYoungGenerationMb,
        }),
  )
    .ap(parseIntEnv("ARTILLERY_MAX_CONCURRENT", "4"))
    .ap(parseIntEnv("ARTILLERY_CHILD_MAX_OLD_MB", "0"))
    .ap(parseIntEnv("ARTILLERY_CHILD_MAX_YOUNG_MB", "0"));

  const ingest = Validation.ok<
    ConfigError,
    (maxMessageBytes: number) => (maxBatchPoints: number) => AppConfig["ingest"]
  >((maxMessageBytes) => (maxBatchPoints) => ({
    maxMessageBytes,
    maxBatchPoints,
  }))
    .ap(parseIntEnv("INGEST_MAX_MESSAGE_BYTES", "1048576"))
    .ap(parseIntEnv("INGEST_MAX_BATCH_POINTS", "50000"));

  const ring = Validation.ok<
    ConfigError,
    (
      capacity: number,
    ) => (
      batchSize: number,
    ) => (
      flushIntervalMs: number,
    ) => (shards: number) => (slowDownThreshold: number) => AppConfig["ring"]
  >(
    (capacity) =>
      (batchSize) =>
        (flushIntervalMs) =>
          (shards) =>
            (slowDownThreshold) => ({
              capacity,
              batchSize,
              flushIntervalMs,
              shards: Math.max(1, shards),
              slowDownThreshold,
            }),
  )
    .ap(parseIntEnv("RING_CAPACITY", "16384"))
    .ap(parseIntEnv("FLUSH_BATCH_SIZE", "5000"))
    .ap(parseIntEnv("FLUSH_INTERVAL_MS", "500"))
    .ap(parseIntEnv("FLUSH_SHARDS", "4"))
    .ap(parseNumberEnv("INGEST_SLOWDOWN_THRESHOLD", "0.8"));

  const slo = Validation.ok<
    ConfigError,
    (
      p95Ms: number,
    ) => (
      errorRate: number,
    ) => (windowRuns: number) => (regressionDelta: number) => AppConfig["slo"]
  >(
    (p95Ms) =>
      (errorRate) =>
        (windowRuns) =>
          (regressionDelta) => ({
            p95Ms,
            errorRate,
            windowRuns,
            regressionDelta,
          }),
  )
    .ap(parseNumberEnv("SLO_P95_MS", "400"))
    .ap(parseNumberEnv("SLO_ERROR_RATE", "0.01"))
    .ap(parseIntEnv("SLO_WINDOW_RUNS", "30"))
    .ap(parseNumberEnv("SLO_REGRESSION_DELTA", "1.2"));

  return Validation.ok<
    ConfigError,
    (
      port: number,
    ) => (
      ingestPort: number,
    ) => (
      serviceRole: "all" | "api" | "ingest",
    ) => (
      serverValue: AppConfig["server"],
    ) => (
      artilleryValue: AppConfig["artillery"],
    ) => (
      ingestValue: AppConfig["ingest"],
    ) => (
      ringValue: AppConfig["ring"],
    ) => (sloValue: AppConfig["slo"]) => AppConfig
  >(
    (port) =>
      (ingestPort) =>
        (serviceRole) =>
          (serverValue) =>
            (artilleryValue) =>
              (ingestValue) =>
                (ringValue) =>
                  (sloValue) => ({
                    port,
                    ingestPort,
                    serviceRole,
                    ingestUrl,
                    databaseUrl,
                    log,
                    server: serverValue,
                    artillery: artilleryValue,
                    ingest: ingestValue,
                    auth,
                    cors,
                    ui,
                    kafka,
                    ring: ringValue,
                    slo: sloValue,
                  }),
  )
    .ap(parseIntEnv("PORT", "3000"))
    .ap(parseIntEnv("INGEST_PORT", "0"))
    .ap(parseServiceRole())
    .ap(server)
    .ap(artillery)
    .ap(ingest)
    .ap(ring)
    .ap(slo);
}

export const config = parseConfig().match({
  fail: (errors) => {
    throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
  },
  ok: (value) => value,
});