import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sql: vi.fn(),
  logger: { error: vi.fn() },
  stats: { buffered: 7, dropped: 2, flushed: 42 },
}));

vi.mock("../src/lib/flusher.js", () => ({
  metricsFlusher: { stats: h.stats },
}));
vi.mock("../src/db/client.js", () => ({ sql: h.sql }));
vi.mock("../src/logger.js", () => ({ logger: h.logger }));

import { testClient } from "hono/testing";
import health from "../src/server/routes/health.js";

describe("health route", () => {
  beforeEach(() => {
    h.sql.mockReset();
    h.sql.mockResolvedValue([{ "?column?": 1 }]);
    h.logger.error.mockClear();
  });

  it("reports status, uptime, flusher stats, and a healthy database", async () => {
    const client = testClient(health) as any;

    const res = await client.index.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      database: { status: "ok" },
      flusher: h.stats,
    });
    expect(typeof body.uptime).toBe("number");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("reports degraded with 503 when the database is unreachable", async () => {
    const err = new Error("connect ECONNREFUSED");
    h.sql.mockRejectedValue(err);

    const client = testClient(health) as any;
    const res = await client.index.$get();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "degraded",
      database: { status: "error" },
      flusher: h.stats,
    });
    expect(h.logger.error).toHaveBeenCalledWith(
      { err },
      "[health] database check failed",
    );
  });
});
