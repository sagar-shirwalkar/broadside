import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sqlMock = vi.fn() as any;
  sqlMock.identifier = vi.fn((name: string) => ({ __identifier: name }));
  return { sqlMock };
});

vi.mock("../src/db/client.js", () => ({ sql: h.sqlMock }));

import { testClient } from "hono/testing";
import runs from "../src/server/routes/runs.js";

const client = testClient(runs) as any;

describe("runs routes", () => {
  beforeEach(() => {
    h.sqlMock.mockReset();
    h.sqlMock.mockResolvedValue([]);
    h.sqlMock.identifier.mockClear();
  });

  it("lists the most recent runs", async () => {
    h.sqlMock.mockResolvedValueOnce([{ id: "run-1" }, { id: "run-2" }]);

    const res = await client.index.$get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "run-1" }, { id: "run-2" }]);
    expect(h.sqlMock).toHaveBeenCalledTimes(1);
  });

  it("returns a single run", async () => {
    h.sqlMock.mockResolvedValueOnce([{ id: "run-1", status: "running" }]);

    const res = await client[":id"].$get({ param: { id: "run-1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "run-1", status: "running" });
  });

  it("returns 404 when a run does not exist", async () => {
    h.sqlMock.mockResolvedValueOnce([]);

    const res = await client[":id"].$get({ param: { id: "missing" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("defaults metric queries to the one-minute view", async () => {
    h.sqlMock.mockResolvedValueOnce([{ bucket: "2026-01-01T00:00:00Z" }]);

    const res = await client[":id"].metrics.$get({ param: { id: "run-1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ bucket: "2026-01-01T00:00:00Z" }]);
    expect(h.sqlMock.identifier).toHaveBeenCalledWith("metrics_1m");

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toEqual({ __identifier: "metrics_1m" });
    expect(call?.[2]).toBe("run-1");
    expect(call?.[3]).toBeNull();
    expect(call?.[4]).toBeNull();
  });

  it("uses the requested granularity and time range", async () => {
    const from = "2026-01-01T00:00:00Z";
    const to = "2026-01-02T00:00:00Z";

    const res = await client[":id"].metrics.$get({
      param: { id: "run-1" },
      query: { granularity: "1h", from, to },
    });

    expect(res.status).toBe(200);
    expect(h.sqlMock.identifier).toHaveBeenCalledWith("metrics_1h");

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[3]).toEqual(new Date(from));
    expect(call?.[4]).toEqual(new Date(to));
  });

  it("rejects an unsupported granularity", async () => {
    const res = await client[":id"].metrics.$get({
      param: { id: "run-1" },
      query: { granularity: "5m" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid granularity" });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("queries raw metrics with an optional time range", async () => {
    const from = "2026-01-01T00:00:00Z";
    const to = "2026-01-02T00:00:00Z";
    h.sqlMock.mockResolvedValueOnce([{ endpoint: "/api" }]);

    const res = await client[":id"].raw.$get({
      param: { id: "run-1" },
      query: { from, to },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ endpoint: "/api" }]);

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe("run-1");
    expect(call?.[2]).toEqual(new Date(from));
    expect(call?.[3]).toEqual(new Date(to));
  });

  it("queries raw metrics without a time range", async () => {
    await client[":id"].raw.$get({ param: { id: "run-1" } });

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe("run-1");
    expect(call?.[2]).toBeNull();
    expect(call?.[3]).toBeNull();
  });

  it("registers a run", async () => {
    const res = await client.index.$post({
      json: { id: "run-1", config: "config:\n  target: https://example.com\n" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "run-1", status: "running" });

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe("run-1");
    expect(call?.[2]).toBe("config:\n  target: https://example.com\n");
  });

  it("registers a run without config", async () => {
    const res = await client.index.$post({ json: { id: "run-2" } });

    expect(res.status).toBe(201);
    expect(h.sqlMock.mock.calls[0]?.[2]).toBeNull();
  });
});
