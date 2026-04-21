/**
 * E2E tests for Fact UI changes introduced in Task 8 (web) / Task 9 (TUI):
 * - Built-in facts are seeded on fresh state
 * - No validation checkbox on fact cards (ValidationLevel removed)
 * - Delete button hidden for built-in facts
 * - Delete button shown for custom (non-built-in) facts
 * - Editing a fact description auto-sets validated_date and triggers save
 */
import { test, expect } from "./fixtures.js";

const STATE_KEY = "ei_state";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function openMyDataModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
}

async function navigateToFactsTab(page: import("@playwright/test").Page) {
  await page.locator('button[role="tab"]').filter({ hasText: "Facts" }).click();
}

/** Block CDN requests that would cause embedding computation to hang */
async function blockEmbeddingCDN(page: import("@playwright/test").Page) {
  await page.route("**/jsdelivr.net/**", (route) => route.abort());
  await page.route("**/huggingface.co/**", (route) => route.abort());
}

/** Seed a checkpoint that has ONLY a custom (non-built-in) fact */
function buildCheckpointWithCustomFact(mockServerUrl: string) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts: [
        {
          id: "custom-fact-001",
          name: "Favorite Coffee",
          description: "Loves espresso",
          confidence: 0.9,
          sentiment: 0.8,
          validated_date: ts,
          last_updated: ts,
        },
      ],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: ts,
      last_activity: ts,
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
          last_activity: ts,
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

/** Seed a checkpoint that already has "Full Name" (built-in) as a fact */
function buildCheckpointWithBuiltInFact(mockServerUrl: string) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts: [
        {
          id: "builtin-full-name",
          name: "Full Name",
          description: "John Doe",
          confidence: 0.9,
          sentiment: 0,
          validated_date: ts,
          last_updated: ts,
        },
      ],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: ts,
      last_activity: ts,
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
          last_activity: ts,
        },
        messages: [],
      },
    },
    queue: [],
    settings: {},
  };
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Facts UI — Built-in Facts", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  // ── Test 1: Built-in facts are seeded on fresh state ─────────────────────
  test("built-in facts display on fresh state (seeded by Processor)", async ({
    page,
    mockServerUrl,
  }) => {
    // Fresh state: human.facts = [] → Processor.seedBuiltinFacts() creates 25 built-ins
    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      {
        key: STATE_KEY,
        data: {
          version: 1,
          timestamp: new Date().toISOString(),
          human: {
            entity: "human",
            facts: [],
            traits: [],
            topics: [],
            people: [],
            quotes: [],
            last_updated: new Date().toISOString(),
            last_activity: new Date().toISOString(),
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
                  created_at: new Date().toISOString(),
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
                last_updated: new Date().toISOString(),
                last_activity: new Date().toISOString(),
              },
              messages: [],
            },
          },
          queue: [],
          settings: {},
        },
      }
    );
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToFactsTab(page);

    // Processor.seedBuiltinFacts() runs on start() → "Full Name" should appear
    await expect(
      page.locator('input.ei-data-card__name[value="Full Name"]')
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('input.ei-data-card__name[value="Birthday"]')
    ).toBeVisible({ timeout: 5000 });
  });

  // ── Test 2: No validation checkbox on any fact card ───────────────────────
  test("no validation checkbox on any fact card", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithBuiltInFact(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToFactsTab(page);

    // Wait for at least one fact card to appear
    await expect(page.locator(".ei-data-card").first()).toBeVisible({
      timeout: 10000,
    });

    // ValidationLevel checkbox must NOT exist anywhere on the page
    await expect(page.locator(".ei-validation-checkbox")).not.toBeVisible();
    await expect(page.locator('input[type="checkbox"]').first()).not.toBeVisible();
  });

  // ── Test 3: Delete button hidden for built-in facts ───────────────────────
  test("delete button hidden for built-in facts", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithBuiltInFact(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToFactsTab(page);

    // Find the "Full Name" card (built-in)
    const fullNameCard = page
      .locator(".ei-data-card")
      .filter({ has: page.locator('input[value="Full Name"]') });
    await expect(fullNameCard).toBeVisible({ timeout: 10000 });

    // Delete button must NOT be rendered for built-in facts
    await expect(
      fullNameCard.locator(".ei-control-btn--danger")
    ).not.toBeVisible();
  });

  // ── Test 4: Delete button shown for custom facts ──────────────────────────
  test("delete button shown for custom (non-built-in) facts", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithCustomFact(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToFactsTab(page);

    // "Favorite Coffee" is not in BUILT_IN_FACT_NAMES → delete button should appear
    const coffeeCard = page
      .locator(".ei-data-card")
      .filter({ has: page.locator('input[value="Favorite Coffee"]') });
    await expect(coffeeCard).toBeVisible({ timeout: 10000 });

    // Delete button MUST be visible for custom facts
    await expect(
      coffeeCard.locator(".ei-control-btn--danger")
    ).toBeVisible();
  });

  // ── Test 5: Editing description triggers save (validated_date auto-set) ───
  test("editing fact description auto-sets validated_date and triggers save", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithBuiltInFact(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToFactsTab(page);

    const fullNameCard = page
      .locator(".ei-data-card")
      .filter({ has: page.locator('input[value="Full Name"]') });
    await expect(fullNameCard).toBeVisible({ timeout: 10000 });

    // Edit description → handleDescriptionChange fires onChange('validated_date', ...)
    const descriptionTextarea = fullNameCard.locator(".ei-data-card__description");
    await descriptionTextarea.click();
    await descriptionTextarea.fill("John Q. Doe (updated)");

    // Card should become dirty
    await expect(fullNameCard).toHaveClass(/ei-data-card--dirty/, {
      timeout: 3000,
    });

    // Blur the card → onSave fires
    await page.locator(".ei-tab-container__content").click({ position: { x: 10, y: 10 } });

    // Dirty flag clears once save (upsertFact) completes
    await expect(fullNameCard).not.toHaveClass(/ei-data-card--dirty/, {
      timeout: 8000,
    });
  });
});
