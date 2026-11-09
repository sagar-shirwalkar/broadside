import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sqlMock = vi.fn() as any;
  sqlMock.identifier = vi.fn((name: string) => ({ __identifier: name }));
  return { sqlMock };
});

vi.mock("../src/db/client.js", () => ({ sql: h.sqlMock }));

import { testClient } from "hono/testing";
import overview from "../src/server/routes/overview.js";

const client = testClient(overview) as any;

const SLO_ROW = [{ total: "30", met_p95: "28", met_error: "27" }];
const TREND_ROWS = [
  { bucket: new Date("2026-11-01T00:00:00Z"), run_id: "a", p95: 310, error_rate: 0.001 },
  { bucket: new Date("2026-11-02T00:00:00Z"), run_id: "b", p95: 320, error_rate: 0.004 },
];
const FREQUENCY_ROWS = [
  { day: "2026-11-01", runs: "3" },
  { day: "2026-11-02", runs: "1" },
];
const WORST_ROWS = [
  { endpoint: "/api/reports", avg_p95: 820, avg_error_rate: 0.003, runs: "4" },
];
const REGRESSION_ROWS = [
  {
    endpoint: "/api/checkout",
    latest_run_id: "run-x",
    latest_p95: 123,
    baseline_p95: 100,
    baseline_runs: "10",
  },
];
const RECENT_ROWS = [
  {
    id: "run-x",
    started_at: new Date("2026-11-09T00:00:00Z"),
    duration_ms: 65_000,
    total_requests: 1000,
    p50: 120,
    p95: 123,
    p99: 200,
    error_rate: 0.01,
    status: "completed",
  },
];

describe("overview routes", () => {
  beforeEach(() => {
    h.sqlMock.mockReset();
    h.sqlMock.mockImplementation(async (strings: unknown) => {
      const text = (strings as unknown as TemplateStringsArray).join(" ");
      if (text.includes("windowed")) return SLO_ROW;
      if (text.includes("min(bucket)")) return TREND_ROWS;
      if (text.includes("date_trunc")) return FREQUENCY_ROWS;
      if (text.includes("DISTINCT run_id")) return WORST_ROWS;
      if (text.includes("run_endpoint")) return REGRESSION_ROWS;
      if (text.includes("FROM runs")) return RECENT_ROWS;
      return [];
    });
  });

  it("GET / returns all panels", async () => {
    const res = await client.index.$get();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.slo).toHaveLength(2);
    expect(body.slo[0]).toMatchObject({
      key: "p95",
      total: 30,
      met: 28,
      metPct: 28 / 30,
      status: "pass", // 93% >= 90%
    });
    expect(body.slo[1]).toMatchObject({
      key: "errorRate",
      total: 30,
      met: 27,
      status: "pass",
    });

    expect(body.trends.p95).toHaveLength(2);
    expect(body.trends.p95[0]).toMatchObject({ value: 310, runId: "a" });
    expect(body.trends.errorRate[1]).toMatchObject({ value: 0.004, runId: "b" });

    expect(body.frequency).toEqual([
      { day: "2026-11-01", runs: 3 },
      { day: "2026-11-02", runs: 1 },
    ]);

    expect(body.worst).toEqual([
      { endpoint: "/api/reports", avgP95: 820, avgErrorRate: 0.003, runs: 4 },
    ]);

    expect(body.regressions).toEqual([
      expect.objectContaining({
        endpoint: "/api/checkout",
        latestP95: 123,
        baselineP95: 100,
        deltaPct: 23,
        runId: "run-x",
        baselineRuns: 10,
      }),
    ]);

    expect(body.recentRuns).toHaveLength(1);
    expect(body.recentRuns[0]).toMatchObject({ id: "run-x", status: "completed" });
  });

  it("SLO with no runs returns nodata status", async () => {
    h.sqlMock.mockImplementation(async (strings: unknown) => {
      const text = (strings as unknown as TemplateStringsArray).join(" ");
      if (text.includes("windowed")) {
        return [{ total: "0", met_p95: "0", met_error: "0" }];
      }
      return [];
    });

    const res = await client.index.$get();
    const body = await res.json();
    expect(body.slo.map((s: { status: string }) => s.status)).toEqual([
      "nodata",
      "nodata",
    ]);
    expect(body.slo[0].metPct).toBe(0);
    expect(body.trends.p95).toEqual([]);
    expect(body.regressions).toEqual([]);
  });

  it("regression delta math handles zero baseline safely", async () => {
    h.sqlMock.mockImplementation(async (strings: unknown) => {
      const text = (strings as unknown as TemplateStringsArray).join(" ");
      if (text.includes("windowed")) return SLO_ROW;
      if (text.includes("run_endpoint")) {
        return [
          {
            endpoint: "/api/x",
            latest_run_id: "r",
            latest_p95: 100,
            baseline_p95: 0,
            baseline_runs: "5",
          },
        ];
      }
      return [];
    });

    const res = await client.index.$get();
    const body = await res.json();
    // Baseline 0 is filtered out before reaching the client.
    expect(body.regressions).toEqual([]);
  });
});
