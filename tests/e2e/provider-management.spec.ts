import { test, expect, seedCheckpoint, createMinimalCheckpoint } from "./fixtures.js";

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("Settings")').click();
}

async function navigateToProvidersTab(page: import("@playwright/test").Page) {
  await page.locator('.ei-modal__tab:has-text("Providers")').click();
  await page.waitForTimeout(200);
}

test.describe("Provider Management", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("can add a new provider", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Click Add Provider button
    await page.locator('button:has-text("Add Provider Account")').click();

    // Verify modal is open
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ei-provider-editor__title')).toContainText('Add Provider Account');

    // Fill in form
    await page.locator('#provider-name').fill('Test Provider');
    await page.locator('#provider-url').fill('http://localhost:8080/v1');
    await page.locator('#provider-api-key').fill('test-api-key');

    // Add a model via the model card UI
    await page.locator('button:has-text("+ Add Model")').click();
    await page.locator('.ei-provider-editor__model-name').first().fill('test-model');

    // Save
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Provider")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify provider appears in list
    const providerCard = page.locator('.ei-provider-card:has-text("Test Provider")');
    await expect(providerCard).toBeVisible();
    await expect(providerCard.locator('.ei-provider-card__name')).toContainText('Test Provider');
    await expect(providerCard.locator('.ei-provider-card__url')).toContainText('localhost:8080');
  });

  test("can edit an existing provider", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Find the Mock LLM provider card and click Edit
    const mockLlmCard = page.locator('.ei-provider-card:has-text("Mock LLM")');
    await expect(mockLlmCard).toBeVisible();
    await mockLlmCard.locator('button:has-text("Edit")').click();

    // Verify editor modal is open with existing data
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ei-provider-editor__title')).toContainText('Edit Provider Account');
    await expect(page.locator('#provider-name')).toHaveValue('Mock LLM');

    // Get current URL and change the port
    const currentUrl = await page.locator('#provider-url').inputValue();
    const newUrl = currentUrl.replace(/:\d+/, ':9999'); // Change port to 9999
    await page.locator('#provider-url').fill(newUrl);

    // Save changes
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Changes")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify the URL was updated in the provider card
    const updatedCard = page.locator('.ei-provider-card:has-text("Mock LLM")');
    await expect(updatedCard).toBeVisible();
    await expect(updatedCard.locator('.ei-provider-card__url')).toContainText('9999');
  });

  test("can cancel adding a new provider", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Count existing providers
    const initialProviderCount = await page.locator('.ei-provider-card').count();

    // Click Add Provider button
    await page.locator('button:has-text("Add Provider Account")').click();

    // Fill in some data
    await page.locator('#provider-name').fill('Cancelled Provider');
    await page.locator('#provider-url').fill('http://localhost:7777/v1');

    // Click Cancel
    await page.locator('.ei-provider-editor .ei-btn--secondary:has-text("Cancel")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify provider was NOT added
    const finalProviderCount = await page.locator('.ei-provider-card').count();
    expect(finalProviderCount).toBe(initialProviderCount);
    await expect(page.locator('.ei-provider-card:has-text("Cancelled Provider")')).not.toBeVisible();
  });

  test("can cancel editing an existing provider", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Find the Mock LLM provider and get its original URL
    const mockLlmCard = page.locator('.ei-provider-card:has-text("Mock LLM")');
    await expect(mockLlmCard).toBeVisible();
    const originalUrlText = await mockLlmCard.locator('.ei-provider-card__url').textContent();

    // Click Edit
    await mockLlmCard.locator('button:has-text("Edit")').click();

    // Get original URL from input
    const originalUrl = await page.locator('#provider-url').inputValue();

    // Make changes
    await page.locator('#provider-name').fill('Changed Name');
    await page.locator('#provider-url').fill('http://localhost:6666/v1');

    // Click Cancel
    await page.locator('.ei-provider-editor .ei-btn--secondary:has-text("Cancel")').click();

    // Verify modal closed
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify changes were NOT saved
    const unchangedCard = page.locator('.ei-provider-card:has-text("Mock LLM")');
    await expect(unchangedCard).toBeVisible();
    await expect(unchangedCard.locator('.ei-provider-card__name')).toContainText('Mock LLM');
    await expect(unchangedCard.locator('.ei-provider-card__url')).toContainText(originalUrlText || '');
    
    // Verify the bad name doesn't exist
    await expect(page.locator('.ei-provider-card:has-text("Changed Name")')).not.toBeVisible();
  });

  test("provider and model settings persist after reload", async ({ page, mockServerUrl }) => {
    const checkpoint = createMinimalCheckpoint(mockServerUrl);
    await page.addInitScript(({ key, data }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(data));
      }
    }, { key: "ei_state", data: checkpoint });
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Click Add Provider button
    await page.locator('button:has-text("Add Provider Account")').click();
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });

    // Fill provider details
    await page.locator('#provider-name').fill('Persist Test Provider');
    await page.locator('#provider-url').fill('http://localhost:9876/v1');
    await page.locator('#provider-api-key').fill('persist-api-key');

    // Add a model with token_limit and max_output_tokens
    await page.locator('button:has-text("+ Add Model")').click();
    await page.locator('.ei-provider-editor__model-name').first().fill('persist-model');
    await page.locator('.ei-provider-editor__model-context').first().fill('128000');
    await page.locator('.ei-provider-editor__model-output').first().fill('4096');

    // Save
    await page.locator('.ei-provider-editor .ei-btn--primary:has-text("Save Provider")').click();
    await expect(page.locator('.ei-provider-editor')).not.toBeVisible();

    // Verify provider card is visible before reload
    await expect(page.locator('.ei-provider-card:has-text("Persist Test Provider")')).toBeVisible();

    // Brief wait to ensure state is persisted to localStorage
    await page.waitForTimeout(500);

    // Reload the page
    await page.reload();
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Re-open settings and navigate to Providers
    await openSettingsModal(page);
    await navigateToProvidersTab(page);

    // Find the persisted provider and open Edit
    const persistedCard = page.locator('.ei-provider-card:has-text("Persist Test Provider")');
    await expect(persistedCard).toBeVisible();
    await persistedCard.locator('button:has-text("Edit")').click();

    // Verify provider editor shows correct values
    await expect(page.locator('.ei-provider-editor')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#provider-name')).toHaveValue('Persist Test Provider');

    // Verify model fields persisted
    await expect(page.locator('.ei-provider-editor__model-name').first()).toHaveValue('persist-model');
    await expect(page.locator('.ei-provider-editor__model-context').first()).toHaveValue('128000');
    await expect(page.locator('.ei-provider-editor__model-output').first()).toHaveValue('4096');
  });
});
