import { test, expect, seedCheckpoint } from "./fixtures.js";

test.describe("Settings Management", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("can open human editor settings", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    
    await page.locator('button[aria-label="Settings"]').click();
    
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display Settings', { timeout: 5000 });
    await expect(page.locator('#name-display')).toBeVisible();
    await expect(page.locator('#time-mode')).toBeVisible();
  });

  test("can navigate to provider accounts section", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Settings"]').click();

    const settingsSection = page.locator('.ei-settings-form');
    await settingsSection.evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(300);

    await expect(page.locator('.ei-settings-section__title:has-text("Provider Accounts")')).toBeVisible();
    await expect(page.locator('button:has-text("Add Provider Account")')).toBeVisible();
  });
});
