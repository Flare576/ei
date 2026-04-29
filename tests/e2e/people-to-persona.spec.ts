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

function buildCheckpointWithPerson(mockServerUrl: string) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [
        {
          id: "person-001",
          name: "TestPerson",
          relationship: "AI Companion",
          description: "A reliable collaborator who prefers methodical approaches and clear communication.",
          sentiment: 0.8,
          exposure_current: 0.5,
          exposure_desired: 0.7,
          last_updated: ts,
        },
      ],
      quotes: [],
      last_updated: ts,
      settings: {
        auto_save_interval_ms: 5000,
        default_model: "Mock LLM:mock-model",
        ceremony: {
          time: "09:00",
          last_ceremony: ts,
        },
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
          last_heartbeat: ts,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "msg-0",
            role: "assistant",
            content: "Hello! I'm Ei, your personal companion.",
            timestamp: ts,
          },
        ],
      },
    },
    queue: [],
    settings: {},
  };
}

function buildCheckpointWithPersonAndAlice(mockServerUrl: string) {
  const base = buildCheckpointWithPerson(mockServerUrl);
  return {
    ...base,
    personas: {
      ...base.personas,
      alice: {
        entity: {
          entity: "system",
          id: "alice",
          display_name: "Alice",
          aliases: ["Alice"],
          short_description: "A helpful persona",
          long_description: "Alice is a helpful AI persona.",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: base.timestamp,
        },
        messages: [],
      },
    },
  };
}

const PERSONA_GENERATION_RESPONSE = JSON.stringify({
  short_description: "A methodical collaborator",
  long_description: "TestPerson is a reliable collaborator who prefers methodical approaches.",
  traits: [
    { name: "Methodical", description: "Prefers systematic approaches", sentiment: 0.7, strength: 0.8 },
    { name: "Reliable", description: "Consistently dependable", sentiment: 0.8, strength: 0.9 },
    { name: "Clear", description: "Communicates with precision", sentiment: 0.6, strength: 0.7 },
  ],
  topics: [
    { name: "Collaboration", description: "Working effectively with others", sentiment: 0.8, exposure_current: 0.5, exposure_desired: 0.7 },
    { name: "Communication", description: "Clear and direct exchange", sentiment: 0.7, exposure_current: 0.4, exposure_desired: 0.6 },
    { name: "Process", description: "Methodical step-by-step workflows", sentiment: 0.6, exposure_current: 0.3, exposure_desired: 0.5 },
  ],
});

test.describe("People → Persona feature", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  test("New Persona from Person card opens modal in create mode", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    test.slow();

    await loadCheckpoint(page, buildCheckpointWithPerson(mockServerUrl));
    await blockEmbeddingCDN(page);

    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: PERSONA_GENERATION_RESPONSE,
      statusCode: 200,
    });

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Ei" })).toBeVisible({ timeout: 10000 });

    await page.locator('button[aria-label="Menu"]').click();
    await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
    await page.locator('button[role="tab"]').filter({ hasText: "People" }).click();

    const createBtn = page.locator('button[title="Create Persona from this person"]');
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await createBtn.click();

    await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 5000 });

    await expect(page.locator(".ei-creator-modal__title")).toContainText("Create New Persona");

    const descTextarea = page.locator('.ei-creator-modal__core .ei-textarea');
    await expect(descTextarea).toHaveValue(/methodical/i, { timeout: 3000 });

    await expect(
      page.locator(".ei-creator-modal__footer button:has-text('Create Persona')")
    ).toBeVisible({ timeout: 20000 });

    page.on("dialog", (dialog) => dialog.accept());
    await page.locator(".ei-creator-modal__footer button:has-text('Create Persona')").click();

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "TestPerson" })).toBeVisible({ timeout: 30000 });
  });

  test("Update Persona from Person card opens modal in update mode", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithPersonAndAlice(mockServerUrl));
    await blockEmbeddingCDN(page);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Ei" })).toBeVisible({ timeout: 10000 });

    await page.locator('button[aria-label="Menu"]').click();
    await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
    await page.locator('button[role="tab"]').filter({ hasText: "People" }).click();

    const updateBtn = page.locator('button[title="Update Persona from this person"]');
    await expect(updateBtn).toBeVisible({ timeout: 5000 });
    await updateBtn.click();

    await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 5000 });

    await expect(page.locator(".ei-creator-modal__title")).toContainText("Update Persona");

    await expect(page.locator(".ei-creator-modal select.ei-input")).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await expect(page.locator(".ei-creator-modal")).not.toBeVisible({ timeout: 3000 });
  });
});
