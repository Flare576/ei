/**
 * E2E tests for "Merge Duplicates" feature on Topics and People tabs:
 * - Button visible on Topics/People, NOT on Facts
 * - Button disabled when rewrite_model not set, enabled when set
 * - Entering selection mode: search input, empty list, hint text, Cancel label
 * - Search filtering: matches name only, not description
 * - Selection + sticky footer: 1 card = no footer, 2+ = footer with merge button
 * - Confirming merge: exits selection mode, toast shown, LLM request queued
 * - Cancel exits selection mode, no LLM request
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

async function navigateToTab(page: import("@playwright/test").Page, tabName: string) {
  await page.locator('button[role="tab"]').filter({ hasText: tabName }).click();
}

/** Block CDN requests that would cause embedding computation to hang */
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

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint builders
// ─────────────────────────────────────────────────────────────────────────────

/** 3 topics, 2 people, NO rewrite_model */
function buildCheckpointWithoutRewriteModel(mockServerUrl: string) {
  const ts = new Date().toISOString();
  return {
    version: 1,
    timestamp: ts,
    human: {
      entity: "human",
      facts: [
        {
          id: "fact-001",
          name: "Favorite Color",
          description: "Blue",
          confidence: 0.9,
          sentiment: 0.5,
          validated_date: ts,
          last_updated: ts,
        },
      ],
      traits: [],
      topics: [
        {
          id: "topic-001",
          name: "Board Games",
          description: "Loves playing board games on weekends",
          sentiment: 0.8,
          exposure_current: 0.5,
          exposure_desired: 0.7,
          last_updated: ts,
        },
        {
          id: "topic-002",
          name: "Board Games (old)",
          description: "Old entry about tabletop gaming hobby",
          sentiment: 0.7,
          exposure_current: 0.3,
          exposure_desired: 0.5,
          last_updated: ts,
        },
        {
          id: "topic-003",
          name: "Cooking",
          description: "Enjoys making Italian food",
          sentiment: 0.6,
          exposure_current: 0.4,
          exposure_desired: 0.6,
          last_updated: ts,
        },
      ],
      people: [
        {
          id: "person-001",
          name: "Alice",
          relationship: "friend",
          description: "College friend who likes hiking",
          sentiment: 0.9,
          exposure_current: 0.4,
          exposure_desired: 0.6,
          last_updated: ts,
        },
        {
          id: "person-002",
          name: "Alice (duplicate)",
          relationship: "friend",
          description: "Hiking buddy from university",
          sentiment: 0.8,
          exposure_current: 0.3,
          exposure_desired: 0.5,
          last_updated: ts,
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
          last_updated: ts,
          last_activity: ts,
        },
        messages: [
          {
            id: "msg-0",
            role: "assistant",
            verbal_response: "Hello! I'm Ei, your personal companion.",
            timestamp: ts,
          },
        ],
      },
    },
    queue: [],
    settings: {},
  };
}

/** Same data, WITH rewrite_model set */
function buildCheckpointWithRewriteModel(mockServerUrl: string) {
  const base = buildCheckpointWithoutRewriteModel(mockServerUrl);
  base.human.settings = {
    ...base.human.settings,
    rewrite_model: "Mock LLM:mock-model",
  } as typeof base.human.settings & { rewrite_model: string };
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Dedupe UI — Merge Duplicates", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  // ── 1. Button visibility ─────────────────────────────────────────────────

  test("Merge Duplicates button visible on Topics tab", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithoutRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await expect(
      page.locator("button").filter({ hasText: "Merge Duplicates" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("Merge Duplicates button visible on People tab", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithoutRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "People");

    await expect(
      page.locator("button").filter({ hasText: "Merge Duplicates" })
    ).toBeVisible({ timeout: 5000 });
  });

  test("Merge Duplicates button does NOT appear on Facts tab", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithoutRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Facts");

    // Wait for facts content to load
    await expect(page.locator(".ei-data-card").first()).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.locator("button").filter({ hasText: "Merge Duplicates" })
    ).not.toBeVisible();
  });

  // ── 2. Disabled / enabled state ──────────────────────────────────────────

  test("button is disabled when rewrite_model is not set", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithoutRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    const mergeBtn = page.locator("button").filter({ hasText: "Merge Duplicates" });
    await expect(mergeBtn).toBeVisible({ timeout: 5000 });
    await expect(mergeBtn).toBeDisabled();
  });

  test("button is enabled when rewrite_model is set", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    const mergeBtn = page.locator("button").filter({ hasText: "Merge Duplicates" });
    await expect(mergeBtn).toBeVisible({ timeout: 5000 });
    await expect(mergeBtn).toBeEnabled();
  });

  // ── 3. Entering selection mode ────────────────────────────────────────────

  test("clicking Merge Duplicates enters selection mode with search input and hint", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    // Click the button
    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();

    // Search input should appear and be auto-focused
    const searchInput = page.locator('.ei-search-input[placeholder*="duplicates"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
    await expect(searchInput).toBeFocused();

    // Hint text visible
    await expect(page.locator(".ei-dedupe-empty-hint")).toContainText(
      "Search for a name to find duplicates"
    );

    // Card list should be empty (no cards visible before typing)
    await expect(page.locator(".ei-data-card")).not.toBeVisible();

    // Button label should now say "Cancel"
    await expect(
      page.locator("button").filter({ hasText: "Cancel" })
    ).toBeVisible();
  });

  // ── 4. Search filtering (name-only) ──────────────────────────────────────

  test("typing a matching name shows matching cards", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // Type "Board" — should match "Board Games" and "Board Games (old)"
    await searchInput.fill("Board");

    // Wait for matching cards to appear — use selection wrapper since we're in selection mode
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(2, {
      timeout: 5000,
    });
  });

  test("typing a description word NOT in any name shows no results", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // "Italian" is in the Cooking description but NOT in any topic name
    await searchInput.fill("Italian");

    // No selection wrappers should appear
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(0);
  });

  // ── 5. Selection and sticky footer ────────────────────────────────────────

  test("selecting 1 card does not show sticky footer merge button", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    await searchInput.fill("Board");
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(2, {
      timeout: 5000,
    });

    // Click the first checkbox
    await page.locator(".ei-selection-checkbox").first().click();

    // Sticky footer with merge button should NOT be visible
    await expect(page.locator(".ei-sticky-footer")).not.toBeVisible();
  });

  test("selecting 2 cards shows sticky footer with merge count", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    await searchInput.fill("Board");
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(2, {
      timeout: 5000,
    });

    // Select both checkboxes
    await page.locator(".ei-selection-checkbox").nth(0).click();
    await page.locator(".ei-selection-checkbox").nth(1).click();

    // Sticky footer should appear with correct text
    const footer = page.locator(".ei-sticky-footer");
    await expect(footer).toBeVisible({ timeout: 3000 });
    await expect(
      footer.locator("button").filter({ hasText: "Merge 2 into one" })
    ).toBeVisible();
  });

  // ── 6. Confirming merge ───────────────────────────────────────────────────

  test("confirming merge exits selection mode and shows toast", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    await searchInput.fill("Board");
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(2, {
      timeout: 5000,
    });

    // Select both
    await page.locator(".ei-selection-checkbox").nth(0).click();
    await page.locator(".ei-selection-checkbox").nth(1).click();

    const footer = page.locator(".ei-sticky-footer");
    await expect(footer).toBeVisible({ timeout: 3000 });

    // Clear request history right before merge to isolate the dedupe request
    mockServer.clearRequestHistory();

    // Click merge button
    await footer.locator("button").filter({ hasText: "Merge 2 into one" }).click();

    // Selection mode should exit — search input gone
    await expect(page.locator('.ei-search-input[placeholder*="duplicates"]')).not.toBeVisible({ timeout: 5000 });

    // Toast should appear with merge info
    await expect(page.locator(".ei-toast")).toContainText("Merging", {
      timeout: 5000,
    });
    await expect(page.locator(".ei-toast")).toContainText("Opus");

    // "Merge Duplicates" button should be back (not "Cancel")
    await expect(
      page.locator("button").filter({ hasText: "Merge Duplicates" })
    ).toBeVisible();
  });

  test("confirming merge sends a dedup LLM request", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    const searchInput = page.locator(".ei-search-input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    await searchInput.fill("Board");
    await expect(page.locator(".ei-selection-wrapper")).toHaveCount(2, {
      timeout: 5000,
    });

    await page.locator(".ei-selection-checkbox").nth(0).click();
    await page.locator(".ei-selection-checkbox").nth(1).click();

    const footer = page.locator(".ei-sticky-footer");
    await expect(footer).toBeVisible({ timeout: 3000 });

    mockServer.clearRequestHistory();

    await footer.locator("button").filter({ hasText: "Merge 2 into one" }).click();

    // Wait for the LLM request to be queued and sent
    // The system queues it, then the queue processor picks it up and calls the mock server
    await expect(async () => {
      const requests = mockServer.getRequestHistory();
      const dedupRequest = requests.find((req) => {
        const body = req.body as {
          messages?: Array<{ role: string; content: string }>;
        };
        const systemMsg = body?.messages?.find(
          (m) => m.role === "system"
        )?.content?.toLowerCase();
        return (
          systemMsg &&
          (systemMsg.includes("merging duplicate") ||
            systemMsg.includes("duplicate"))
        );
      });
      expect(dedupRequest).toBeTruthy();
    }).toPass({ timeout: 15000 });
  });

  // ── 7. Cancel ─────────────────────────────────────────────────────────────

  test("clicking Cancel exits selection mode with no LLM request", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithRewriteModel(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });
    await navigateToTab(page, "Topics");

    // Enter selection mode
    await page.locator("button").filter({ hasText: "Merge Duplicates" }).click();
    await expect(page.locator('.ei-search-input[placeholder*="duplicates"]')).toBeVisible({ timeout: 3000 });

    mockServer.clearRequestHistory();

    // Click Cancel
    await page.locator("button").filter({ hasText: "Cancel" }).click();

    // Selection mode should exit
    await expect(page.locator('.ei-search-input[placeholder*="duplicates"]')).not.toBeVisible();

    // "Merge Duplicates" button should be back
    await expect(
      page.locator("button").filter({ hasText: "Merge Duplicates" })
    ).toBeVisible();

    // No dedupe LLM request should have been made
    const requests = mockServer.getRequestHistory();
    const dedupRequest = requests.find((req) => {
      const body = req.body as {
        messages?: Array<{ role: string; content: string }>;
      };
      const systemMsg = body?.messages?.find(
        (m) => m.role === "system"
      )?.content?.toLowerCase();
      return (
        systemMsg &&
        (systemMsg.includes("merging duplicate") ||
          systemMsg.includes("duplicate"))
      );
    });
    expect(dedupRequest).toBeUndefined();
  });
});
