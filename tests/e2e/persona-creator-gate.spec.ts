/**
 * E2E tests for PersonaCreatorModal gates:
 * - "Create Persona" submit is blocked (alert) when long_description is empty
 * - "Create Persona" submit proceeds when both name and description are filled
 *
 * E2E tests for DataItemCard learned_on footer display (Topics tab — FactCard omits learned_on):
 * - Topic with learned_on shows "Learned on <date>" in the card footer
 * - Topic without learned_on shows no "Learned" text in the footer
 * - Topic with learned_by + learned_on shows "Learned By <name> on <date>"
 */
import { test, expect } from "./fixtures.js";

const STATE_KEY = "ei_state";

async function blockEmbeddingCDN(page: import("@playwright/test").Page) {
  await page.route("**/jsdelivr.net/**", (route) => route.abort());
  await page.route("**/huggingface.co/**", (route) => route.abort());
}

async function loadCheckpoint(
  page: import("@playwright/test").Page,
  data: object
) {
  await page.addInitScript(
    ({ key, data }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STATE_KEY, data }
  );
}

function buildBaseCheckpoint(mockServerUrl: string, facts: object[] = [], topics: object[] = []) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts,
      traits: [],
      topics,
      people: [],
      quotes: [],
      last_updated: ts,
      settings: {
        auto_save_interval_ms: 5000,
        default_model: "Mock LLM:mock-model",
        accounts: [
          {
            id: "mock-llm-account",
            name: "Mock LLM",
            type: "llm",
            url: mockServerUrl,
            api_key: "",
            default_model: "mock-model",
            enabled: true,
            created_at: ts,
          },
        ],
      },
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
          last_updated: ts,
        },
        messages: [
          {
            id: "msg-0",
            role: "assistant",
            content: "Hello! I'm Ei.",
            timestamp: ts,
          },
        ],
      },
    },
    queue: [],
    settings: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PersonaCreatorModal — long_description gate
// ─────────────────────────────────────────────────────────────────────────────

test.describe("PersonaCreatorModal — long_description gate", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  test("Create Persona is blocked by alert when description is empty", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildBaseCheckpoint(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator("button").filter({ hasText: "+ New" }).click();
    await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 5000 });

    // Fill name but leave description empty
    await page.locator('.ei-creator-modal .ei-input').first().fill("TestBot");

    // With description empty, canAutoGenerate is false → "Create Persona" button is shown (not "Finish Persona Definition")
    const createBtn = page.locator(".ei-creator-modal__footer button").filter({ hasText: "Create Persona" });
    await expect(createBtn).toBeVisible({ timeout: 3000 });

    // Clicking it should trigger a browser alert, not submit
    let alertMessage = "";
    page.once("dialog", async (dialog) => {
      alertMessage = dialog.message();
      await dialog.dismiss();
    });

    await createBtn.click();

    // Alert should have fired with the description-required message
    await expect.poll(() => alertMessage, { timeout: 3000 }).toMatch(/description/i);

    // Modal should still be open — no persona was created
    await expect(page.locator(".ei-creator-modal")).toBeVisible();
    await expect(page.locator(".ei-persona-pill")).toHaveCount(1); // only Ei
  });

  test("Create Persona proceeds when both name and description are filled", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildBaseCheckpoint(mockServerUrl));
    await blockEmbeddingCDN(page);

    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A test bot",
        long_description: "TestBot is a persona created during E2E testing.",
        traits: [
          { name: "Reliable", description: "Always on time", sentiment: 0.8, strength: 0.9 },
          { name: "Precise", description: "Accurate and exact", sentiment: 0.7, strength: 0.8 },
          { name: "Calm", description: "Never panics", sentiment: 0.6, strength: 0.7 },
        ],
        topics: [
          { name: "Testing", description: "Enjoys thorough testing", sentiment: 0.7, exposure_current: 0.5, exposure_desired: 0.8 },
          { name: "Automation", description: "Loves automated pipelines", sentiment: 0.8, exposure_current: 0.4, exposure_desired: 0.7 },
          { name: "Quality", description: "Committed to quality", sentiment: 0.9, exposure_current: 0.3, exposure_desired: 0.6 },
        ],
      }),
      statusCode: 200,
    });

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator("button").filter({ hasText: "+ New" }).click();
    await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 5000 });

    await page.locator('.ei-creator-modal .ei-input').first().fill("TestBot");
    await page.locator('.ei-creator-modal .ei-textarea').fill("A reliable test automation bot.");

    // With both filled and generatePersonaPreview available, "Finish Persona Definition" replaces "Create Persona"
    const finishBtn = page.locator(".ei-creator-modal__footer button").filter({ hasText: "Finish Persona Definition" });
    await expect(finishBtn).toBeVisible({ timeout: 3000 });
    await expect(finishBtn).toBeEnabled();

    page.on("dialog", (dialog) => dialog.accept());
    await finishBtn.click();

    // After generation completes, generationComplete=true → button label switches to "Create Persona"
    const createBtn = page.locator(".ei-creator-modal__footer button").filter({ hasText: "Create Persona" });
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click();

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "TestBot" })).toBeVisible({ timeout: 15000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DataItemCard — learned_on footer display
// ─────────────────────────────────────────────────────────────────────────────
// Topics use DataItemCard which renders learned_on. FactCard does not — it only
// shows learned_by. Tests use the Topics tab accordingly.

test.describe("DataItemCard — learned_on footer", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  test("topic with learned_on shows 'Learned on' in the card footer", async ({
    page,
    mockServerUrl,
  }) => {
    const learnedDate = "2025-11-15T10:30:00.000Z";
    const topics = [
      {
        id: "topic-001",
        name: "TypeScript",
        description: "Loves TypeScript for its type safety",
        sentiment: 0.9,
        exposure_current: 0.6,
        exposure_desired: 0.8,
        learned_on: learnedDate,
        last_updated: learnedDate,
      },
    ];

    await loadCheckpoint(page, buildBaseCheckpoint(mockServerUrl, [], topics));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Menu"]').click();
    await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
    await page.locator('button[role="tab"]').filter({ hasText: "Topics" }).click();

    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    const footer = page.locator(".ei-data-card__footer-row").first();
    await expect(footer).toBeVisible({ timeout: 3000 });
    await expect(footer).toContainText("Learned on");
  });

  test("topic without learned_on in raw state gets backfilled on startup and still shows 'Learned on'", async ({
    page,
    mockServerUrl,
  }) => {
    const ts = "2025-06-01T12:00:00.000Z";
    const topics = [
      {
        id: "topic-002",
        name: "Vim",
        description: "Uses Vim for editing",
        sentiment: 0.7,
        exposure_current: 0.4,
        exposure_desired: 0.5,
        last_updated: ts,
        // intentionally no learned_on — processor backfills it from last_updated on startup
      },
    ];

    await loadCheckpoint(page, buildBaseCheckpoint(mockServerUrl, [], topics));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Menu"]').click();
    await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
    await page.locator('button[role="tab"]').filter({ hasText: "Topics" }).click();

    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    // Backfill stamped learned_on = last_updated, so the footer row should appear
    const learnedRow = page.locator(".ei-data-card__footer-row").filter({ hasText: "Learned" });
    await expect(learnedRow).toBeVisible({ timeout: 3000 });
    await expect(learnedRow).toContainText("Learned on");
  });

  test("topic with learned_by and learned_on shows 'Learned By <name> on <date>'", async ({
    page,
    mockServerUrl,
  }) => {
    const learnedDate = "2025-12-01T08:00:00.000Z";
    const topics = [
      {
        id: "topic-003",
        name: "Open Source",
        description: "Contributes to open source projects",
        sentiment: 0.85,
        exposure_current: 0.5,
        exposure_desired: 0.7,
        learned_by: "ei",
        learned_on: learnedDate,
        last_updated: learnedDate,
      },
    ];

    await loadCheckpoint(page, buildBaseCheckpoint(mockServerUrl, [], topics));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await page.locator('button[aria-label="Menu"]').click();
    await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
    await page.locator('button[role="tab"]').filter({ hasText: "Topics" }).click();

    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    const footer = page.locator(".ei-data-card__footer-row").first();
    await expect(footer).toContainText("Learned By");
    await expect(footer).toContainText("on");
  });
});
