import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { factory: null as null | (() => any) },
  ingest: vi.fn(),
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@hono/node-server", () => ({
  upgradeWebSocket: (factory: () => any) => {
    h.state.factory = factory;
    return (_c: unknown, next: () => Promise<void>) => next();
  },
}));
vi.mock("@hono/node-server/serve-static", () => ({
  serveStatic: () => (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("node:fs", () => ({
  existsSync: () => true,
  readFileSync: () => "<html>broadside-test-index</html>",
}));
vi.mock("../src/lib/flusher.js", () => ({
  metricsFlusher: {
    ingest: h.ingest,
    stats: { buffered: 0, dropped: 0, flushed: 0 },
  },
}));
vi.mock("../src/db/client.js", () => ({
  sql: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/logger.js", () => ({ logger: h.logger }));

import { testClient } from "hono/testing";
import { createApp } from "../src/server/app.js";

function websocketHandlers() {
  createApp();
  if (!h.state.factory) throw new Error("WebSocket factory was not registered");
  return h.state.factory();
}

describe("createApp", () => {
  beforeEach(() => {
    h.state.factory = null;
  });

  it("ingests a metric batch from a WebSocket message", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage(
      {
        data: JSON.stringify({
          run_id: "run-1",
          points: [
            { time_ms: 1000, endpoint: "/a", rps: 1, error_rate: 0.1 },
            { time_ms: 2000, endpoint: "/b", rps: 2, error_rate: 0 },
          ],
        }),
      },
      ws,
    );

    expect(h.ingest).toHaveBeenCalledTimes(1);
    const points = h.ingest.mock.calls[0]?.[0];
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      runId: "run-1",
      endpoint: "/a",
      time: new Date(1000),
      errorRate: 0.1,
    });
    expect(points[1]).toMatchObject({ runId: "run-1", endpoint: "/b" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("ingests a single point payload", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage(
      {
        data: JSON.stringify({
          run_id: "run-1",
          time_ms: 1000,
          endpoint: "/a",
        }),
      },
      ws,
    );

    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(h.ingest.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("does not ingest an empty points array", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage({ data: JSON.stringify({ run_id: "run-1", points: [] }) }, ws);

    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("drops oversized WebSocket messages without parsing them", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage({ data: "x".repeat(1024 * 1024 + 1) }, ws);

    expect(h.ingest).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ error: "message too large" }),
    );
  });

  it("reports invalid JSON to the client", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage({ data: "{not json" }, ws);

    expect(h.ingest).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ error: "invalid message" }),
    );
  });

  it("reports payloads that cannot be normalized", () => {
    const ws = { send: vi.fn() };
    const { onMessage } = websocketHandlers();

    onMessage(
      { data: JSON.stringify({ run_id: "run-1", points: "not-an-array" }) },
      ws,
    );

    expect(h.ingest).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ error: "invalid message" }),
    );
  });

  it("mounts the REST API routes and logs requests", async () => {
    const app = createApp();
    const client = testClient(app) as any;

    const health = await client.api.health.$get();
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/api/health",
        status: 200,
      }),
      "request completed",
    );

    const runs = await client.api.runs.$get();
    expect(runs.status).toBe(200);
    expect(await runs.json()).toEqual([]);
  });

  it("allows configured browser origins via CORS", async () => {
    const app = createApp();

    const res = await app.request("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("answers CORS preflight requests without credentials", async () => {
    const app = createApp();

    const res = await app.request("/api/runs", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it("does not grant CORS to unlisted origins", async () => {
    const app = createApp();

    const res = await app.request("/api/health", {
      headers: { Origin: "https://evil.example" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves the SPA entry point for unknown non-API paths", async () => {
    const app = createApp();

    const res = await app.request("/runs/123");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("broadside-test-index");
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const app = createApp();

    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns JSON 404 for missing asset-like paths", async () => {
    const app = createApp();

    const res = await app.request("/assets/missing.js");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns JSON 404 for non-GET requests to unknown paths", async () => {
    const app = createApp();

    const res = await app.request("/something", { method: "POST" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("sets security headers on API and static responses", async () => {
    const app = createApp();

    const api = await app.request("/api/health");
    expect(api.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(api.headers.get("x-content-type-options")).toBe("nosniff");
    expect(api.headers.get("x-frame-options")).toBe("DENY");
    expect(api.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );

    const page = await app.request("/");
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
  });

  it("only sets HSTS for https requests", async () => {
    const app = createApp();

    const http = await app.request("/api/health");
    expect(http.headers.get("strict-transport-security")).toBeNull();
  });

  it("logs unhandled route errors", async () => {
    const app = createApp();
    app.get("/boom", () => {
      throw new Error("boom");
    });

    const res = await app.request("/boom");

    expect(res.status).toBe(500);
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        method: "GET",
        path: "/boom",
      }),
      "request failed",
    );
  });
});
