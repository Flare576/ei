/**
 * E2E tests for GroupChipEditor on HumanData cards (People, Topics, Facts).
 *
 * Covers:
 * - Group chips render on People cards (active group shown as toggled-on chip)
 * - Toggling a chip removes the group (chip becomes inactive)
 * - Adding a new group via the text input + Add button
 * - Group chips render on Topics cards
 * - Group chips render on Facts cards
 * - Items with no groups show an empty chip area (no crash)
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

async function openMyData(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
}

async function openPeopleTab(page: import("@playwright/test").Page) {
  await openMyData(page);
  await page.locator('button[role="tab"]').filter({ hasText: "People" }).click();
}

async function openTopicsTab(page: import("@playwright/test").Page) {
  await openMyData(page);
  await page.locator('button[role="tab"]').filter({ hasText: "Topics" }).click();
}

async function openFactsTab(page: import("@playwright/test").Page) {
  await openMyData(page);
  await page.locator('button[role="tab"]').filter({ hasText: "Facts" }).click();
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint builder
// ─────────────────────────────────────────────────────────────────────────────

function buildCheckpointWithGroups(mockServerUrl: string) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts: [
        {
          id: "fact-001",
          name: "Favorite Coffee",
          description: "Loves espresso",
          sentiment: 0.8,
          validated_date: ts,
          last_updated: ts,
          persona_groups: ["Work"],
        },
        {
          id: "fact-002",
          name: "Hobbies",
          description: "Hiking and reading",
          sentiment: 0.7,
          validated_date: ts,
          last_updated: ts,
          // no persona_groups — ungrouped item
        },
      ],
      traits: [],
      topics: [
        {
          id: "topic-001",
          name: "TypeScript",
          description: "Loves type safety",
          exposure_current: 0.8,
          exposure_desired: 0.6,
          sentiment: 0.9,
          last_updated: ts,
          persona_groups: ["Work", "Personal"],
        },
      ],
      people: [
        {
          id: "person-001",
          name: "Alice",
          relationship: "friend",
          description: "College friend who codes.",
          sentiment: 0.8,
          exposure_current: 0.4,
          exposure_desired: 0.6,
          last_updated: ts,
          identifiers: [{ type: "Full Name", value: "Alice", is_primary: true }],
          persona_groups: ["Personal"],
        },
      ],
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
          group_primary: "Work",
          groups_visible: ["Work", "Personal"],
          last_updated: ts,
          last_activity: ts,
          last_heartbeat: ts,
          heartbeat_delay_ms: 999999999,
        },
        messages: [
          {
            id: "msg-0",
            role: "assistant",
            verbal_response: "Hello! I'm Ei.",
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
// People tab — group chips
// ─────────────────────────────────────────────────────────────────────────────

test.describe("GroupChipEditor — People tab", () => {
  test("active group chip renders on person card", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    // "Personal" group should appear as an active chip on Alice's card
    const chip = page.locator(".ei-group-chip--active").filter({ hasText: "Personal" });
    await expect(chip).toBeVisible({ timeout: 3000 });
    await expect(chip).toContainText("✓");
  });

  test("known but inactive groups appear as toggleable chips", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    // "Work" is a known group (from persona) but Alice is only in "Personal"
    const inactiveChip = page.locator(".ei-group-chip--toggle:not(.ei-group-chip--active)").filter({ hasText: "Work" });
    await expect(inactiveChip).toBeVisible({ timeout: 3000 });
    await expect(inactiveChip).toContainText("○");
  });

  test("toggling an active chip deactivates the group", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    const activeChip = page.locator(".ei-group-chip--active").filter({ hasText: "Personal" });
    await expect(activeChip).toBeVisible({ timeout: 3000 });
    await activeChip.click();

    // Should now be inactive
    await expect(page.locator(".ei-group-chip--toggle:not(.ei-group-chip--active)").filter({ hasText: "Personal" })).toBeVisible({ timeout: 2000 });
  });

  test("typing a new group name and clicking Add creates a new active chip", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    const card = page.locator(".ei-data-card").first();
    await card.locator(".ei-group-chip--add").click();
    await expect(card.locator('input[placeholder="New group…"]')).toBeVisible({ timeout: 2000 });
    await card.locator('input[placeholder="New group…"]').fill("Family");
    await card.locator(".ei-group-chips__add-confirm").click();

    await expect(card.locator(".ei-group-chip--active").filter({ hasText: "Family" })).toBeVisible({ timeout: 2000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Topics tab — group chips
// ─────────────────────────────────────────────────────────────────────────────

test.describe("GroupChipEditor — Topics tab", () => {
  test("multi-group topic shows all active group chips", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openTopicsTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    // TypeScript topic belongs to both Work and Personal
    const workChip = page.locator(".ei-group-chip--active").filter({ hasText: "Work" });
    const personalChip = page.locator(".ei-group-chip--active").filter({ hasText: "Personal" });
    await expect(workChip).toBeVisible({ timeout: 3000 });
    await expect(personalChip).toBeVisible({ timeout: 3000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Facts tab — group chips
// ─────────────────────────────────────────────────────────────────────────────

test.describe("GroupChipEditor — Facts tab", () => {
  test("grouped fact shows active chip, ungrouped fact shows no active chips", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithGroups(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openFactsTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    const cards = page.locator(".ei-data-card");

    // Identify cards by description text (textarea .textContent) — not name (input value, invisible to hasText)
    const coffeeCard = cards.filter({ hasText: "Loves espresso" });
    await expect(coffeeCard.locator(".ei-group-chip--active").filter({ hasText: "Work" })).toBeVisible({ timeout: 3000 });

    const hobbiesCard = cards.filter({ hasText: "Hiking and reading" });
    await expect(hobbiesCard.locator(".ei-group-chip--active")).toHaveCount(0);
  });
});
