import { test, expect, seedCheckpoint } from "./fixtures.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("Settings")').click();
}

async function navigateToAppearanceTab(page: import("@playwright/test").Page) {
  await page.locator('.ei-modal__tab:has-text("Appearance")').click();
  await page.waitForTimeout(200);
}

async function openAppearance(page: import("@playwright/test").Page) {
  await openSettingsModal(page);
  await navigateToAppearanceTab(page);
}

async function getDataTheme(page: import("@playwright/test").Page): Promise<string | null> {
  return page.locator("html").getAttribute("data-theme");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Theme System", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  // ── Test 1: Selecting a built-in preset changes data-theme ────────────────
  test("selecting a built-in preset updates the data-theme attribute", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openAppearance(page);

    // Built-in preset cards should be visible
    await expect(page.locator(".ei-theme-preset-card").first()).toBeVisible({ timeout: 5000 });

    // Default theme = no data-theme attribute
    const initialTheme = await getDataTheme(page);
    expect(initialTheme === null || initialTheme === "default").toBeTruthy();

    // Click the "Spoopy" preset card
    await page.locator('.ei-theme-preset-card:has-text("Spoopy")').click();
    await page.waitForTimeout(300);

    expect(await getDataTheme(page)).toBe("spoopy");

    // Click another preset — "c0d3r"
    await page.locator('.ei-theme-preset-card:has-text("c0d3r")').click();
    await page.waitForTimeout(300);

    expect(await getDataTheme(page)).toBe("coder");
  });

  // ── Test 2: Creating a custom theme and verifying it appears in the list ──
  test("creating a custom theme shows it in My Themes and selects it", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openAppearance(page);

    // My Themes section should initially be empty
    await expect(page.locator(".ei-theme-custom__empty")).toBeVisible({ timeout: 5000 });

    // Click "+ New Theme"
    await page.locator('button:has-text("+ New Theme")').click();
    await page.waitForTimeout(300);

    // Theme editor should be open — verify name field is present
    await expect(page.locator("#theme-name")).toBeVisible({ timeout: 5000 });

    // Change one color — the first color input in the Backgrounds section
    const firstColorInput = page.locator('.ei-theme-editor__token-section').first()
      .locator('input[type="color"]').first();
    await firstColorInput.fill("#ff0099");
    await page.waitForTimeout(200);

    // Enter a name
    await page.locator("#theme-name").fill("My Test Theme");

    // Save
    await page.locator('.ei-theme-editor__footer button:has-text("Save")').click();
    await page.waitForTimeout(500);

    // Theme editor should be closed
    await expect(page.locator("#theme-name")).not.toBeVisible();

    // "My Test Theme" should now appear in My Themes
    await expect(page.locator('.ei-theme-custom-card__name:has-text("My Test Theme")')).toBeVisible({ timeout: 5000 });

    // It should be selected (UUID-based data-theme, not a built-in name)
    const theme = await getDataTheme(page);
    expect(theme).toBe("custom");

    // The empty state should be gone
    await expect(page.locator(".ei-theme-custom__empty")).not.toBeVisible();
  });

  // ── Test 3: Custom theme persists across page reload ──────────────────────
  test("custom theme persists after page reload", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openAppearance(page);
    await page.locator('button:has-text("+ New Theme")').click();
    await page.waitForTimeout(300);

    await page.locator("#theme-name").fill("Persistent Theme");
    await page.locator('.ei-theme-editor__footer button:has-text("Save")').click();
    await page.waitForTimeout(500);

    // Verify it's in the list before reload
    await expect(page.locator('.ei-theme-custom-card__name:has-text("Persistent Theme")')).toBeVisible();

    // Close settings and reload
    await page.locator('button[aria-label="Close settings"]').click().catch(() =>
      page.keyboard.press("Escape")
    );
    await page.reload();
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // Open Appearance tab again
    await openAppearance(page);

    // Theme should still be there
    await expect(page.locator('.ei-theme-custom-card__name:has-text("Persistent Theme")')).toBeVisible({ timeout: 5000 });

    // And data-theme should still be "custom" (the saved theme is still active)
    expect(await getDataTheme(page)).toBe("custom");
  });

  // ── Test 4: Cancel in theme editor reverts the live preview ──────────────
  test("cancelling theme editor reverts the live preview to the previous theme", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    // First select a known preset so we have a non-default starting point
    await openAppearance(page);
    await page.locator('.ei-theme-preset-card:has-text("Dark")').click();
    await page.waitForTimeout(300);
    expect(await getDataTheme(page)).toBe("dark");

    // Open the editor for a new theme — this triggers live preview (data-theme → "custom")
    await page.locator('button:has-text("+ New Theme")').click();
    await page.waitForTimeout(300);
    await expect(page.locator("#theme-name")).toBeVisible();

    // Live preview should now be active
    // (data-theme is "custom" while editing)
    expect(await getDataTheme(page)).toBe("custom");

    // Cancel — should revert to "dark"
    await page.locator('.ei-theme-editor__footer button:has-text("Cancel")').click();
    await page.waitForTimeout(300);

    expect(await getDataTheme(page)).toBe("dark");

    // Editor should be closed
    await expect(page.locator("#theme-name")).not.toBeVisible();
  });

  // ── Test 5: Export/Import roundtrip ──────────────────────────────────────
  test("export produces a valid theme string and import applies it", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openAppearance(page);

    // Create a theme to export
    await page.locator('button:has-text("+ New Theme")').click();
    await page.waitForTimeout(300);
    await page.locator("#theme-name").fill("Export Source");
    await page.locator('.ei-theme-editor__footer button:has-text("Save")').click();
    await page.waitForTimeout(500);

    // Open the saved theme to edit/export
    await page.locator('.ei-theme-custom-card:has-text("Export Source") button:has-text("Edit")').click();
    await page.waitForTimeout(300);

    // Grant clipboard permissions and capture the exported string
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.locator('button:has-text("Export")').click();
    await page.waitForTimeout(300);

    const exportedString = await page.evaluate(() => navigator.clipboard.readText());
    expect(exportedString).toMatch(/^ei-theme:v1:/);

    // Cancel out of this editor
    await page.locator('.ei-theme-editor__footer button:has-text("Cancel")').click();
    await page.waitForTimeout(300);

    // Create a new theme and use Import to apply the exported string
    await page.locator('button:has-text("+ New Theme")').click();
    await page.waitForTimeout(300);
    await expect(page.locator("#theme-name")).toBeVisible();

    // Click Import to reveal the textarea
    await page.locator('button:has-text("Import")').click();
    await page.waitForTimeout(200);

    // Import textarea should now be visible
    await expect(page.locator('.ei-theme-editor__import-area textarea')).toBeVisible({ timeout: 5000 });

    // Paste the exported string
    await page.locator('.ei-theme-editor__import-area textarea').fill(exportedString);
    await page.locator('.ei-theme-editor__import-area button:has-text("Apply")').click();
    await page.waitForTimeout(300);

    // Import area should be gone (applied successfully)
    await expect(page.locator('.ei-theme-editor__import-area')).not.toBeVisible();

    // Name the new theme and save
    await page.locator("#theme-name").fill("Imported Theme");
    await page.locator('.ei-theme-editor__footer button:has-text("Save")').click();
    await page.waitForTimeout(500);

    // Both themes should now appear in My Themes
    await expect(page.locator('.ei-theme-custom-card__name:has-text("Export Source")')).toBeVisible();
    await expect(page.locator('.ei-theme-custom-card__name:has-text("Imported Theme")')).toBeVisible();
  });
});
