import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.js";

test("overview: shows SLO strip, panels, recent runs and regression link", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator("broadside-health-badge")).toContainText("healthy");
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
