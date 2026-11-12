import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  logger: { error: vi.fn() },
}));
const { sqlMock } = h;

vi.mock("../src/config.js", () => ({
  config: {
    ring: {
      capacity: 4,
      batchSize: 2,
      flushIntervalMs: 1000,
      shards: 1,
      slowDownThreshold: 0.8,
    },
  },
}));
vi.mock("../src/db/client.js", () => ({ sql: h.sqlMock }));
vi.mock("../src/logger.js", () => ({ logger: h.logger }));

import { MetricsFlusher } from "../src/lib/flusher.js";
import type { MetricPoint } from "../src/types.js";

function point(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    time: new Date("2026-01-01T00:00:00.000Z"),
    runId: "run-1",
    endpoint: "/api",
    rps: 1,
    p50: 2,
    p95: 3,
    p99: 4,
    errorRate: 0,
    ...overrides,
  };
}

/**
 * `sql` is used twice per write: once as `sql(rows)` to build the INSERT helper
 * and once as the tagged template that executes it. Only the tagged-template
 * call performs the write.
 */
function writeCalls() {
  return sqlMock.mock.calls.filter(([first]) => (first as any)?.raw);
}

describe("MetricsFlusher", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockImplementation((first: any) =>
      first?.raw ? Promise.resolve([]) : first,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers points below the batch threshold", () => {
    const flusher = new MetricsFlusher();

    flusher.ingest([point()]);

    expect(flusher.stats).toMatchObject({ buffered: 1, dropped: 0, flushed: 0 });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("flushes immediately when the batch size is reached", async () => {
    const flusher = new MetricsFlusher();

    flusher.ingest([point(), point({ endpoint: "/other" })]);

    await vi.waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(flusher.stats).toMatchObject({ buffered: 0, dropped: 0, flushed: 2 });

    const rows = writeCalls()[0]?.[1];
    expect(rows).toEqual([
      {
        time: "2026-01-01T00:00:00.000Z",
        run_id: "run-1",
        endpoint: "/api",
        rps: 1,
        p50: 2,
        p95: 3,
        p99: 4,
        error_rate: 0,
        vusers_started: null,
        vusers_stopped: null,
        vusers_created: null,
        vusers_completed: null,
        error_count: null,
        hist_min: null,
        hist_max: null,
        hist_p75: null,
        hist_p90: null,
        hist_p999: null,
      },
      {
        time: "2026-01-01T00:00:00.000Z",
        run_id: "run-1",
        endpoint: "/other",
        rps: 1,
        p50: 2,
        p95: 3,
        p99: 4,
        error_rate: 0,
        vusers_started: null,
        vusers_stopped: null,
        vusers_created: null,
        vusers_completed: null,
        error_count: null,
        hist_min: null,
        hist_max: null,
        hist_p75: null,
        hist_p90: null,
        hist_p999: null,
      },
    ]);
  });

  it("flushes buffered points on the interval", async () => {
    vi.useFakeTimers();
    const flusher = new MetricsFlusher();

    flusher.start();
    flusher.ingest([point()]);

    expect(sqlMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(writeCalls()).toHaveLength(1);
    expect(flusher.stats.flushed).toBe(1);

    await flusher.stop();
  });

  it("does not write when the buffer is empty", async () => {
    vi.useFakeTimers();
    const flusher = new MetricsFlusher();

    flusher.start();
    await vi.advanceTimersByTimeAsync(3000);
    await flusher.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("drains the buffer on stop", async () => {
    const flusher = new MetricsFlusher();

    flusher.start();
    flusher.ingest([point()]);
    void flusher.stop();

    await vi.waitFor(() => expect(writeCalls()).toHaveLength(1));
    expect(flusher.stats).toMatchObject({ buffered: 0, dropped: 0, flushed: 1 });
  });

  it("stops safely when it was never started", async () => {
    const flusher = new MetricsFlusher();

    await expect(flusher.stop()).resolves.toBeUndefined();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("re-queues the batch when the database write fails", async () => {
    sqlMock.mockImplementation((first: any) =>
      first?.raw ? Promise.reject(new Error("database unavailable")) : first,
    );
    const flusher = new MetricsFlusher();

    flusher.ingest([point(), point()]);

    await vi.waitFor(() => expect(h.logger.error).toHaveBeenCalled());
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "[flusher] write failed",
    );
    expect(flusher.stats).toMatchObject({ buffered: 2, dropped: 0, flushed: 0 });
  });

  it("does not start a concurrent flush while one is in flight", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    sqlMock.mockImplementation((first: any) => (first?.raw ? pending : first));

    const flusher = new MetricsFlusher();
    flusher.ingest([point({ runId: "a" }), point({ runId: "b" })]);
    flusher.ingest([point({ runId: "c" }), point({ runId: "d" })]);

    // Second ingest finds shard flushing and does not start another concurrent flush.
    expect(writeCalls()).toHaveLength(1);

    release([]);
    await vi.waitFor(() => expect(flusher.stats.flushed).toBe(4));
    expect(flusher.stats.buffered).toBe(0);
  });
});
