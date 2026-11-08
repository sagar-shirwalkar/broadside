import { config as loadEnv } from "dotenv";
loadEnv();

export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  databaseUrl: process.env.DATABASE_URL!,

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
