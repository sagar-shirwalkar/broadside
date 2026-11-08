import { describe, expect, it, vi } from "vitest";

const { stats } = vi.hoisted(() => ({
  stats: { buffered: 7, dropped: 2, flushed: 42 },
}));

vi.mock("../src/lib/flusher.js", () => ({
  metricsFlusher: { stats },
}));

import { testClient } from "hono/testing";
import health from "../src/server/routes/health.js";

describe("health route", () => {
  it("reports status, uptime, and flusher stats", async () => {
    const client = testClient(health) as any;

    const res = await client.index.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      flusher: stats,
    });
    expect(typeof body.uptime).toBe("number");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
