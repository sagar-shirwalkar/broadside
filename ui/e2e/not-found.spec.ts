import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.ts";

test("an unknown hash shows the not-found view", async ({ page }) => {
  await signIn(page);
  await page.goto("#/nowhere");

  await expect(page.locator("broadside-not-found")).toBeVisible();
});
