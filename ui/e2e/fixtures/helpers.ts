import { expect, type Page } from "@playwright/test";
import { stubApi } from "./api.js";

export async function signIn(
  page: Page,
  options: Parameters<typeof stubApi>[1] = {},
) {
  await page.addInitScript(() => {
    localStorage.setItem("broadside.token", "test-token");
  });
  await stubApi(page, options);
  await page.goto("/");
  await expect(page.locator("broadside-overview-view")).toBeVisible();
}
