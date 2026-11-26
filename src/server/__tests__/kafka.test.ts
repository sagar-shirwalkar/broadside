import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    enabled: false,
    stream: null as any,
    consumer: null as any,
  };

  const Consumer = vi.fn().mockImplementation(function (
    this: any,
    options: unknown,
  ) {
    this.options = options;
    this.consume = vi.fn(async () => state.stream);
    this.close = vi.fn(async () => {});
    state.consumer = this;
  });

  return {
    state,
    Consumer,
    stringDeserializer: { kind: "string" },
    jsonDeserializer: vi.fn(() => ({ kind: "json" })),
    ingest: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@platformatic/kafka", () => ({
  Consumer: h.Consumer,
  stringDeserializer: h.stringDeserializer,
  jsonDeserializer: h.jsonDeserializer,
}));
vi.mock("../../config.ts", () => ({
  config: {
    kafka: {
      get enabled() {
        return h.state.enabled;
      },
      brokers: ["broker:9092"],
      topic: "artillery.metrics",
    },
  },
}));
vi.mock("../../lib/flusher.ts", () => ({
  metricsFlusher: { ingest: h.ingest },
}));
vi.mock("../../logger.ts", () => ({ logger: h.logger }));

let kafka: typeof import(".././kafka.ts");

describe("Kafka consumer", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.state.enabled = false;
    h.state.stream = null;
    h.state.consumer = null;
    h.Consumer.mockClear();
    h.ingest.mockClear();
    h.jsonDeserializer.mockClear();
    kafka = await import(".././kafka.ts");
  });

  it("does nothing when Kafka is disabled", async () => {
    await kafka.startKafkaConsumer();

    expect(h.Consumer).not.toHaveBeenCalled();
    expect(h.ingest).not.toHaveBeenCalled();
    expect(h.logger.info).toHaveBeenCalledWith(
      "[kafka] disabled (no KAFKA_BROKERS set)",
    );
  });

  it("consumes batches and ingests non-empty points", async () => {
    h.state.enabled = true;
    const points = [{ runId: "run-1" }];
    const close = vi.fn(async () => {});

    let finished!: () => void;
    const consumed = new Promise<void>((resolve) => {
      finished = resolve;
    });

    h.state.stream = {
      close,
      [Symbol.asyncIterator]: async function* () {
        yield { value: { run_id: "run-1", points } };
        yield { value: { run_id: "run-1", points: [] } };
        yield { value: { run_id: "run-1" } };
        finished();
      },
    };

    await kafka.startKafkaConsumer();
    await consumed;
    await vi.waitFor(() => expect(h.ingest).toHaveBeenCalledTimes(1));

    expect(h.ingest).toHaveBeenCalledWith(points);
    expect(h.Consumer).toHaveBeenCalledTimes(1);
    expect(h.Consumer.mock.calls[0]?.[0]).toMatchObject({
      groupId: "dashboard-ingest",
      clientId: "artillery-dashboard",
      bootstrapBrokers: ["broker:9092"],
      deserializers: {
        key: h.stringDeserializer,
        value: h.jsonDeserializer,
      },
    });
    expect(h.state.consumer.consume).toHaveBeenCalledWith({
      topics: ["artillery.metrics"],
      autocommit: true,
    });
    expect(h.logger.info).toHaveBeenCalledWith(
      { topic: "artillery.metrics" },
      "[kafka] consuming topic",
    );

    const consumer = h.state.consumer;
    await kafka.stopKafkaConsumer();

    expect(close).toHaveBeenCalledTimes(1);
    expect(consumer.close).toHaveBeenCalledTimes(1);
  });

  it("logs stream errors", async () => {
    h.state.enabled = true;
    const error = new Error("stream failed");
    h.state.stream = {
      close: vi.fn(async () => {}),
      [Symbol.asyncIterator]: async function* () {
        throw error;
      },
    };

    await kafka.startKafkaConsumer();

    await vi.waitFor(() =>
      expect(h.logger.error).toHaveBeenCalledWith(
        { err: error },
        "[kafka] consumer stream error",
      ),
    );
  });

  it("is safe to stop before starting", async () => {
    await expect(kafka.stopKafkaConsumer()).resolves.toBeUndefined();
  });
});
