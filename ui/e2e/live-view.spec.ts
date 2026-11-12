import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.js";

test("live view: streams and shows completion with back navigation", async ({
  page,
}) => {
  await signIn(page, { completeLiveFor: ["run-2-bbbb"] });
  await page.goto("#/runs/run-2-bbbb/live");

  const live = page.locator("broadside-live-view");
  await expect(live).toContainText("completed");
  await expect(live).toContainText("view full report");
  await expect(live.getByRole("button", { name: /← runs/i })).toBeVisible();
});
