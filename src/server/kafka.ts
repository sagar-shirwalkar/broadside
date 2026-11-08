import { Consumer, stringDeserializer, jsonDeserializer } from "@platformatic/kafka";
import { config } from "../config.js";
import { metricsFlusher } from "../lib/flusher.js";
import type { MetricBatch, MetricPoint } from "../types.js";

function createConsumer(): Consumer<string, MetricBatch> {
  return new Consumer({
    groupId: "dashboard-ingest",
    clientId: "artillery-dashboard",
    bootstrapBrokers: config.kafka.brokers,
    deserializers: {
      key: stringDeserializer,
      value: jsonDeserializer<MetricBatch>,  // ← no parentheses
    },
  });
}

type DashboardConsumer = ReturnType<typeof createConsumer>;
type DashboardStream = Awaited<ReturnType<DashboardConsumer["consume"]>>;

let consumer: DashboardConsumer | null = null;
let stream: DashboardStream | null = null;

export async function startKafkaConsumer(): Promise<void> {
  if (!config.kafka.enabled) {
    console.log("[kafka] disabled (no KAFKA_BROKERS set)");
    return;
  }

  consumer = createConsumer();

  stream = await consumer.consume({
    topics: [config.kafka.topic],
    autocommit: true,
  });

  void (async () => {
    for await (const msg of stream!) {
      const batch = msg.value as MetricBatch;
      const points: MetricPoint[] = batch.points ?? [];
      if (points.length > 0) {
        metricsFlusher.ingest(points);
      }
    }
  })().catch((err) => {
    console.error("[kafka] consumer stream error", err);
  });

  console.log(`[kafka] consuming topic "${config.kafka.topic}"`);
}

export async function stopKafkaConsumer(): Promise<void> {
  if (stream) {
    await stream.close();
    stream = null;
  }
  if (consumer) {
    await consumer.close();  // ← was "disconnect()"
    consumer = null;
  }
}
