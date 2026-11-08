import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sqlMock = vi.fn() as any;
  sqlMock.mockResolvedValue([]);

  return {
    sqlMock,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ingest: vi.fn(),
    spawn: vi.fn(),
    mkdtemp: vi.fn(),
    readFile: vi.fn(),
    rm: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({ spawn: h.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: h.mkdtemp,
  readFile: h.readFile,
  rm: h.rm,
  mkdir: h.mkdir,
  writeFile: h.writeFile,
}));
vi.mock("../src/db/client.js", () => ({ sql: h.sqlMock }));
vi.mock("../src/logger.js", () => ({ logger: h.logger }));
vi.mock("../src/config.js", () => ({
  config: { artillery: { reportDir: "/tmp/reports" } },
}));
vi.mock("../src/lib/flusher.js", () => ({
  metricsFlusher: { ingest: h.ingest },
}));

import {
  isRunActive,
  killRun,
  parseReportPoints,
  processReport,
  spawnArtillery,
  type ArtilleryReport,
} from "../src/lib/artillery.js";

interface FakeProc {
  stderr: { on: ReturnType<typeof vi.fn> };
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  emitStderr: (chunk: string) => void;
}

function createProc({
  autoSpawn = true,
}: { autoSpawn?: boolean } = {}): FakeProc {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const stderrListeners: Record<string, Array<(...args: any[]) => void>> = {};

  const proc: FakeProc = {
    stderr: {
      on: vi.fn((event: string, fn: (...args: any[]) => void) => {
        (stderrListeners[event] ??= []).push(fn);
      }),
    },
    once: vi.fn((event: string, fn: (...args: any[]) => void) => {
      (listeners[event] ??= []).push(fn);
      if (event === "spawn" && autoSpawn) {
        // Emulate Node: the spawn event fires after listeners are attached.
        queueMicrotask(() => proc.emit("spawn"));
      }
    }),
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      (listeners[event] ??= []).push(fn);
    }),
    kill: vi.fn(),
    emit(event, ...args) {
      for (const fn of [...(listeners[event] ?? [])]) fn(...args);
    },
    emitStderr(chunk) {
      for (const fn of [...(stderrListeners.data ?? [])]) {
        fn(Buffer.from(chunk));
      }
    },
  };

  return proc;
}

function endpointPoint(
  points: ReturnType<typeof parseReportPoints>,
  endpoint: string,
) {
  const point = points.find((candidate) => candidate.endpoint === endpoint);
  if (!point) throw new Error(`missing endpoint point: ${endpoint}`);
  return point;
}

const aggregateOnly: ArtilleryReport["aggregate"] = {
  counters: {},
  histograms: {},
};

describe("parseReportPoints", () => {
  it("emits aggregate and per-endpoint points from a real report shape", () => {
    const period = new Date("2026-01-01T00:00:00.000Z");
    const report: ArtilleryReport = {
      intermediate: [
        {
          period: String(period.getTime()),
          counters: {
            "http.requests": 10,
            "http.responses": 10,
            "vusers.created": 5,
            "vusers.failed": 1,
            "plugins.metrics-by-endpoint./api/users.codes.200": 6,
            "plugins.metrics-by-endpoint./api/orders.codes.200": 3,
            "plugins.metrics-by-endpoint./missing.codes.404": 1,
            "plugins.metrics-by-endpoint./missing.errors.ETIMEDOUT": 1,
          },
          histograms: {
            "http.response_time": { p50: 10, p95: 20, p99: 30 },
            "plugins.metrics-by-endpoint.response_time./api/users": {
              count: 6,
              p50: 5,
              p95: 15,
              p99: 25,
            },
            "plugins.metrics-by-endpoint.response_time./api/orders": {
              count: 3,
              p50: 7,
              p95: 17,
              p99: 27,
            },
            "plugins.metrics-by-endpoint.response_time./missing": {
              count: 1,
              p50: 1,
              p95: 2,
              p99: 3,
            },
          },
          rates: { "http.request_rate": 2 },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(4);

    const aggregate = endpointPoint(points, "");
    expect(aggregate.time).toEqual(period);
    expect(aggregate.runId).toBe("run-1");
    expect(aggregate.rps).toBe(2);
    expect(aggregate.p50).toBe(10);
    expect(aggregate.p95).toBe(20);
    expect(aggregate.p99).toBe(30);
    expect(aggregate.errorRate).toBe(0.2);

    const users = endpointPoint(points, "/api/users");
    expect(users.rps).toBe(1.2);
    expect(users.p50).toBe(5);
    expect(users.p95).toBe(15);
    expect(users.p99).toBe(25);
    expect(users.errorRate).toBe(0);

    const orders = endpointPoint(points, "/api/orders");
    expect(orders.rps).toBe(0.6);

    const missing = endpointPoint(points, "/missing");
    expect(missing.rps).toBe(0.2);
    expect(missing.errorRate).toBe(0.5);
  });

  it("falls back to summaries and infers custom plugin namespaces", () => {
    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: "2026-01-01T00:00:00.000Z",
          counters: {
            "http.requests": 4,
            "custom.namespace./api.codes.200": 3,
            "custom.namespace./api.errors.ECONNRESET": 1,
          },
          summaries: {
            "http.response_time": { p50: 1, p95: 2, p99: 3 },
            "custom.namespace.response_time./api": {
              count: 4,
              p50: 4,
              p95: 5,
              p99: 6,
            },
          },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(2);

    const aggregate = endpointPoint(points, "");
    expect(aggregate.time).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(aggregate.rps).toBe(0.4);
    expect(aggregate.p50).toBe(1);

    const endpoint = endpointPoint(points, "/api");
    expect(endpoint.rps).toBe(0.4);
    expect(endpoint.p50).toBe(4);
    expect(endpoint.errorRate).toBe(0.25);
  });

  it("emits only the aggregate point when the plugin is absent", () => {
    const report: ArtilleryReport = {
      intermediate: [
        {
          period: 1767225600000,
          counters: { "http.requests": 5 },
          histograms: {
            "http.response_time": { p50: 1, p95: 2, p99: 3 },
          },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(1);
    expect(points[0].endpoint).toBe("");
    expect(points[0].rps).toBe(0.5);
  });

  it("skips buckets without a usable timestamp", () => {
    const report: ArtilleryReport = {
      intermediate: [
        { counters: { "http.requests": 1 } },
        { period: "not-a-date", counters: { "http.requests": 1 } },
        {
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          counters: { "http.requests": 2 },
        },
        { timestamp: 1767225700000, counters: { "http.requests": 3 } },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(2);
    expect(points[0].time).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(points[1].time).toEqual(new Date(1767225700000));
  });

  it("derives rps from the bucket interval when no rate is reported", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const next = new Date(start.getTime() + 10_000);

    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: start.toISOString(),
          counters: { "http.requests": 10 },
        },
        {
          timestamp: next.toISOString(),
          counters: { "http.requests": 20 },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(2);
    expect(points[0].rps).toBe(1);
    expect(points[1].rps).toBe(2);
  });

  it("uses histogram totals and codes when count is missing", () => {
    const period = new Date("2026-01-01T00:00:00.000Z");
    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: period,
          counters: {
            "http.requests": 8,
            "plugins.metrics-by-endpoint./api.codes.200": 5,
            "plugins.metrics-by-endpoint./api.errors.ECONNRESET": 1,
          },
          histograms: {
            "plugins.metrics-by-endpoint.response_time./api": {
              total: 8,
              p50: 2,
              p95: 4,
              p99: 6,
            },
            "plugins.metrics-by-endpoint.response_time./health": {
              p50: 1,
              p95: 1,
              p99: 1,
            },
          },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    const api = endpointPoint(points, "/api");
    expect(api.rps).toBe(0.8);
    expect(api.errorRate).toBe(1 / 6);

    const health = endpointPoint(points, "/health");
    expect(health.rps).toBe(0);
  });

  it("ignores engine-level response-time histograms", () => {
    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          counters: {
            "http.response_time.2xx": 2,
            "http.codes.200": 2,
          },
          histograms: {
            "http.response_time.2xx": { count: 2, p50: 1 },
          },
        },
      ],
      aggregate: aggregateOnly,
    };

    const points = parseReportPoints(report, "run-1");

    expect(points).toHaveLength(1);
    expect(points[0].endpoint).toBe("");
  });

  it("defaults a missing vusers counter to a single vuser", () => {
    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: new Date("2026-01-01T00:00:00.000Z"),
          counters: { "vusers.failed": 1 },
        },
      ],
      aggregate: aggregateOnly,
    };

    const [point] = parseReportPoints(report, "run-1");

    expect(point.errorRate).toBe(1);
  });
});

describe("processReport", () => {
  it("ingests points, updates the run, and persists the report", async () => {
    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: "2026-01-01T00:00:00.000Z",
          counters: { "http.requests": 10 },
          histograms: {
            "http.response_time": { p50: 1, p95: 2, p99: 3 },
          },
          rates: { "http.request_rate": 1 },
        },
        {
          timestamp: "2026-01-01T00:00:10.000Z",
          counters: { "http.requests": 20 },
          histograms: {
            "http.response_time": { p50: 1, p95: 2, p99: 3 },
          },
          rates: { "http.request_rate": 2 },
        },
      ],
      aggregate: {
        counters: {
          "http.responses": 30,
          "vusers.created": 10,
          "vusers.failed": 2,
        },
        histograms: {
          "http.response_time": { p50: 4, p95: 5, p99: 6 },
        },
      },
    };
    const raw = JSON.stringify(report);
    h.readFile.mockResolvedValue(raw);

    await processReport("run/1", "/tmp/artillery-run/report.json");

    expect(h.readFile).toHaveBeenCalledWith(
      "/tmp/artillery-run/report.json",
      "utf-8",
    );
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(h.ingest.mock.calls[0][0]).toHaveLength(2);

    expect(h.mkdir).toHaveBeenCalledWith("/tmp/reports", { recursive: true });
    expect(h.writeFile).toHaveBeenCalledWith(
      "/tmp/reports/run_1.json",
      raw,
      "utf-8",
    );

    const update = h.sqlMock.mock.calls[0];
    expect(update?.[1]).toBe(10_000);
    expect(update?.[2]).toBe(30);
    expect(update?.[3]).toBe(4);
    expect(update?.[4]).toBe(5);
    expect(update?.[5]).toBe(6);
    expect(update?.[6]).toBe(0.2);
    expect(update?.[7]).toBe("/tmp/reports/run_1.json");
    expect(update?.[8]).toBe("run/1");

    expect(h.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run/1", totalRequests: 30, points: 2 }),
      "[artillery] run completed",
    );
  });

  it("prefers aggregate metric timestamps over bucket periods", async () => {
    const report: ArtilleryReport = {
      intermediate: [
        { period: "2026-01-01T00:00:00.000Z", counters: { "http.requests": 1 } },
        { period: "2026-01-01T00:00:10.000Z", counters: { "http.requests": 1 } },
      ],
      aggregate: {
        counters: { "http.requests": 2 },
        histograms: {},
        firstMetricAt: 1_000,
        lastMetricAt: 3_500,
      },
    };
    h.readFile.mockResolvedValue(JSON.stringify(report));

    await processReport("run-1", "/tmp/report.json");

    expect(h.sqlMock.mock.calls[0]?.[1]).toBe(2_500);
  });

  it("reports zero duration when no timestamps are available", async () => {
    const report: ArtilleryReport = {
      intermediate: [],
      aggregate: aggregateOnly,
    };
    h.readFile.mockResolvedValue(JSON.stringify(report));

    await processReport("run-1", "/tmp/report.json");

    expect(h.sqlMock.mock.calls[0]?.[1]).toBe(0);
  });
});

describe("spawnArtillery", () => {
  beforeEach(() => {
    h.mkdtemp.mockResolvedValue("/tmp/artillery-run-1");
    h.rm.mockResolvedValue(undefined);
    h.mkdir.mockResolvedValue(undefined);
    h.writeFile.mockResolvedValue(undefined);
  });

  it("spawns Artillery and processes a successful report", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);

    const report: ArtilleryReport = {
      intermediate: [
        {
          timestamp: "2026-01-01T00:00:00.000Z",
          counters: { "http.requests": 1 },
        },
      ],
      aggregate: aggregateOnly,
    };
    h.readFile.mockResolvedValue(JSON.stringify(report));

    await spawnArtillery({
      runId: "run-1",
      scriptPath: "load.yml",
      extraArgs: ["--environment", "staging"],
    });

    expect(h.mkdtemp).toHaveBeenCalledWith(
      expect.stringContaining("artillery-run-1-"),
    );
    expect(h.spawn).toHaveBeenCalledWith(
      "artillery",
      [
        "run",
        "load.yml",
        "--output",
        "/tmp/artillery-run-1/report.json",
        "--quiet",
        "--environment",
        "staging",
      ],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.objectContaining({ ARTILLERY_DISABLE_TELEMETRY: "1" }),
      }),
    );
    expect(isRunActive("run-1")).toBe(true);

    proc.emit("close", 0);

    await vi.waitFor(() => {
      expect(h.rm).toHaveBeenCalledWith("/tmp/artillery-run-1", {
        recursive: true,
        force: true,
      });
    });
    expect(h.ingest).toHaveBeenCalledTimes(1);
    expect(isRunActive("run-1")).toBe(false);
  });

  it("marks the run failed when the report cannot be processed", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);
    h.readFile.mockRejectedValue(new Error("ENOENT"));

    await spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });
    proc.emit("close", 0);

    await vi.waitFor(() => {
      expect(h.sqlMock).toHaveBeenCalledTimes(1);
    });
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "[artillery] error processing run",
    );
    expect(h.rm).toHaveBeenCalled();
  });

  it("marks the run failed when Artillery exits non-zero", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);

    await spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });
    proc.emitStderr("invalid script");
    proc.emit("close", 3);

    await vi.waitFor(() => {
      expect(h.logger.error).toHaveBeenCalledWith(
        { runId: "run-1", reason: "invalid script" },
        "[artillery] run failed",
      );
    });
    expect(h.sqlMock).toHaveBeenCalledTimes(1);
    expect(h.rm).toHaveBeenCalled();
  });

  it("falls back to the exit code when stderr is empty", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);

    await spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });
    proc.emit("close", 2);

    await vi.waitFor(() => {
      expect(h.logger.error).toHaveBeenCalledWith(
        { runId: "run-1", reason: "artillery exited with code 2" },
        "[artillery] run failed",
      );
    });
  });

  it("marks the run failed when an error arrives after spawn", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);
    const err = new Error("spawn artillery ENOENT");

    await spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });
    proc.emit("error", err);

    await vi.waitFor(() => {
      expect(h.logger.error).toHaveBeenCalledWith(
        { err, runId: "run-1" },
        "[artillery] spawn error",
      );
      expect(h.rm).toHaveBeenCalledWith("/tmp/artillery-run-1", {
        recursive: true,
        force: true,
      });
    });
    expect(h.sqlMock).toHaveBeenCalledTimes(1);
    expect(isRunActive("run-1")).toBe(false);
  });

  it("rejects when spawn throws synchronously", async () => {
    h.spawn.mockImplementation(() => {
      throw new Error("spawn artillery ENOENT");
    });

    await expect(
      spawnArtillery({ runId: "run-1", scriptPath: "load.yml" }),
    ).rejects.toThrow("spawn artillery ENOENT");

    expect(isRunActive("run-1")).toBe(false);
    expect(h.rm).toHaveBeenCalledWith("/tmp/artillery-run-1", {
      recursive: true,
      force: true,
    });
  });

  it("rejects when the Artillery binary fails to start", async () => {
    const proc = createProc({ autoSpawn: false });
    h.spawn.mockReturnValue(proc);

    const started = spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });
    await vi.waitFor(() => {
      expect(h.spawn).toHaveBeenCalledTimes(1);
    });

    proc.emit("error", new Error("spawn artillery ENOENT"));

    await expect(started).rejects.toThrow("spawn artillery ENOENT");
    expect(isRunActive("run-1")).toBe(false);
    await vi.waitFor(() => {
      expect(h.rm).toHaveBeenCalledWith("/tmp/artillery-run-1", {
        recursive: true,
        force: true,
      });
    });

    // The route is responsible for marking the row failed.
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("treats a killed run as terminal without updating the row", async () => {
    const proc = createProc();
    h.spawn.mockReturnValue(proc);

    await spawnArtillery({ runId: "run-1", scriptPath: "load.yml" });

    expect(killRun("run-1")).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(isRunActive("run-1")).toBe(false);

    proc.emit("close", null);

    await vi.waitFor(() => {
      expect(h.rm).toHaveBeenCalledWith("/tmp/artillery-run-1", {
        recursive: true,
        force: true,
      });
    });
    expect(h.sqlMock).not.toHaveBeenCalled();
  });

  it("reports unknown runs as inactive", () => {
    expect(killRun("missing")).toBe(false);
    expect(isRunActive("missing")).toBe(false);
  });
});
