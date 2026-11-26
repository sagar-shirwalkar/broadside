import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sql: vi.fn(),
  logger: { error: vi.fn() },
  stats: { buffered: 7, dropped: 2, flushed: 42 },
  fetch: vi.fn(),
  config: {
    serviceRole: "all" as "all" | "api" | "ingest",
    ingestUrl: "",
    ingestPort: 0,
    port: 3000,
  },
}));

vi.mock("../../../lib/flusher.ts", () => ({
  metricsFlusher: { stats: h.stats },
}));
vi.mock("../../../db/client.ts", () => ({ sql: h.sql }));
vi.mock("../../../logger.ts", () => ({ logger: h.logger }));
vi.mock("../../../config.ts", () => ({ config: h.config }));

import { testClient } from "hono/testing";
import health from ".././health.ts";

function client() {
  return testClient(health) as any;
}

describe("health route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.sql.mockReset();
    h.sql.mockResolvedValue([{ "?column?": 1 }]);
    h.logger.error.mockClear();
    h.fetch.mockReset();
    vi.stubGlobal("fetch", h.fetch);
    h.config.serviceRole = "all";
    h.config.ingestUrl = "";
    h.config.ingestPort = 0;
    h.config.port = 3000;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("liveness (/) is static and does not touch DB", async () => {
    const res = await client().index.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof body.uptime).toBe("number");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.database).toBeUndefined();
    expect(h.sql).not.toHaveBeenCalled();
  });

  it("ready reports DB and flusher stats", async () => {
    const res = await client().ready.$get();

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

    const res = await client().ready.$get();

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

  it("reports ok for an ingest-only role without probing", async () => {
    h.config.serviceRole = "ingest";
    h.config.ingestUrl = "ws://ingest:3002/ws";

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services.ingest).toBe("ok");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("reports degraded when the api role has no ingest URL", async () => {
    h.config.serviceRole = "api";

    const res = await client().ready.$get();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.services.ingest).toBe("error");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("probes ws ingest URLs over http", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "ws://ingest:3002/ws";
    h.fetch.mockResolvedValue({ ok: true });

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledWith(
      "http://ingest:3002/readyz",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("defaults a portless ws ingest URL to port 80", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "ws://ingest/ws";
    h.fetch.mockResolvedValue({ ok: true });

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledWith(
      "http://ingest/readyz",
      expect.anything(),
    );
  });

  it("probes wss ingest URLs over https", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "wss://ingest.example/ws";
    h.fetch.mockResolvedValue({ ok: true });

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledWith(
      "https://ingest.example/readyz",
      expect.anything(),
    );
  });

  it("accepts plain https ingest URLs", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "https://ingest.example/health";
    h.fetch.mockResolvedValue({ ok: true });

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledWith(
      "https://ingest.example/readyz",
      expect.anything(),
    );
  });

  it("rejects non-http ingest URLs", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "tcp://ingest:3002/ws";

    const res = await client().ready.$get();

    expect(res.status).toBe(503);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("handles malformed ingest URLs", async () => {
    h.config.serviceRole = "api";
    h.config.ingestUrl = "not a url";

    const res = await client().ready.$get();

    expect(res.status).toBe(503);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("skips self-probing a loopback ingest on the configured port", async () => {
    h.config.serviceRole = "all";
    h.config.ingestUrl = "ws://127.0.0.1:3000/ws";
    h.config.port = 3000;
    h.config.ingestPort = 0;

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("skips self-probing when the ingest port is configured", async () => {
    h.config.serviceRole = "all";
    h.config.ingestUrl = "ws://localhost:3002/ws";
    h.config.port = 3000;
    h.config.ingestPort = 3002;

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("probes loopback ingest when the port is not local", async () => {
    h.config.serviceRole = "all";
    h.config.ingestUrl = "ws://127.0.0.1:9999/ws";
    h.config.port = 3000;
    h.config.ingestPort = 3002;
    h.fetch.mockResolvedValue({ ok: true });

    const res = await client().ready.$get();

    expect(res.status).toBe(200);
    expect(h.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9999/readyz",
      expect.anything(),
    );
  });

  it("reports ingest error when the probe returns non-ok", async () => {
    h.config.serviceRole = "all";
    h.config.ingestUrl = "ws://ingest:3002/ws";
    h.fetch.mockResolvedValue({ ok: false });

    const res = await client().ready.$get();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.services.ingest).toBe("error");
  });

  it("reports ingest error when the probe throws", async () => {
    h.config.serviceRole = "all";
    h.config.ingestUrl = "ws://ingest:3002/ws";
    h.fetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await client().ready.$get();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.services.ingest).toBe("error");
  });
});
