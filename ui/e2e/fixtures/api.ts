import type { Page } from "@playwright/test";

export const RUNS = [
  {
    id: "run-1-aaaa",
    started_at: "2026-03-01T10:00:00Z",
    duration_ms: 65_000,
    total_requests: 12_000,
    p50: 110,
    p95: 210,
    p99: 480,
    error_rate: 0.012,
    status: "completed",
    config_yaml: null,
    json_path: "/data/reports/run-1.json",
  },
  {
    id: "run-2-bbbb",
    started_at: "2026-03-02T11:00:00Z",
    duration_ms: 42_000,
    total_requests: 8_500,
    p50: 95,
    p95: 180,
    p99: 320,
    error_rate: 0.004,
    status: "running",
    config_yaml: null,
    json_path: null,
  },
];

export const METRICS = [
  {
    bucket: "2026-03-02T11:00:00Z",
    endpoint: "",
    rps: 10,
    p50: 90,
    p95: 170,
    p99: 310,
    error_rate: 0.004,
    samples: 3,
  },
  {
    bucket: "2026-03-02T11:01:00Z",
    endpoint: "",
    rps: 22,
    p50: 105,
    p95: 195,
    p99: 360,
    error_rate: 0.006,
    samples: 4,
  },
];

export const HEALTH = {
  status: "ok",
  healthy: true,
  services: { dashboard: "ok", ingest: "ok", database: "ok" },
  uptime: 120,
  database: { status: "ok" },
  flusher: { buffered: 0, dropped: 0, flushed: 42 },
  timestamp: "2026-03-02T11:00:00Z",
};

export const OVERVIEW = {
  slo: [
    { key: "p95", label: "p95 latency", threshold: 400, unit: "ms", total: 30, met: 28, metPct: 28 / 30, status: "pass" },
    { key: "errorRate", label: "error rate", threshold: 0.01, unit: "ratio", total: 30, met: 27, metPct: 27 / 30, status: "pass" },
  ],
  trends: {
    p95: [
      { time: "2026-03-01T00:00:00Z", value: 210, runId: "run-1-aaaa" },
      { time: "2026-03-02T00:00:00Z", value: 180, runId: "run-2-bbbb" },
    ],
    errorRate: [
      { time: "2026-03-01T00:00:00Z", value: 0.012, runId: "run-1-aaaa" },
      { time: "2026-03-02T00:00:00Z", value: 0.004, runId: "run-2-bbbb" },
    ],
  },
  frequency: [
    { day: "2026-02-24", runs: 2 },
    { day: "2026-03-02", runs: 1 },
  ],
  worst: [{ endpoint: "/api/login", avgP95: 320, avgErrorRate: 0.01, runs: 5 }],
  regressions: [
    { endpoint: "/api/checkout", latestP95: 123, baselineP95: 100, deltaPct: 23, runId: "run-1-aaaa", baselineRuns: 10 },
  ],
  recentRuns: RUNS,
  meta: { trendDays: 30, frequencyInterval: "week" },
};

export async function stubApi(
  page: Page,
  options: {
    authGate?: boolean;
    completeLiveFor?: string[];
  } = {},
) {
  const seen: string[] = [];
  const runs = RUNS.map((r) => ({ ...r }));
  const createdRuns = new Map<string, any>();
  const completeLiveFor = new Set(options.completeLiveFor ?? []);

  function getRun(id: string) {
    return createdRuns.get(id) ?? runs.find((r) => r.id === id) ?? null;
  }

  await page.route("**/readyz", async (route) => {
    seen.push(`${route.request().method()} /readyz`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(HEALTH) });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    seen.push(`${request.method()} ${path}`);
    (page as unknown as { seen: string[] }).seen = seen;

    const token = options.authGate ? request.headers()["authorization"] : "Bearer whatever";
    if (options.authGate && token !== "Bearer test-token") {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) });
      return;
    }

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/health") return json(HEALTH);
    if (path === "/api/overview") return json(OVERVIEW);
    if (path === "/api/runs" && request.method() === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return json([...runs, ...createdRuns.values()].slice(0, limit));
    }
    if (path === "/api/runs" && request.method() === "POST") {
      const created = {
        id: "run-new-cccc", started_at: "2026-03-02T12:00:00Z", duration_ms: null, total_requests: null,
        p50: null, p95: null, p99: null, error_rate: null, status: "running", config_yaml: null, json_path: null,
      };
      createdRuns.set(created.id, created);
      return json({ id: created.id, status: "running" }, 201);
    }
    if (path === "/api/runs/compare") {
      return json({ runs, series: runs.flatMap((run) => METRICS.map((row) => ({ ...row, run_id: run.id }))) });
    }
    const detail = path.match(/^\/api\/runs\/([^/]+)$/);
    if (detail) {
      const run = getRun(decodeURIComponent(detail[1]));
      if (request.method() === "DELETE") return json({ id: run?.id ?? "", status: "deleted" });
      return run ? json(run) : json({ error: "not found" }, 404);
    }
    if (path.endsWith("/metrics")) return json(METRICS);
    if (path.endsWith("/raw")) return json([]);
    if (path.endsWith("/endpoints")) return json([]);
    if (path.endsWith("/phases")) return json([]);
    if (path.endsWith("/live")) {
      const m = path.match(/^\/api\/runs\/([^/]+)\/live$/);
      const runId = m ? decodeURIComponent(m[1]) : "";
      const run = getRun(runId);
      const metricEvents = [
        'event: metric\ndata: {"time":"2026-03-02T11:00:00Z","endpoint":"","rps":12,"p50":100,"p95":200,"p99":300,"error_rate":0.01,"vusers_created":1,"vusers_completed":1,"error_count":0,"hist_min":80,"hist_max":350,"hist_p75":150,"hist_p90":180,"hist_p999":340}',
        'event: metric\ndata: {"time":"2026-03-02T11:00:01Z","endpoint":"","rps":14,"p50":101,"p95":205,"p99":310,"error_rate":0.008,"vusers_created":2,"vusers_completed":2,"error_count":0,"hist_min":82,"hist_max":360,"hist_p75":152,"hist_p90":185,"hist_p999":345}',
      ];
      const shouldComplete = completeLiveFor.has(runId) || (run?.status === "running" && runId !== "run-2-bbbb");
      if (shouldComplete && run) {
        Object.assign(run, { status: "completed", duration_ms: 60000, total_requests: 1000, p50: 100, p95: 200, p99: 300, error_rate: 0.01 });
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
          body: [
            ...metricEvents,
            'event: run\ndata: {"status":"completed","duration_ms":60000,"total_requests":1000,"p50":100,"p95":200,"p99":300,"error_rate":0.01,"failure_reason":null,"partial_data":false,"dropped_points":0}',
            "",
          ].join("\n\n"),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        body: [...metricEvents, ""].join("\n\n"),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
  });

  return seen;
}
