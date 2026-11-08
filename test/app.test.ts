import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { factory: null as null | (() => any) },
  ingest: vi.fn(),
}));

vi.mock("@hono/node-server", () => ({
  upgradeWebSocket: (factory: () => any) => {
    h.state.factory = factory;
    return (_c: unknown, next: () => Promise<void>) => next();
  },
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

  it("mounts the REST API routes", async () => {
    const app = createApp();
    const client = testClient(app) as any;

    const health = await client.api.health.$get();
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const runs = await client.api.runs.$get();
    expect(runs.status).toBe(200);
    expect(await runs.json()).toEqual([]);
  });
});
