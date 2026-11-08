import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ingest: vi.fn() }));

vi.mock("../src/lib/flusher.js", () => ({
  metricsFlusher: { ingest: h.ingest },
}));

import { Ingest } from "../src/gen/metrics/v1/ingest_pb.js";
import { routes } from "../src/server/grpc.js";

interface ServiceImpl {
  streamMetrics: (
    stream: AsyncIterable<any>,
    ctx: unknown,
  ) => Promise<{ accepted: number; dropped: number }>;
  pushMetrics: (
    req: any,
    ctx: unknown,
  ) => Promise<{ accepted: number; dropped: number }>;
}

function setup() {
  let impl: ServiceImpl | undefined;
  const router = {
    service: vi.fn((_service: unknown, serviceImpl: ServiceImpl) => {
      impl = serviceImpl;
    }),
  };

  routes(router as any);

  if (!impl) throw new Error("service implementation was not registered");
  return { impl, router };
}

function protoPoint(overrides: Record<string, unknown> = {}) {
  return {
    timeMs: 1000n,
    endpoint: "/api",
    rps: 1,
    p50: 2,
    p95: 3,
    p99: 4,
    errorRate: 0.5,
    ...overrides,
  };
}

async function* batches(items: any[]) {
  for (const item of items) yield item;
}

describe("gRPC routes", () => {
  it("registers the Ingest service", () => {
    const { router } = setup();

    expect(router.service).toHaveBeenCalledWith(Ingest, expect.any(Object));
  });

  it("streams batches into the flusher and sums accepted points", async () => {
    const { impl } = setup();

    const ack = await impl.streamMetrics(
      batches([
        { runId: "run-a", points: [protoPoint()] },
        {
          runId: "run-b",
          points: [protoPoint({ endpoint: "/b" }), protoPoint({ endpoint: "/c" })],
        },
      ]),
      {},
    );

    expect(ack).toEqual({ accepted: 3, dropped: 0 });
    expect(h.ingest).toHaveBeenCalledTimes(2);
    expect(h.ingest.mock.calls[0]?.[0]).toEqual([
      {
        time: new Date(1000),
        runId: "run-a",
        endpoint: "/api",
        rps: 1,
        p50: 2,
        p95: 3,
        p99: 4,
        errorRate: 0.5,
      },
    ]);
    expect(h.ingest.mock.calls[1]?.[0]).toHaveLength(2);
  });

  it("handles an empty stream", async () => {
    const { impl } = setup();

    const ack = await impl.streamMetrics(batches([]), {});

    expect(ack).toEqual({ accepted: 0, dropped: 0 });
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("pushes a single batch into the flusher", async () => {
    const { impl } = setup();

    const ack = await impl.pushMetrics(
      { runId: "run-1", points: [protoPoint(), protoPoint()] },
      {},
    );

    expect(ack).toEqual({ accepted: 2, dropped: 0 });
    expect(h.ingest).toHaveBeenCalledWith([
      expect.objectContaining({ runId: "run-1" }),
      expect.objectContaining({ runId: "run-1" }),
    ]);
  });

  it("handles an empty push batch", async () => {
    const { impl } = setup();

    const ack = await impl.pushMetrics({ runId: "run-1", points: [] }, {});

    expect(ack).toEqual({ accepted: 0, dropped: 0 });
    expect(h.ingest).toHaveBeenCalledWith([]);
  });
});
