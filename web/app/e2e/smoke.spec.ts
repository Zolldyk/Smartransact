import { test, expect } from "@playwright/test";

test.describe("Smartransact smoke tests", () => {
  test("home redirects to /live", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/live/);
  });

  test("all nav pages are reachable", async ({ page }) => {
    for (const path of ["/run", "/evidence", "/architecture", "/readme"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText("404");
      await expect(page.locator("body")).not.toContainText("not found");
    }
  });

  test("evidence page shows the replay table", async ({ page }) => {
    await page.goto("/evidence");
    await page.waitForSelector(".ev-table", { timeout: 10_000 });
    const rowCount = await page.locator(".ev-table tbody tr").count();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("architecture page has 8 section headings", async ({ page }) => {
    await page.goto("/architecture");
    await page.waitForSelector("h2", { timeout: 10_000 });
    const h2Count = await page.locator("h2").count();
    expect(h2Count).toBeGreaterThanOrEqual(8);
  });

  test("readme page shows setup steps", async ({ page }) => {
    await page.goto("/readme");
    await expect(page.locator("body")).toContainText("Setup");
  });
});
