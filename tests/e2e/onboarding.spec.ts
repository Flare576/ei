import { test, expect } from "./fixtures.js";

/**
 * Onboarding flow tests.
 * 
 * These tests do NOT seed checkpoints - they start fresh to test the actual
 * onboarding experience new users see.
 */
test.describe("Onboarding Flow", () => {
  test.beforeEach(async ({ page, mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    // Clear any existing state so onboarding shows
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("shows onboarding when no checkpoints exist", async ({ page }) => {
    await page.goto("/");

    // Should see the welcome step
    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Your Local-First AI Companion")).toBeVisible();
    
    // Should see the restore form
    await expect(page.locator('input[placeholder="Username"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Passphrase"]')).toBeVisible();
    await expect(page.locator("button:text('Restore')")).toBeVisible();
    
    // Should see the Start Fresh button
    await expect(page.locator("text=Start Fresh")).toBeVisible();
  });

  test("can navigate from Welcome to LocalLLMCheck step", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    
    // Click Start Fresh
    await page.locator("text=Start Fresh").click();
    
    // Should now be on LocalLLMCheck step (step 2)
    await expect(page.locator("text=Step 2 of 4")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[placeholder="http://127.0.0.1:1234/v1"]')).toBeVisible();
    
    // Info sections should be visible on this step
    await expect(page.locator("text=What Makes Ei Different")).toBeVisible();
  });

  test("shows LLM check result after navigating to step 2", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await page.locator("text=Start Fresh").click();
    
    // Wait for the LLM check to complete - should show one of the results
    const foundLocator = page.locator("text=Local LLM found!");
    const notFoundLocator = page.locator("text=No local LLM detected");
    const corsLocator = page.locator("text=CORS Issue Detected");
    
    // Wait for any of the three possible results
    await expect(foundLocator.or(notFoundLocator).or(corsLocator)).toBeVisible({ timeout: 10000 });
  });

  test("can navigate back from LocalLLMCheck to Welcome", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await page.locator("text=Start Fresh").click();
    
    await expect(page.locator("text=Step 2 of 4")).toBeVisible({ timeout: 5000 });
    
    // Click Back
    await page.locator("button:text('← Back')").click();
    
    // Should be back on Welcome
    await expect(page.locator("text=Step 1 of 4")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Start Fresh")).toBeVisible();
  });

  test("progress bar updates between steps", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Step 1 of 4")).toBeVisible();
    
    await page.locator("text=Start Fresh").click();
    
    await expect(page.locator("text=Step 2 of 4")).toBeVisible({ timeout: 5000 });
  });

  test("shows error for invalid sync credentials", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    
    // Fill in credentials
    await page.locator('input[placeholder="Username"]').fill("baduser");
    await page.locator('input[placeholder="Passphrase"]').fill("badpass");
    
    // Click Restore
    await page.locator("button:text('Restore')").click();
    
    // Should see error (either network error or "no data found")
    await expect(page.locator(".ei-onboarding__error")).toBeVisible({ timeout: 10000 });
  });

  test("can reach ProviderSetup step from LocalLLMCheck", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await page.locator("text=Start Fresh").click();
    
    // Wait for LLM check to complete - one of three results
    const foundLocator = page.locator("text=Local LLM found!");
    const notFoundLocator = page.locator("text=No local LLM detected");
    const corsLocator = page.locator("text=CORS Issue Detected");
    await expect(foundLocator.or(notFoundLocator).or(corsLocator)).toBeVisible({ timeout: 10000 });
    
    // Click the appropriate button to get to ProviderSetup
    const setUpProvidersBtn = page.locator("button:text('Set Up Providers')");
    const addAnotherBtn = page.locator("button:text('Add Another Provider')");
    
    if (await setUpProvidersBtn.isVisible()) {
      await setUpProvidersBtn.click();
    } else {
      await addAnotherBtn.click();
    }
    
    // Should be on ProviderSetup (step 3)
    await expect(page.locator("text=Step 3 of 4")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=LLM Providers")).toBeVisible();
  });

  test("ProviderSetup step requires at least one provider to continue", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("text=Welcome to Ei")).toBeVisible({ timeout: 10000 });
    await page.locator("text=Start Fresh").click();
    
    // Wait for LLM check to complete
    const foundLocator = page.locator("text=Local LLM found!");
    const notFoundLocator = page.locator("text=No local LLM detected");
    const corsLocator = page.locator("text=CORS Issue Detected");
    await expect(foundLocator.or(notFoundLocator).or(corsLocator)).toBeVisible({ timeout: 10000 });
    
    // If local LLM found, the provider is auto-added, so we can't test the disabled state
    // Skip this test if LLM was found - it already has a provider
    if (await foundLocator.isVisible()) {
      // Local LLM was found - verify Continue button is enabled instead
      await expect(page.locator("button:text('Continue')")).toBeEnabled();
      return;
    }
    
    // Go to ProviderSetup
    await page.locator("button:text('Set Up Providers')").click();
    
    await expect(page.locator("text=Step 3 of 4")).toBeVisible({ timeout: 5000 });
    
    // Continue button should be disabled with no providers
    const continueBtn = page.locator("button:text('Add a Provider First')");
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toBeDisabled();
  });
});
