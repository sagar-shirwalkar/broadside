import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.js";

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

test("kill (running run): confirm dialog and return to runs list", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb");

  const detail = page.locator("broadside-run-detail");
  await detail.getByRole("button", { name: /kill/i }).click();

  const dialog = page.getByRole("dialog", { name: /kill run/i });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/kill run/i);
  // Modal capitalizes labels; match case-insensitively.
  await dialog.getByRole("button", { name: /^kill$/i }).click();

  await expect.poll(() => page.url()).toContain("#/runs");
  await expect(page.locator("broadside-run-list")).toBeVisible();
});

test("run detail (running): streams live metrics in-place", async ({ page }) => {
  await signIn(page);
  await page.goto("#/runs/run-2-bbbb");

  const detail = page.locator("broadside-run-detail");
  await expect(detail).toContainText(/live/i);
  await expect(detail.locator("broadside-line-chart")).toHaveCount(9);
  // Streamed points should render chart paths without navigating to /live route.
  await expect
    .poll(async () =>
      page.locator("broadside-line-chart path").count(),
    )
    .toBeGreaterThan(0);
});
