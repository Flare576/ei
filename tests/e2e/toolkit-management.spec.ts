import { test, expect, seedCheckpoint } from "./fixtures.js";

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("Settings")').click();
}

async function navigateToToolkitsTab(page: import("@playwright/test").Page) {
  await page.locator('.ei-modal__tab:has-text("Toolkits")').click();
  await page.waitForTimeout(200);
}

test.describe("Toolkit Management", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("system tools do not appear in Ei Built-ins editor", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await navigateToToolkitsTab(page);

    const eiBuiltinsCard = page.locator('.ei-provider-card:has-text("Ei Built-ins")');
    await expect(eiBuiltinsCard).toBeVisible();
    await eiBuiltinsCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });

    // System tools are injected at queue time and must never appear as toggleable UI elements
    await expect(page.locator('.ei-toolkit-tool-readonly:has-text("Find Memory")')).not.toBeVisible();
    await expect(page.locator('.ei-toolkit-tool-readonly:has-text("Fetch Memory")')).not.toBeVisible();
    await expect(page.locator('.ei-toolkit-tool-readonly:has-text("Fetch Message")')).not.toBeVisible();
    await expect(page.locator('.ei-toolkit-tool-readonly:has-text("Read Memory")')).not.toBeVisible();
  });

  test("can add API key to Tavily", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Toolkits
    await openSettingsModal(page);
    await navigateToToolkitsTab(page);

    // Find the Tavily Search provider card
    const tavilyCard = page.locator('.ei-provider-card:has-text("Tavily Search")');
    await expect(tavilyCard).toBeVisible();

    // Click Edit to open the toolkit editor
    await tavilyCard.locator('button:has-text("Edit")').click();

    // Verify editor modal is open
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ei-provider-editor__title')).toContainText('Edit Tool Kit: Tavily Search');

    // Find the API key input (should be in config section)
    // Based on ToolkitEditor.tsx, config rows have class ei-provider-editor__header-value
    const apiKeyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await expect(apiKeyInput).toBeVisible();

    // Fill in the API key
    await apiKeyInput.fill('test-tavily-key-12345');

    // Save changes
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Changes")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Re-open editor to verify persistence (key will be masked)
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const verifyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await expect(verifyInput).toHaveValue('test-tavily-key-12345');
  });

  test("can edit existing API key", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Toolkits
    await openSettingsModal(page);
    await navigateToToolkitsTab(page);

    // Find the Tavily Search provider card and add initial key
    const tavilyCard = page.locator('.ei-provider-card:has-text("Tavily Search")');
    await expect(tavilyCard).toBeVisible();
    await tavilyCard.locator('button:has-text("Edit")').click();

    // Add initial API key
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    const apiKeyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await apiKeyInput.fill('initial-key-12345');
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Changes")').click();
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Re-open and change the key
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const editInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await editInput.fill('updated-key-67890');
    
    // Save changes
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Changes")').click();
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify the new key persisted
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const verifyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await expect(verifyInput).toHaveValue('updated-key-67890');
  });

  test("can cancel adding API key", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Toolkits
    await openSettingsModal(page);
    await navigateToToolkitsTab(page);

    // Find the Tavily Search provider card
    const tavilyCard = page.locator('.ei-provider-card:has-text("Tavily Search")');
    await expect(tavilyCard).toBeVisible();

    // Click Edit to open the toolkit editor
    await tavilyCard.locator('button:has-text("Edit")').click();

    // Verify editor modal is open
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });

    // Fill in the API key
    const apiKeyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await apiKeyInput.fill('cancelled-key-99999');

    // Click Cancel
    await page.locator('.ei-provider-editor .ei-btn--secondary:has-text("Cancel")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Re-open editor to verify key was NOT saved
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const verifyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    // Should be empty (default from bootstrapTools is empty string)
    await expect(verifyInput).toHaveValue('');
  });

  test("can cancel editing API key", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Toolkits
    await openSettingsModal(page);
    await navigateToToolkitsTab(page);

    // Find the Tavily Search provider card and add initial key
    const tavilyCard = page.locator('.ei-provider-card:has-text("Tavily Search")');
    await expect(tavilyCard).toBeVisible();
    await tavilyCard.locator('button:has-text("Edit")').click();

    // Add initial API key
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    const apiKeyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await apiKeyInput.fill('original-key-11111');
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Changes")').click();
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Re-open and attempt to change the key
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const editInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await editInput.fill('should-not-save-22222');
    
    // Click Cancel
    await page.locator('.ei-provider-editor .ei-btn--secondary:has-text("Cancel")').click();
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify the original key is still there
    await tavilyCard.locator('button:has-text("Edit")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    
    const verifyInput = page.locator('.ei-provider-editor__header-value[type="password"]').first();
    await expect(verifyInput).toHaveValue('original-key-11111');
  });
});
