import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.ts";

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

  await expect(view.locator(".table-card tbody tr")).toHaveCount(2);
  await expect(page.locator("broadside-line-chart")).toHaveCount(9);
});
