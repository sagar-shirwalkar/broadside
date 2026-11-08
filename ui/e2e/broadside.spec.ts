import { expect, test, type Page } from "@playwright/test";

/** Fake API: the backend is stubbed at the network layer so the suite runs
 *  against the Vite dev server alone (no database, no Artillery). */

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
  await expect(page.locator("broadside-run-list")).toBeVisible();
}

test("login: a 401 shows the login page and a token unlocks the app", async ({
  page,
}) => {
  await stubApi(page, { authGate: true });
  await page.goto("/");

  await expect(page.locator("broadside-login")).toBeVisible();
  await expect(page.locator("broadside-login")).toContainText("Broadside");

  // Shoelace inputs are shadow DOM; set the value and fire the event.
  // (Playwright locators pierce the open shadow roots of app + login.)
  await page
    .locator("broadside-login sl-input")
    .evaluate((el) => {
      (el as HTMLInputElement).value = "test-token";
      el.dispatchEvent(
        new Event("sl-input", { bubbles: true, composed: true }),
      );
    });
  await page.locator("broadside-login sl-button").click();

  await expect(page.locator("broadside-run-list")).toBeVisible();
  await expect(page.locator("broadside-run-list")).toContainText("run-1");
});

test("run list renders rows with status badges", async ({ page }) => {
  await signIn(page);

  const rows = page.locator("broadside-run-list tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("broadside-run-list")).toContainText("completed");
  await expect(page.locator("broadside-run-list")).toContainText("running");
});

test("run detail shows KPI cards and charts", async ({ page }) => {
  await signIn(page);
  await page.goto("#/runs/run-1-aaaa");

  await expect(page.locator("broadside-kpi-card")).toHaveCount(6);
  await expect(page.locator("broadside-run-detail")).toContainText("Total Requests");
  await expect(page.locator("broadside-line-chart")).toHaveCount(4);
});

test("detail of an unknown run shows the not-found view", async ({ page }) => {
  await signIn(page);
  await page.goto("#/runs/does-not-exist");

  await expect(page.locator("broadside-not-found")).toBeVisible();
  await expect(page.locator("broadside-not-found")).toContainText("Run not found");
});

test("live view streams points and shows the completion banner", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb/live");

  await expect(page.locator("broadside-live-view")).toContainText("completed");
  await expect(page.locator("broadside-live-view")).toContainText("View full report");
});

test("compare: selecting two runs renders charts and a KPI table", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/compare");

  const boxes = page.locator("broadside-compare-view sl-checkbox");
  await expect(boxes).toHaveCount(2);
  await boxes.first().click();
  await boxes.nth(1).click();
  await page.locator("broadside-compare-view sl-button").click();

  await expect(page.locator("broadside-compare-view table tbody tr")).toHaveCount(2);
  await expect(page.locator("broadside-line-chart")).toHaveCount(3);
});

test("kill: confirming on a running run deletes and returns to the list", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb");

  await page
    .locator("broadside-run-detail sl-button:visible")
    .filter({ hasText: "Kill" })
    .click();
  await expect(page.locator("broadside-confirm-dialog")).toContainText("Kill run?");
  await page
    .locator("broadside-confirm-dialog sl-button")
    .getByText("Kill", { exact: true })
    .click();

  await expect.poll(() => page.url()).toBe("http://localhost:5173/#/");
  await expect(page.locator("broadside-run-list")).toBeVisible();
});

test("new run: the dialog submits and navigates to the live view", async ({
  page,
}) => {
  await signIn(page);

  await page.locator("broadside-run-list sl-button", { hasText: "New Run" }).click();
  const dialog = page.locator("broadside-trigger-dialog sl-dialog");
  await expect(dialog).toBeVisible();

  await page
    .locator("broadside-trigger-dialog sl-input")
    .first()
    .evaluate((el) => {
      (el as HTMLInputElement).value = "./load-test.yml";
      el.dispatchEvent(
        new Event("sl-input", { bubbles: true, composed: true }),
      );
    });
  await page
    .locator("broadside-trigger-dialog sl-button", { hasText: "Start run" })
    .click();

  await expect.poll(() => page.url()).toContain("#/runs/run-new-cccc/live");
});

test("an unknown hash shows the not-found view", async ({ page }) => {
  await signIn(page);
  await page.goto("#/nowhere");

  await expect(page.locator("broadside-not-found")).toBeVisible();
});
