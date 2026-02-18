import { test, expect, seedCheckpoint } from "./fixtures.js";

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("Settings")').click();
}

async function navigateToProvidersTab(page: import("@playwright/test").Page) {
  await page.locator('.ei-modal__tab:has-text("Providers")').click();
  await page.waitForTimeout(200);
}

test.describe("Settings Management", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("can open settings modal", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    
    await openSettingsModal(page);
    
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });
    await expect(page.locator('#name-display')).toBeVisible();
    await expect(page.locator('#time-mode')).toBeVisible();
  });

  test("can navigate to provider accounts section", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    await expect(page.locator('.ei-settings-section__title:has-text("Provider Accounts")')).toBeVisible();
    await expect(page.locator('button:has-text("Add Provider Account")')).toBeVisible();
  });
});
