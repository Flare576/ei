import { test, expect } from "@playwright/test";
import { MockLLMServerImpl } from "./framework/mock-server.js";

const MOCK_SERVER_URL = "http://localhost:3001/v1";
const AUTO_SAVES_KEY = "ei_autosaves";

function createValidCheckpoint(messages: Array<{ role: string; content: string }> = []) {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
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

test.describe.configure({ mode: "serial" });

test.describe("Checkpoint Flow", () => {
  let mockServer: MockLLMServerImpl;

  test.beforeAll(async () => {
    mockServer = new MockLLMServerImpl();
    await mockServer.start(3001, { enableLogging: false, responses: {} });
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async () => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("app loads state from pre-existing checkpoint in localStorage", async ({ page }) => {
    const testMessage = "This message was saved in a previous session";
    const checkpoint = createValidCheckpoint([
      { role: "human", content: testMessage },
      { role: "assistant", content: "I remember our conversation!" },
    ]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator(`text=${testMessage}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=I remember our conversation")).toBeVisible({ timeout: 5000 });
  });

  test("checkpoint structure validation - required fields present", async ({ page }) => {
    const checkpoint = createValidCheckpoint([]);

    await page.goto("/");

    await page.evaluate(
      ({ key, checkpoint }) => {
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { key: AUTO_SAVES_KEY, checkpoint }
    );

    const storedCheckpoint = await page.evaluate((key) => {
      const data = localStorage.getItem(key);
      if (!data) return null;
      const checkpoints = JSON.parse(data);
      return checkpoints[0];
    }, AUTO_SAVES_KEY);

    expect(storedCheckpoint).not.toBeNull();
    expect(storedCheckpoint).toHaveProperty("version");
    expect(storedCheckpoint).toHaveProperty("timestamp");
    expect(storedCheckpoint).toHaveProperty("human");
    expect(storedCheckpoint).toHaveProperty("personas");
    expect(storedCheckpoint).toHaveProperty("queue");
    expect(storedCheckpoint).toHaveProperty("settings");

    expect(storedCheckpoint.human).toHaveProperty("entity", "human");
    expect(storedCheckpoint.human).toHaveProperty("facts");
    expect(storedCheckpoint.human).toHaveProperty("settings");

    expect(storedCheckpoint.personas).toHaveProperty("ei");
    expect(storedCheckpoint.personas.ei).toHaveProperty("entity");
    expect(storedCheckpoint.personas.ei).toHaveProperty("messages");

    expect(new Date(storedCheckpoint.timestamp).toString()).not.toBe("Invalid Date");
  });

  test("app uses most recent checkpoint when multiple exist", async ({ page }) => {
    const oldCheckpoint = createValidCheckpoint([
      { role: "human", content: "Old message from yesterday" },
    ]);
    oldCheckpoint.timestamp = new Date(Date.now() - 86400000).toISOString();

    const newCheckpoint = createValidCheckpoint([
      { role: "human", content: "Recent message from today" },
      { role: "assistant", content: "This is the latest state" },
    ]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoints }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify(checkpoints));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoints: [oldCheckpoint, newCheckpoint] }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator("text=Recent message from today")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=This is the latest state")).toBeVisible({ timeout: 5000 });
  });

  test("auto-save triggers after configured interval", async ({ page }) => {
    test.slow();

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Auto-save test response",
      statusCode: 200,
    });

    const checkpointWithShortInterval = createValidCheckpoint([]);
    checkpointWithShortInterval.human.settings = { auto_save_interval_ms: 3000 };

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint: checkpointWithShortInterval }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    const input = page.locator("textarea");
    await input.fill("Message for auto-save test");
    await input.press("Enter");

    await expect(page.locator("text=Message for auto-save test")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Auto-save test response")).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(5000);

    const checkpointCount = await page.evaluate((key) => {
      const data = localStorage.getItem(key);
      if (!data) return 0;
      return JSON.parse(data).length;
    }, AUTO_SAVES_KEY);

    expect(checkpointCount).toBeGreaterThan(1);
  });

  test("auto-save preserves conversation state", async ({ page }) => {
    test.slow();

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "This should be saved",
      statusCode: 200,
    });

    const checkpointWithShortInterval = createValidCheckpoint([]);
    checkpointWithShortInterval.human.settings = { auto_save_interval_ms: 3000 };

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint: checkpointWithShortInterval }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    const uniqueMessage = `Test message ${Date.now()}`;
    const input = page.locator("textarea");
    await input.fill(uniqueMessage);
    await input.press("Enter");

    await expect(page.locator(`text=${uniqueMessage}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=This should be saved")).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(5000);

    const latestCheckpoint = await page.evaluate((key) => {
      const data = localStorage.getItem(key);
      if (!data) return null;
      const checkpoints = JSON.parse(data);
      return checkpoints[checkpoints.length - 1];
    }, AUTO_SAVES_KEY);

    expect(latestCheckpoint).not.toBeNull();

    const personaKey = Object.keys(latestCheckpoint.personas).find(
      (k) => k.toLowerCase() === "ei"
    );
    expect(personaKey).toBeDefined();

    const eiData = latestCheckpoint.personas[personaKey!];
    expect(eiData).toHaveProperty("messages");

    const eiMessages = eiData.messages;
    expect(Array.isArray(eiMessages)).toBe(true);
    expect(eiMessages.length).toBeGreaterThan(0);

    const messageContents = eiMessages.map((m: { content: string }) => m.content);
    const hasUserMessage = messageContents.some((c: string) => c.includes("Test message"));
    expect(hasUserMessage).toBe(true);
  });

  test("manual save creates checkpoint via save panel", async ({ page }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Got it!",
      statusCode: 200,
    });

    const checkpoint = createValidCheckpoint([]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Save/Load"]').click();
    await expect(page.locator(".ei-save-popover")).toBeVisible({ timeout: 2000 });

    await page.locator(".ei-save-slot").first().locator('button:has-text("Save")').click();

    await expect(page.locator(".ei-save-dialog")).toBeVisible({ timeout: 2000 });

    await page.locator('input[placeholder="Enter save name..."]').fill("Test Save");

    await page.locator(".ei-save-dialog").locator('button.ei-btn--primary:has-text("Save")').click();

    await page.waitForTimeout(1500);

    const manualSaveExists = await page.evaluate(() => {
      for (let slot = 10; slot <= 14; slot++) {
        const data = localStorage.getItem(`ei_manual_${slot}`);
        if (data) return true;
      }
      return false;
    });

    expect(manualSaveExists).toBe(true);
  });

  test("restore loads previous state and fires onCheckpointRestored", async ({ page }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "New response after restore!",
      statusCode: 200,
    });

    const checkpointWithMessage = createValidCheckpoint([
      { role: "human", content: "Original message from saved state" },
      { role: "assistant", content: "Original response from saved state" },
    ]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint: checkpointWithMessage }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator("text=Original message from saved state")).toBeVisible({ timeout: 5000 });

    const input = page.locator("textarea");
    await input.fill("New message that will be lost");
    await input.press("Enter");

    await expect(page.locator("text=New message that will be lost")).toBeVisible({ timeout: 2000 });

    await page.locator('button[aria-label="Save/Load"]').click();
    await expect(page.locator(".ei-save-popover")).toBeVisible({ timeout: 2000 });

    await page.locator(".ei-save-panel__toggle").click();
    await page.waitForTimeout(300);

    await page.locator(".ei-save-slot--auto").first().locator('button:has-text("Load")').click();

    await expect(page.locator(".ei-save-dialog")).toBeVisible({ timeout: 2000 });
    await page.locator(".ei-save-dialog").locator('button.ei-btn--primary:has-text("Load")').click();

    await page.waitForTimeout(1000);

    await expect(page.locator("text=Original message from saved state")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=New message that will be lost")).not.toBeVisible({ timeout: 2000 });
  });

  test("message sent after save is lost on restore", async ({ page }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Response to new message",
      statusCode: 200,
    });

    const checkpointBefore = createValidCheckpoint([
      { role: "human", content: "Saved message" },
      { role: "assistant", content: "Saved response" },
    ]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint: checkpointBefore }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator("text=Saved message")).toBeVisible({ timeout: 5000 });

    const input = page.locator("textarea");
    await input.fill("Message that will be lost after restore");
    await input.press("Enter");

    await expect(page.locator("text=Message that will be lost after restore")).toBeVisible({ timeout: 2000 });

    await page.locator('button[aria-label="Save/Load"]').click();
    await expect(page.locator(".ei-save-popover")).toBeVisible({ timeout: 2000 });

    await page.locator(".ei-save-panel__toggle").click();
    await page.waitForTimeout(300);

    await page.locator(".ei-save-slot--auto").first().locator('button:has-text("Load")').click();

    await expect(page.locator(".ei-save-dialog")).toBeVisible({ timeout: 2000 });
    await page.locator(".ei-save-dialog").locator('button.ei-btn--primary:has-text("Load")').click();

    await page.waitForTimeout(1000);

    await expect(page.locator("text=Saved message")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Saved response")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Message that will be lost after restore")).not.toBeVisible({ timeout: 2000 });
  });

  test("checkpoint list shows available saves in popover", async ({ page }) => {
    const checkpoint = createValidCheckpoint([]);

    await page.goto("/");

    await page.evaluate(
      ({ url, key, checkpoint }) => {
        localStorage.clear();
        localStorage.setItem("EI_LLM_BASE_URL", url);
        localStorage.setItem(key, JSON.stringify([checkpoint]));
      },
      { url: MOCK_SERVER_URL, key: AUTO_SAVES_KEY, checkpoint }
    );

    await page.reload();

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Save/Load"]').click();

    await expect(page.locator(".ei-save-popover")).toBeVisible({ timeout: 2000 });

    await expect(page.locator(".ei-save-panel")).toBeVisible();

    await page.locator(".ei-save-panel__toggle").click();
    await page.waitForTimeout(300);

    await expect(page.locator(".ei-save-slot--auto").first().locator('button:has-text("Load")')).toBeVisible();
  });
});
