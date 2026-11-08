import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sqlMock = vi.fn() as any;
  sqlMock.identifier = vi.fn((name: string) => ({ __identifier: name }));

  return {
    sqlMock,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    spawnArtillery: vi.fn(),
    killRun: vi.fn(),
    isRunActive: vi.fn(),
  };
});

vi.mock("../src/db/client.js", () => ({ sql: h.sqlMock }));
vi.mock("../src/logger.js", () => ({ logger: h.logger }));
vi.mock("../src/lib/artillery.js", () => ({
  spawnArtillery: h.spawnArtillery,
  killRun: h.killRun,
  isRunActive: h.isRunActive,
}));

import { testClient } from "hono/testing";
import runs from "../src/server/routes/runs.js";

const client = testClient(runs) as any;

describe("runs routes", () => {
  beforeEach(() => {
    h.sqlMock.mockReset();
    h.sqlMock.mockResolvedValue([]);
    h.sqlMock.identifier.mockClear();
    h.logger.error.mockClear();
    h.spawnArtillery.mockReset();
    h.spawnArtillery.mockResolvedValue(undefined);
    h.killRun.mockReset();
    h.killRun.mockReturnValue(true);
    h.isRunActive.mockReset();
    h.isRunActive.mockReturnValue(false);
  });

  it("lists the most recent runs with default pagination", async () => {
    h.sqlMock.mockResolvedValueOnce([{ id: "run-1" }, { id: "run-2" }]);

    const res = await client.index.$get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "run-1" }, { id: "run-2" }]);
    expect(h.sqlMock).toHaveBeenCalledTimes(1);

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe(100);
    expect(call?.[2]).toBe(0);
  });

  it("paginates runs with limit and offset", async () => {
    h.sqlMock.mockResolvedValueOnce([{ id: "run-11" }]);

    const res = await client.index.$get({
      query: { limit: "25", offset: "50" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "run-11" }]);

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe(25);
    expect(call?.[2]).toBe(50);
  });

  it("rejects an invalid limit", async () => {
    const res = await client.index.$get({ query: { limit: "0" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid limit" });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric limit", async () => {
    const res = await client.index.$get({ query: { limit: "many" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid limit" });
  });

  it("rejects a limit above the maximum", async () => {
    const res = await client.index.$get({ query: { limit: "101" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid limit" });
  });

  it("rejects an invalid offset", async () => {
    const res = await client.index.$get({ query: { offset: "-1" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid offset" });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("rejects a blank offset", async () => {
    const res = await client.index.$get({ query: { offset: " " } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid offset" });
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

  it("lists the endpoints seen in a run", async () => {
    h.sqlMock.mockResolvedValueOnce([
      { endpoint: "/api/users", samples: 12 },
      { endpoint: "/api/orders", samples: 7 },
    ]);

    const res = await client[":id"].endpoints.$get({
      param: { id: "run-1" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { endpoint: "/api/users", samples: 12 },
      { endpoint: "/api/orders", samples: 7 },
    ]);
    expect(h.sqlMock.mock.calls[0]?.[1]).toBe("run-1");
  });

  it("compares multiple runs", async () => {
    const runs = [{ id: "run-1" }, { id: "run-2" }];
    const series = [{ bucket: "2026-01-01T00:00:00Z", run_id: "run-1" }];
    h.sqlMock
      .mockResolvedValueOnce(runs)
      .mockResolvedValueOnce(series);

    const res = await client.compare.$get({
      query: { ids: "run-1,run-2" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs, series });
    expect(h.sqlMock.identifier).toHaveBeenCalledWith("metrics_1m");

    const runsCall = h.sqlMock.mock.calls[0];
    expect(runsCall?.[1]).toEqual(["run-1", "run-2"]);

    const seriesCall = h.sqlMock.mock.calls[1];
    expect(seriesCall?.[1]).toEqual({ __identifier: "metrics_1m" });
    expect(seriesCall?.[2]).toEqual(["run-1", "run-2"]);
    expect(seriesCall?.[3]).toBeNull();
    expect(seriesCall?.[4]).toBeNull();
  });

  it("de-duplicates comparison ids and supports filters", async () => {
    const from = "2026-01-01T00:00:00Z";
    const to = "2026-01-02T00:00:00Z";

    await client.compare.$get({
      query: {
        ids: " run-1, run-2, run-1 ",
        granularity: "1h",
        from,
        to,
        endpoint: "/api/users",
      },
    });

    expect(h.sqlMock.identifier).toHaveBeenCalledWith("metrics_1h");

    const runsCall = h.sqlMock.mock.calls[0];
    expect(runsCall?.[1]).toEqual(["run-1", "run-2"]);

    const seriesCall = h.sqlMock.mock.calls[1];
    expect(seriesCall?.[2]).toEqual(["run-1", "run-2"]);
    expect(seriesCall?.[3]).toEqual(new Date(from));
    expect(seriesCall?.[4]).toEqual(new Date(to));
    expect(seriesCall?.[5]).toBe("/api/users");
  });

  it("requires ids for comparison", async () => {
    const res = await client.compare.$get({ query: { ids: "" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ids is required" });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("requires at least two ids for comparison", async () => {
    const res = await client.compare.$get({ query: { ids: "run-1" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "at least two ids are required",
    });
  });

  it("rejects too many comparison ids", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `run-${index}`);

    const res = await client.compare.$get({
      query: { ids: ids.join(",") },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "at most 10 ids are allowed",
    });
  });

  it("rejects an invalid comparison granularity", async () => {
    const res = await client.compare.$get({
      query: { ids: "run-1,run-2", granularity: "5m" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid granularity" });
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

  it("filters aggregated metrics by endpoint", async () => {
    h.sqlMock.mockResolvedValueOnce([{ endpoint: "/api/users" }]);

    const res = await client[":id"].metrics.$get({
      param: { id: "run-1" },
      query: { endpoint: "/api/users" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ endpoint: "/api/users" }]);

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[2]).toBe("run-1");
    expect(call?.[3]).toBeNull();
    expect(call?.[4]).toBeNull();
    expect(call?.[5]).toBe("/api/users");
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

  it("filters raw metrics by endpoint", async () => {
    await client[":id"].raw.$get({
      param: { id: "run-1" },
      query: { endpoint: "/api/users" },
    });

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe("run-1");
    expect(call?.[2]).toBeNull();
    expect(call?.[3]).toBeNull();
    expect(call?.[4]).toBe("/api/users");
  });

  it("streams a finished run's points and closes with the run status", async () => {
    const time = new Date("2026-01-01T00:00:00Z");
    h.sqlMock
      .mockResolvedValueOnce([
        { time, endpoint: "/api/users", rps: 12, p95: 80 },
        { time, endpoint: "", rps: 12, p95: 90 },
      ])
      .mockResolvedValueOnce([
        { status: "completed", duration_ms: 1000, p95: 90 },
      ]);

    const res = await runs.request("/run-1/live");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();
    expect(body).toContain("event: metric");
    expect(body).toContain("\"endpoint\":\"/api/users\"");
    expect(body).toContain("\"endpoint\":\"\"");
    expect(body).toContain("event: run");
    expect(body).toContain("\"status\":\"completed\"");

    const metricsCall = h.sqlMock.mock.calls[0];
    expect(metricsCall?.[1]).toBe("run-1");
    expect(metricsCall?.[2]).toEqual(new Date(0));
    expect(metricsCall?.[3]).toBe("");
  });

  it("streams live metrics with a from, to, and endpoint filter", async () => {
    const from = "2026-01-01T00:00:00Z";
    const to = "2026-01-01T01:00:00Z";
    h.sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: "completed" }]);

    const res = await runs.request(
      `/run-1/live?from=${from}&to=${to}&endpoint=${encodeURIComponent("/api/users")}`,
    );
    await res.text();

    const metricsCall = h.sqlMock.mock.calls[0];
    expect(metricsCall?.[2]).toEqual(new Date(from));
    expect(metricsCall?.[4]).toEqual(new Date(to));
    expect(metricsCall?.[5]).toBe("/api/users");
  });

  it("keeps streaming an unregistered run until the client disconnects", async () => {
    h.sqlMock
      .mockResolvedValueOnce([
        { time: new Date(1000), endpoint: "/api/users", rps: 1 },
      ])
      .mockResolvedValue([]);

    const controller = new AbortController();
    const res = await runs.request("/run-1/live?interval_ms=100", {
      signal: controller.signal,
    });
    const reader = res.body!.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain("event: metric");

    controller.abort();
    await reader.cancel().catch(() => {});
  });

  it("rejects an invalid live interval", async () => {
    const res = await runs.request("/run-1/live?interval_ms=10");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid interval_ms" });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("registers and starts a run", async () => {
    const config = "config:\n  target: https://example.com\n";

    const res = await client.index.$post({
      json: { id: "run-1", script_path: "load.yml", config },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "run-1", status: "running" });
    expect(h.spawnArtillery).toHaveBeenCalledWith({
      runId: "run-1",
      scriptPath: "load.yml",
      extraArgs: undefined,
    });

    const call = h.sqlMock.mock.calls[0];
    expect(call?.[1]).toBe("run-1");
    expect(call?.[2]).toBe(config);
  });

  it("registers a run without config", async () => {
    const res = await client.index.$post({
      json: { id: "run-2", script_path: "load.yml" },
    });

    expect(res.status).toBe(201);
    expect(h.sqlMock.mock.calls[0]?.[2]).toBeNull();
  });

  it("generates an id when none is provided", async () => {
    const res = await client.index.$post({
      json: { script_path: "load.yml" },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("running");
    expect(h.spawnArtillery).toHaveBeenCalledWith(
      expect.objectContaining({ runId: body.id, scriptPath: "load.yml" }),
    );
  });

  it("passes extra args to Artillery", async () => {
    const res = await client.index.$post({
      json: {
        id: "run-1",
        script_path: "load.yml",
        extra_args: ["--environment", "staging"],
      },
    });

    expect(res.status).toBe(201);
    expect(h.spawnArtillery).toHaveBeenCalledWith({
      runId: "run-1",
      scriptPath: "load.yml",
      extraArgs: ["--environment", "staging"],
    });
  });

  it("requires a script path", async () => {
    const res = await client.index.$post({ json: { id: "run-1" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "script_path is required" });
    expect(h.spawnArtillery).not.toHaveBeenCalled();
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("rejects a blank script path", async () => {
    const res = await client.index.$post({
      json: { id: "run-1", script_path: "   " },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "script_path is required" });
  });

  it("rejects a script path with traversal", async () => {
    const res = await client.index.$post({
      json: { id: "run-1", script_path: "../secrets.yml" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid script path" });
    expect(h.spawnArtillery).not.toHaveBeenCalled();
  });

  it("returns 409 when the run is already active", async () => {
    h.isRunActive.mockReturnValue(true);

    const res = await client.index.$post({
      json: { id: "run-1", script_path: "load.yml" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run already active" });
    expect(h.spawnArtillery).not.toHaveBeenCalled();
  });

  it("marks the run failed when Artillery cannot start", async () => {
    const err = new Error("spawn artillery ENOENT");
    h.spawnArtillery.mockRejectedValue(err);

    const res = await client.index.$post({
      json: { id: "run-1", script_path: "load.yml" },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed to start run" });

    const update = h.sqlMock.mock.calls.at(-1);
    expect(update?.[1]).toBe("run-1");
    expect(h.logger.error).toHaveBeenCalledWith(
      { err, runId: "run-1" },
      "[artillery] failed to start run",
    );
  });

  it("kills an active run", async () => {
    h.isRunActive.mockReturnValue(true);

    const res = await client[":id"].$delete({ param: { id: "run-1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "run-1", status: "killed" });
    expect(h.killRun).toHaveBeenCalledWith("run-1");
    expect(h.sqlMock.mock.calls.at(-1)?.[1]).toBe("run-1");
  });

  it("returns 404 when deleting an unknown run", async () => {
    h.sqlMock.mockResolvedValueOnce([]);

    const res = await client[":id"].$delete({ param: { id: "missing" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("deletes a completed run and its metrics", async () => {
    h.sqlMock.mockResolvedValueOnce([{ id: "run-1" }]);

    const res = await client[":id"].$delete({ param: { id: "run-1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "run-1", status: "deleted" });
    expect(h.killRun).not.toHaveBeenCalled();
    expect(h.sqlMock).toHaveBeenCalledTimes(3);
  });
});
