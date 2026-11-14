import { describe, expect, it } from "vitest";
import { normalizeBatch, normalizePoint } from ".././normalize.ts";

describe("normalizePoint", () => {
  it("normalizes snake_case payloads", () => {
    const point = normalizePoint({
      time_ms: 1_700_000_000_000,
      run_id: "run-1",
      endpoint: "/api/checkout",
      rps: 42.5,
      p50: 120,
      p95: 340,
      p99: 780,
      error_rate: 0.01,
    });

    expect(point).toEqual({
      time: new Date(1_700_000_000_000),
      runId: "run-1",
      endpoint: "/api/checkout",
      rps: 42.5,
      p50: 120,
      p95: 340,
      p99: 780,
      errorRate: 0.01,
    });
  });

  it("accepts camelCase aliases", () => {
    const point = normalizePoint({
      time: 1_700_000_000_000,
      runId: "run-2",
      endpoint: "/health",
      rps: "1.5",
      p50: "2",
      p95: "3",
      p99: "4",
      errorRate: "0.5",
    });

    expect(point).toMatchObject({
      time: new Date(1_700_000_000_000),
      runId: "run-2",
      endpoint: "/health",
      rps: 1.5,
      p50: 2,
      p95: 3,
      p99: 4,
      errorRate: 0.5,
    });
  });

  it("fills defaults for missing fields", () => {
    const point = normalizePoint({});

    expect(Number.isNaN(point.time.getTime())).toBe(true);
    expect(point.runId).toBe("");
    expect(point.endpoint).toBe("");
    expect(point.rps).toBe(0);
    expect(point.p50).toBe(0);
    expect(point.p95).toBe(0);
    expect(point.p99).toBe(0);
    expect(point.errorRate).toBe(0);
  });
});

describe("normalizeBatch", () => {
  it("inherits the batch run id for points that omit it", () => {
    const points = normalizeBatch({
      run_id: "run-1",
      points: [
        { time_ms: 1, endpoint: "/a" },
        { time_ms: 2, endpoint: "/b", run_id: "run-2" },
      ],
    });

    expect(points).toHaveLength(2);
    expect(points[0]?.runId).toBe("run-1");
    expect(points[1]?.runId).toBe("run-2");
  });

  it("treats a payload without a points array as a single point", () => {
    const points = normalizeBatch({
      run_id: "run-1",
      time_ms: 1,
      endpoint: "/a",
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      runId: "run-1",
      endpoint: "/a",
      time: new Date(1),
    });
  });

  it("accepts a camelCase batch run id", () => {
    const points = normalizeBatch({
      runId: "run-3",
      points: [{ time_ms: 1, endpoint: "/a" }],
    });

    expect(points[0]?.runId).toBe("run-3");
  });

  it("handles an empty points array", () => {
    expect(normalizeBatch({ run_id: "run-1", points: [] })).toEqual([]);
  });

  it("defaults the run id when neither alias is present", () => {
    const points = normalizeBatch({ points: [{ time_ms: 1, endpoint: "/a" }] });

    expect(points[0]?.runId).toBe("");
  });

  it("rejects a message whose points field is not an array", () => {
    expect(() =>
      normalizeBatch({ run_id: "run-1", points: "not-an-array" }),
    ).toThrow(TypeError);
  });

  it("rejects a non-object message", () => {
    expect(() => normalizeBatch(42 as unknown as object)).toThrow(TypeError);
    expect(() => normalizeBatch("hello" as unknown as object)).toThrow(TypeError);
    expect(() => normalizeBatch(null as unknown as object)).toThrow(TypeError);
  });

  it("rejects wrongly-typed scalars", () => {
    expect(() => normalizePoint({ run_id: 42 })).toThrow(TypeError);
    expect(() => normalizePoint({ rps: "abc" })).toThrow(TypeError);
    expect(() => normalizePoint({ time_ms: "not-a-time" })).toThrow(TypeError);
    expect(() => normalizePoint({ rps: Number.NaN })).toThrow(TypeError);
    expect(() => normalizePoint({ p95: "fast" })).toThrow(TypeError);
  });

  it("accepts numeric strings but rejects truly invalid numbers", () => {
    const point = normalizePoint({ rps: "2.5", p95: "300" });
    expect(point.rps).toBe(2.5);
    expect(point.p95).toBe(300);

    expect(() => normalizePoint({ rps: "Infinity" })).toThrow(TypeError);
  });
});
