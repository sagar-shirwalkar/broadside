import { expect, test } from "@playwright/test";
import { stubApi } from "./fixtures/api.js";

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
  await expect(page.locator("broadside-health-badge")).toContainText("healthy");
  await expect(page.locator("broadside-overview-view")).toContainText("SLO Status");
});
