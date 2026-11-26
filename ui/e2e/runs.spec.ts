import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/helpers.ts";

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

test("new run: dialog submits and navigates to the live view", async ({
  page,
}) => {
  await signIn(page, { completeLiveFor: ["run-new-cccc"] });
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

  const dialog = page.getByRole("dialog", { name: /delete run/i });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/delete run/i);
  await dialog.getByRole("button", { name: /^delete$/i }).click();
  await expect(dialog).not.toBeVisible();
});
