import { test, expect, seedCheckpoint } from "./fixtures.js";

test.describe("Targeted Capture & Knowledge Search Modals", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("💡 bulb opens targeted capture modal with search input", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    const captureBtn = page.locator(".ei-capture-btn");
    await expect(captureBtn).toBeVisible();
    await captureBtn.click();

    await expect(page.locator(".ei-data-search-modal")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".ei-data-search-modal__input")).toBeVisible();
    await expect(page.locator(".ei-data-search-modal__title")).toContainText("Targeted Re-scan");
  });

  test("💡 modal closes on Escape", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    await page.locator(".ei-capture-btn").click();
    await expect(page.locator(".ei-data-search-modal")).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".ei-data-search-modal")).not.toBeVisible({ timeout: 2000 });
  });

  test("🔍 magnifying glass opens knowledge search modal with search input", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    const knowledgeBtn = page.locator(".ei-knowledge-btn");
    await expect(knowledgeBtn).toBeVisible();
    await knowledgeBtn.click();

    await expect(page.locator(".ei-data-search-modal")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".ei-data-search-modal__input")).toBeVisible();
    await expect(page.locator(".ei-data-search-modal__title")).toContainText("What does Ei know about");
  });

  test("🔍 modal closes on Escape", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    await page.locator(".ei-knowledge-btn").click();
    await expect(page.locator(".ei-data-search-modal")).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".ei-data-search-modal")).not.toBeVisible({ timeout: 2000 });
  });

  test("context boundary button still works after adding 🔍 button", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    const boundaryBtn = page.locator(".ei-boundary-btn:not(.ei-image-prompt-btn):not(.ei-capture-btn):not(.ei-knowledge-btn)");
    await expect(boundaryBtn).toBeVisible();
    await expect(boundaryBtn).toHaveCount(1);
    await expect(boundaryBtn).toHaveText("✦");

    await boundaryBtn.click();
    await expect(page.locator(".ei-context-divider")).toBeVisible({ timeout: 2000 });
  });
});
