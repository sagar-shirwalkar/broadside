import { expect, test, type Page } from "@playwright/test";

/**
 * Fake API: the backend is stubbed at the network layer so the suite runs
 * against the Vite dev server alone (no database, no Artillery).
 *
 * Polymorphic UI (status shown as completed/failed/live across overview,
 * run list, run detail, live view; delete vs kill by run state) is asserted
 * via scoped role/text and structural locators (filter/visible) rather than
 * brittle glyphs, so variant presentation can evolve without breaking tests.
 */

const RUNS = [
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

const METRICS = [
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

const HEALTH = {
  status: "ok",
  uptime: 120,
  database: { status: "ok" },
  flusher: { buffered: 0, dropped: 0, flushed: 42 },
  timestamp: "2026-03-02T11:00:00Z",
};

const OVERVIEW = {
  slo: [
    {
      key: "p95",
      label: "p95 latency",
      threshold: 400,
      unit: "ms",
      total: 30,
      met: 28,
      metPct: 28 / 30,
      status: "pass",
    },
    {
      key: "errorRate",
      label: "error rate",
      threshold: 0.01,
      unit: "ratio",
      total: 30,
      met: 27,
      metPct: 27 / 30,
      status: "pass",
    },
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
  worst: [
    { endpoint: "/api/login", avgP95: 320, avgErrorRate: 0.01, runs: 5 },
  ],
  regressions: [
    {
      endpoint: "/api/checkout",
      latestP95: 123,
      baselineP95: 100,
      deltaPct: 23,
      runId: "run-1-aaaa",
      baselineRuns: 10,
    },
  ],
  recentRuns: RUNS,
  meta: { trendDays: 30, frequencyInterval: "week" },
};

async function stubApi(page: Page, options: { authGate?: boolean } = {}) {
  const seen: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    seen.push(`${request.method()} ${path}`);
    (page as unknown as { seen: string[] }).seen = seen;

    const token = options.authGate
      ? request.headers()["authorization"]
      : "Bearer whatever";
    if (options.authGate && token !== "Bearer test-token") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "unauthorized" }),
      });
      return;
    }

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/health") return json(HEALTH);
    if (path === "/api/overview") return json(OVERVIEW);
    if (path === "/api/runs" && request.method() === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return json(RUNS.slice(0, limit));
    }
    if (path === "/api/runs" && request.method() === "POST") {
      return json({ id: "run-new-cccc", status: "running" }, 201);
    }
    if (path === "/api/runs/compare") {
      return json({
        runs: RUNS,
        series: RUNS.flatMap((run) =>
          METRICS.map((row) => ({ ...row, run_id: run.id })),
        ),
      });
    }
    const detail = path.match(/^\/api\/runs\/([^/]+)$/);
    if (detail) {
      const run = RUNS.find((r) => r.id === decodeURIComponent(detail[1]));
      if (request.method() === "DELETE") {
        return json({ id: run?.id ?? "", status: "deleted" });
      }
      return run ? json(run) : json({ error: "not found" }, 404);
    }
    if (path.endsWith("/metrics")) return json(METRICS);
    if (path.endsWith("/raw")) return json([]);
    if (path.endsWith("/endpoints")) return json([]);
    if (path.endsWith("/phases")) return json([]);
    if (path.endsWith("/live")) {
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body: [
          'event: metric\ndata: {"time":"2026-03-02T11:00:00Z","endpoint":"","rps":12,"p50":100,"p95":200,"p99":300,"error_rate":0.01}',
          'event: metric\ndata: {"time":"2026-03-02T11:00:01Z","endpoint":"","rps":14,"p50":101,"p95":205,"p99":310,"error_rate":0.008}',
          'event: run\ndata: {"status":"completed","duration_ms":60000,"total_requests":1000,"p50":100,"p95":200,"p99":300,"error_rate":0.01}',
          "",
        ].join("\n\n"),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "not found" }),
    });
  });

  return seen;
}

async function signIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("broadside.token", "test-token");
  });
  await stubApi(page);
  await page.goto("/");
  await expect(page.locator("broadside-overview-view")).toBeVisible();
}

test("login: a 401 shows the login page and a token unlocks the app", async ({
  page,
}) => {
  await stubApi(page, { authGate: true });
  await page.goto("/");

  await expect(page.locator("broadside-login")).toBeVisible();
  await expect(page.locator("broadside-login")).toContainText("Broadside");

  await page.locator("broadside-login input.input").fill("test-token");
  await page.locator("broadside-login .btn").click();

  await expect(page.locator("broadside-overview-view")).toBeVisible();
  await expect(page.locator("broadside-overview-view")).toContainText("SLO Status");
});

test("overview: shows SLO strip, panels, recent runs and regression link", async ({
  page,
}) => {
  await signIn(page);
  const overview = page.locator("broadside-overview-view");
  await expect(overview).toContainText("SLO Status");
  await expect(overview).toContainText("SLO Target");
  await expect(overview).toContainText("Regression alerts");
  await expect(overview).toContainText("Recent runs");
  await expect(overview).toContainText("Worst endpoints");
  await expect(overview.getByRole("link", { name: /run/i }).first()).toBeVisible();
  // Status is shown polymorphically (dot+text); assert the contract, not glyphs.
  await expect(overview).toContainText("completed");
  await expect(overview).toContainText("running");
  await expect(overview.locator("broadside-status-dot").first()).toBeVisible();
});

test("overview: trend dropdown changes the requested window", async ({ page }) => {
  await signIn(page);
  const overview = page.locator("broadside-overview-view");
  // Custom dropdown (polymorphic control): open and choose "7 days".
  await overview.getByRole("button", { name: "30 days" }).first().click();
  await overview.getByRole("option", { name: "7 days" }).first().click();
  await expect(overview.getByRole("button", { name: "7 days" }).first()).toBeVisible();
});

test("run list: nav and rows render status with delete action", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Runs" }).click();
  await expect(page.locator("broadside-run-list")).toBeVisible();

  const rows = page.locator("broadside-run-list tbody tr");
  await expect(rows).toHaveCount(2);
  const list = page.locator("broadside-run-list");
  await expect(list).toContainText("completed");
  await expect(list).toContainText("running");
  // Delete action is icon+text now; scoped to the list.
  await expect(
    list.getByRole("button", { name: /delete run/i }).first(),
  ).toBeVisible();
});

test("run detail: KPI cards, charts, and destructive action by run state", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-1-aaaa");

  const detail = page.locator("broadside-run-detail");
  await expect(page.locator("broadside-kpi-card")).toHaveCount(6);
  await expect(detail).toContainText(/requests/i);
  await expect(page.locator("broadside-line-chart")).toHaveCount(9);
  const pathNs = await page
    .locator("broadside-line-chart path")
    .first()
    .evaluate((el) => el.namespaceURI);
  expect(pathNs).toBe("http://www.w3.org/2000/svg");
  // Completed run shows "delete" (not kill); polymorphic by state.
  await expect(detail.getByRole("button", { name: /delete/i })).toBeVisible();
  await expect(detail.getByRole("button", { name: /← runs/i })).toBeVisible();
});

test("detail of an unknown run shows the not-found view", async ({ page }) => {
  await signIn(page);
  await page.goto("#/runs/does-not-exist");

  await expect(page.locator("broadside-not-found")).toBeVisible();
  await expect(page.locator("broadside-not-found")).toContainText("Run not found");
});

test("live view: streams and shows completion with back navigation", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb/live");

  const live = page.locator("broadside-live-view");
  await expect(live).toContainText("completed");
  await expect(live).toContainText("view full report");
  await expect(live.getByRole("button", { name: /← runs/i })).toBeVisible();
});

test("compare: selecting two runs renders charts and a KPI table", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/compare");

  const view = page.locator("broadside-compare-view");
  const boxes = view.locator("input[type='checkbox']");
  await expect(boxes).toHaveCount(2);
  await boxes.first().check();
  await boxes.nth(1).check();
  await view.getByRole("button", { name: /compare/i }).click();

  await expect(view.locator("table tbody tr")).toHaveCount(2);
  await expect(page.locator("broadside-line-chart")).toHaveCount(9);
});

test("kill (running run): confirm dialog and return to runs list", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb");

  const detail = page.locator("broadside-run-detail");
  await detail.getByRole("button", { name: /kill/i }).click();

  const dialog = page.locator("broadside-confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/kill run/i);
  // Modal capitalizes labels; match case-insensitively.
  await dialog.getByRole("button", { name: /^kill$/i }).click();

  await expect.poll(() => page.url()).toContain("#/runs");
  await expect(page.locator("broadside-run-list")).toBeVisible();
});

test("new run: dialog submits and navigates to the live view", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs");

  await page
    .locator("broadside-run-list")
    .getByRole("button", { name: /new run/i })
    .click();
  const sheet = page.locator("broadside-trigger-dialog .sheet");
  await expect(sheet).toBeVisible();

  await page.locator("broadside-trigger-dialog input.input").first().fill("./load-test.yml");
  await sheet.getByRole("button", { name: /start run/i }).click();

  await expect.poll(() => page.url()).toContain("#/runs/run-new-cccc/live");
});

test("delete from runs list: confirm dialog uses trash action", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs");

  const list = page.locator("broadside-run-list");
  await list.getByRole("button", { name: /delete run/i }).first().click();

  const dialog = page.locator("broadside-confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/delete run/i);
  await dialog.getByRole("button", { name: /^delete$/i }).click();
  await expect(dialog).not.toBeVisible();
});

test("an unknown hash shows the not-found view", async ({ page }) => {
  await signIn(page);
  await page.goto("#/nowhere");

  await expect(page.locator("broadside-not-found")).toBeVisible();
});
