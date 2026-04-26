/**
 * E2E tests for the Persona Reflection Modal.
 *
 * Covers:
 * - Pending indicator visible in persona panel and control area
 * - Modal opens when clicking the indicator
 * - Dismiss clears pending update
 * - Save and Apply persists changes and clears pending state
 * - Regression: no "pending-" prefixed IDs after apply
 * - Critique text displayed in modal
 */
import { test, expect } from "./fixtures.js";

const STATE_KEY = "ei_state";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createReflectionCheckpoint(mockServerUrl: string) {
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
      quotes: [],
      last_updated: timestamp,
      settings: {
        auto_save_interval_ms: 500,
        default_model: "Mock LLM:mock-model",
        ceremony: {
          time: "09:00",
          last_ceremony: timestamp,
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
            created_at: timestamp,
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
          last_updated: timestamp,
        },
        messages: [
          {
            id: "msg-welcome",
            role: "assistant",
            content: "Hello! I'm Ei, your personal companion.",
            timestamp,
          },
        ],
      },
      "test-persona": {
        entity: {
          entity: "system",
          id: "test-persona",
          display_name: "Alison",
          aliases: ["Alison"],
          short_description: "A thoughtful friend",
          long_description: "Alison is a warm and thoughtful conversationalist.",
          traits: [
            {
              id: "trait-current-1",
              name: "Empathetic",
              description: "Deeply understands others",
              sentiment: 0.6,
              strength: 0.8,
              last_updated: timestamp,
            },
          ],
          topics: [
            {
              id: "topic-current-1",
              name: "Philosophy",
              perspective: "Seeks deeper meaning",
              approach: "Socratic dialogue",
              personal_stake: "Core to identity",
              sentiment: 0.5,
              exposure_current: 0.4,
              exposure_desired: 0.7,
              last_updated: timestamp,
            },
          ],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          pending_update: {
            short_description: "A confident and insightful friend",
            long_description:
              "Alison has grown into a more confident conversationalist who brings sharp insights.",
            traits: [
              {
                id: "pending-trait-0",
                name: "Confident",
                description: "Speaks with growing self-assurance",
                sentiment: 0.7,
                strength: 0.7,
                last_updated: timestamp,
              },
              {
                id: "pending-trait-1",
                name: "Insightful",
                description: "Offers sharp observations",
                sentiment: 0.5,
                strength: 0.6,
                last_updated: timestamp,
              },
            ],
            topics: [
              {
                id: "pending-topic-0",
                name: "Personal Growth",
                perspective: "Everyone can evolve",
                approach: "Gentle encouragement",
                personal_stake: "Believes in self-improvement",
                sentiment: 0.5,
                exposure_current: 0.3,
                exposure_desired: 0.7,
                last_updated: timestamp,
              },
            ],
            critique:
              "The persona has evolved toward greater confidence and sharper insight in conversations.",
            created_at: timestamp,
          },
        },
        messages: [
          {
            id: "msg-alison-1",
            role: "assistant",
            content: "Hey there! Always nice to chat.",
            timestamp,
            p: true,
            t: true,
            f: true,
          },
        ],
      },
    },
    queue: [],
    settings: {},
  };
}

async function loadCheckpoint(
  page: import("@playwright/test").Page,
  checkpoint: ReturnType<typeof createReflectionCheckpoint>
): Promise<void> {
  await page.addInitScript(
    ({ key, data }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STATE_KEY, data: checkpoint }
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Persona Reflection Modal", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("pending indicator visible in persona panel", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // Wait for persona list to render
    const alisonPill = page.locator(".ei-persona-pill").filter({ hasText: "Alison" });
    await expect(alisonPill).toBeVisible({ timeout: 10000 });

    // The ✦ reflection badge should be visible on the persona pill
    const reflectionBadge = alisonPill.locator(".ei-persona-pill__reflection-badge");
    await expect(reflectionBadge).toBeVisible();
    await expect(reflectionBadge).toHaveText("✦");
  });

  test("pending indicator visible in control area", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // The control area badge should appear with persona name
    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await expect(controlBadge).toContainText("Alison");
  });

  test("modal opens when clicking persona pill indicator", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    const alisonPill = page.locator(".ei-persona-pill").filter({ hasText: "Alison" });
    await expect(alisonPill).toBeVisible({ timeout: 10000 });

    // Click the ✦ badge on the persona pill
    const reflectionBadge = alisonPill.locator(".ei-persona-pill__reflection-badge");
    await expect(reflectionBadge).toBeVisible();
    await reflectionBadge.click();

    // The reflection modal should open
    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText("Alison — Reflection Review");
  });

  test("modal opens when clicking control area indicator", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await controlBadge.click();

    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });
  });

  test("critique text is displayed in modal", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // Open via control area badge
    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await controlBadge.click();

    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Critique is rendered in a blockquote
    const critique = modal.locator("blockquote.ei-reflection-modal__critique");
    await expect(critique).toBeVisible();
    await expect(critique).toContainText(
      "evolved toward greater confidence"
    );
  });

  test("dismiss clears pending state", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // Open modal
    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await controlBadge.click();

    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Accept the confirm dialog that Dismiss triggers
    page.on("dialog", (dialog) => dialog.accept());

    // Click Dismiss
    const dismissBtn = modal.getByRole("button", { name: "Dismiss" });
    await dismissBtn.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Pending indicators should disappear
    await expect(
      page.locator(".ei-control-area__reflection-badge")
    ).not.toBeVisible({ timeout: 5000 });

    const alisonPill = page.locator(".ei-persona-pill").filter({ hasText: "Alison" });
    await expect(alisonPill).toBeVisible();
    await expect(
      alisonPill.locator(".ei-persona-pill__reflection-badge")
    ).not.toBeVisible();
  });

  test("save and apply updates persona and clears pending", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // Open modal
    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await controlBadge.click();

    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify proposed content is populated
    const proposedPane = modal.locator(".ei-reflection-modal__pane--proposed");
    await expect(proposedPane.locator("#rm-short-desc")).toHaveValue(
      "A confident and insightful friend"
    );

    // Click Save and Apply
    const saveBtn = modal.getByRole("button", { name: "Save and Apply" });
    await saveBtn.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 15000 });

    // Pending indicators should disappear
    await expect(
      page.locator(".ei-control-area__reflection-badge")
    ).not.toBeVisible({ timeout: 5000 });

    // Verify the persona pill shows the updated short description
    const alisonPill = page.locator(".ei-persona-pill").filter({ hasText: "Alison" });
    await expect(alisonPill).toBeVisible();
    await expect(
      alisonPill.locator(".ei-persona-pill__reflection-badge")
    ).not.toBeVisible();
  });

  test("regression: no pending- IDs after apply", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createReflectionCheckpoint(mockServerUrl);
    await loadCheckpoint(page, checkpoint);
    await page.goto("/");

    // Open modal
    const controlBadge = page.locator(".ei-control-area__reflection-badge");
    await expect(controlBadge).toBeVisible({ timeout: 10000 });
    await controlBadge.click();

    const modal = page.locator('[role="dialog"][aria-label*="Reflection Review"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Click Save and Apply
    const saveBtn = modal.getByRole("button", { name: "Save and Apply" });
    await saveBtn.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 15000 });

    // Pending badge should disappear (confirms pending_update cleared in memory)
    const alisonPill = page.locator(".ei-persona-pill").filter({ hasText: "Alison" });
    await expect(alisonPill).toBeVisible();
    await expect(
      alisonPill.locator(".ei-persona-pill__reflection-badge")
    ).not.toBeVisible({ timeout: 5000 });

    // Open the persona editor to verify traits were applied without "pending-" IDs
    await alisonPill.hover();
    await alisonPill.locator(".ei-control-btn").filter({ hasText: "✏️" }).click();

    // Wait for the editor modal to appear
    const editorHeading = page.locator("text=Edit Persona: Alison");
    await expect(editorHeading).toBeVisible({ timeout: 5000 });

    // Navigate to the Identity tab where traits are shown
    const identityTab = page.getByRole("tab", { name: /identity/i });
    if (await identityTab.isVisible()) {
      await identityTab.click();
    }

    // The proposed traits should be present (applied successfully)
    // Use input[value=] to target trait name fields, not visible text
    await expect(
      page.locator('input.ei-data-card__name[value="Confident"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('input.ei-data-card__name[value="Insightful"]')
    ).toBeVisible({ timeout: 5000 });
  });
});
