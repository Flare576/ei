import { test, expect, seedCheckpoint } from "./fixtures.js";

const STATE_KEY = "ei_state";

async function openSettingsModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("Settings")').click();
}

async function navigateToDataTab(page: import("@playwright/test").Page) {
  await page.locator('.ei-modal__tab:has-text("Data")').click();
  await page.waitForTimeout(200);
}

function createValidCheckpoint(messages: Array<{ role: string; content: string }> = []) {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [{ content: "Test fact for backup", confidence: 0.9, last_updated: timestamp }],
      traits: [],
      topics: [],
      people: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: { auto_save_interval_ms: 5000 },
    },
    personas: {
      ei: {
        entity: {
          entity: "system",
          id: "ei",
          display_name: "Ei",
          aliases: ["Ei"],
          short_description: "Your personal companion",
          long_description: "A friendly AI companion",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: messages.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role,
          content: m.content,
          timestamp,
        })),
      },
    },
    queue: [],
    settings: {},
  };
}

async function scrollToSection(page: import("@playwright/test").Page, sectionTitle: string) {
  const settingsForm = page.locator('.ei-settings-form');
  await settingsForm.evaluate((el, title) => {
    const headers = el.querySelectorAll('h3');
    for (const h of headers) {
      if (h.textContent?.includes(title)) {
        h.scrollIntoView();
        break;
      }
    }
  }, sectionTitle);
  await page.waitForTimeout(300);
}

test.describe("Backup & Restore", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("download backup produces valid JSON with full state", async ({ page, mockServerUrl }) => {
    const testMessage = "Message to verify in backup";
    const checkpoint = createValidCheckpoint([
      { role: "human", content: testMessage },
      { role: "assistant", content: "I'll remember this!" },
    ]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify(checkpoint));
      },
      { url: mockServerUrl, key: STATE_KEY, checkpoint }
    );

    await page.reload();
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    
    await page.locator(".ei-persona-pill").first().click();
    await expect(page.locator(`text=${testMessage}`)).toBeVisible({ timeout: 10000 });

    await openSettingsModal(page);
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });

    await navigateToDataTab(page);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Download Backup")').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^ei-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const fs = await import('fs/promises');
    const content = await fs.readFile(downloadPath!, 'utf-8');
    const backup = JSON.parse(content);

    expect(backup).toHaveProperty("version");
    expect(backup).toHaveProperty("timestamp");
    expect(backup).toHaveProperty("human");
    expect(backup).toHaveProperty("personas");
    expect(backup.human).toHaveProperty("entity", "human");
    expect(backup.personas).toHaveProperty("ei");
    expect(backup.personas.ei).toHaveProperty("messages");

    const messages = backup.personas.ei.messages;
    const hasTestMessage = messages.some((m: { content: string }) => m.content.includes(testMessage));
    expect(hasTestMessage).toBe(true);
  });

  test("upload backup restores state correctly", async ({ page, mockServerUrl }) => {
    const uniqueMessage = `Restored message ${Date.now()}`;
    const backupCheckpoint = createValidCheckpoint([
      { role: "human", content: uniqueMessage },
      { role: "assistant", content: "This was restored from backup!" },
    ]);
    backupCheckpoint.human.facts = [
      { content: "Restored fact from backup", confidence: 0.95, last_updated: backupCheckpoint.timestamp },
    ];

    const backupContent = JSON.stringify(backupCheckpoint);

    await seedCheckpoint(page, mockServerUrl);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });

    await navigateToDataTab(page);

    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backupContent),
    });

    await page.waitForTimeout(1000);

    const closeButton = page.locator('.ei-settings-modal button[aria-label="Close settings"]');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }

    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator(`text=${uniqueMessage}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=This was restored from backup")).toBeVisible({ timeout: 2000 });
  });
});

test.describe("Cloud Sync Credentials", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("sync credentials require 15+ character combined length", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });

    await navigateToDataTab(page);

    const usernameInput = page.locator('#sync-username');
    const passphraseInput = page.locator('#sync-passphrase');
    const enableButton = page.locator('button:has-text("Enable Sync")');

    await usernameInput.fill("ab");
    await passphraseInput.fill("cd");

    await expect(page.locator('text=/Username \\+ Passphrase must be at least 15 characters/')).toBeVisible();
    await expect(page.locator('text=/\\(4\\/15\\)/')).toBeVisible();
    await expect(enableButton).toBeDisabled();

    await usernameInput.fill("testuser");
    await passphraseInput.fill("mypass7");

    await expect(page.locator('text=/Username \\+ Passphrase must be at least 15 characters/')).not.toBeVisible();
    await expect(enableButton).toBeEnabled();
  });

  test("sync save creates enabled indicator, clear removes it", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });

    await navigateToDataTab(page);

    const usernameInput = page.locator('#sync-username');
    const passphraseInput = page.locator('#sync-passphrase');

    await expect(page.locator('text=/Cloud sync enabled for user:/')).not.toBeVisible();
    await expect(page.locator('button:has-text("Disable Sync")')).not.toBeVisible();

    await usernameInput.fill("testuser123");
    await passphraseInput.fill("strongpass");
    await page.locator('button:has-text("Enable Sync")').click();

    await expect(page.locator('text=/Cloud sync enabled for user: testuser123/')).toBeVisible();
    await expect(page.locator('button:has-text("Update Sync")')).toBeVisible();
    await expect(page.locator('button:has-text("Disable Sync")')).toBeVisible();

    await page.locator('button:has-text("Disable Sync")').click();

    await expect(page.locator('text=/Cloud sync enabled for user:/')).not.toBeVisible();
    await expect(page.locator('button:has-text("Enable Sync")')).toBeVisible();
    await expect(page.locator('button:has-text("Disable Sync")')).not.toBeVisible();

    await expect(usernameInput).toHaveValue("");
    await expect(passphraseInput).toHaveValue("");
  });

  test("passphrase toggle shows/hides text", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openSettingsModal(page);
    await expect(page.locator('.ei-settings-section__title').first()).toContainText('Display', { timeout: 5000 });

    await navigateToDataTab(page);

    const passphraseInput = page.locator('#sync-passphrase');
    const toggleButton = page.locator('.ei-input-toggle');

    await expect(passphraseInput).toHaveAttribute('type', 'password');

    await passphraseInput.fill("mysecretpass");

    await toggleButton.click();
    await expect(passphraseInput).toHaveAttribute('type', 'text');

    await toggleButton.click();
    await expect(passphraseInput).toHaveAttribute('type', 'password');
  });
});
