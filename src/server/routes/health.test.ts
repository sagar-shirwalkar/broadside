import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sql: vi.fn(),
  logger: { error: vi.fn() },
  stats: { buffered: 7, dropped: 2, flushed: 42 },
}));

vi.mock("../../lib/flusher.js", () => ({
  metricsFlusher: { stats: h.stats },
}));
vi.mock("../../db/client.js", () => ({ sql: h.sql }));
vi.mock("../../logger.js", () => ({ logger: h.logger }));

import { testClient } from "hono/testing";
import health from "./health.js";

describe("health route", () => {
  beforeEach(() => {
    h.sql.mockReset();
    h.sql.mockResolvedValue([{ "?column?": 1 }]);
    h.logger.error.mockClear();
  });

  it("liveness (/) is static and does not touch DB", async () => {
    const client = testClient(health) as any;

    const res = await client.index.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof body.uptime).toBe("number");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.database).toBeUndefined();
    expect(h.sql).not.toHaveBeenCalled();
  });

  it("ready reports DB and flusher stats", async () => {
    const client = testClient(health) as any;

    const res = await client.ready.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      healthy: true,
      services: { dashboard: "ok", ingest: "ok", database: "ok" },
      database: { status: "ok" },
      flusher: h.stats,
    });
  });

  it("ready reports degraded with 503 when the database is unreachable", async () => {
    const err = new Error("connect ECONNREFUSED");
    h.sql.mockRejectedValue(err);

    const client = testClient(health) as any;
    const res = await client.ready.$get();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "degraded",
      healthy: false,
      services: { dashboard: "ok", ingest: "ok", database: "error" },
      database: { status: "error" },
      flusher: h.stats,
    });
    expect(h.logger.error).toHaveBeenCalled();
  });
});
