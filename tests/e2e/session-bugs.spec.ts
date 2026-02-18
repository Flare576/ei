/**
 * E2E tests for bugs discovered during E008 Entity Management UI epic.
 * Ticket: 0112 - E2E Session Bug Coverage
 * 
 * These tests use pre-seeded checkpoints to avoid the persona creation flow
 * which would add complexity and flakiness.
 */
import { test, expect } from "./fixtures.js";

const STATE_KEY = "ei_state";

async function openMyDataModal(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
}

interface Message {
  id: string;
  role: "human" | "system";
  content: string;
  timestamp: string;
  read?: boolean;
  context_status?: "default" | "always" | "never";
}

interface PersonaEntity {
  entity: "system";
  id: string;
  display_name: string;
  aliases: string[];
  short_description?: string;
  long_description?: string;
  traits: unknown[];
  topics: unknown[];
  facts: unknown[];
  people: unknown[];
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  is_static?: boolean;
  last_updated: string;
  last_activity: string;
}

interface PersonaData {
  entity: PersonaEntity;
  messages: Message[];
}

interface Checkpoint {
  version: number;
  timestamp: string;
  human: {
    entity: "human";
    facts: unknown[];
    traits: unknown[];
    topics: unknown[];
    people: unknown[];
    last_updated: string;
    last_activity: string;
    settings: { auto_save_interval_ms: number };
  };
  personas: Record<string, PersonaData>;
  queue: unknown[];
  settings: Record<string, unknown>;
}

function createCheckpoint(
  personaConfigs: Array<{
    id: string;
    display_name: string;
    short_description?: string;
    messages?: Array<{ role: "human" | "system"; content: string; read?: boolean }>;
    is_paused?: boolean;
    is_archived?: boolean;
  }>
): Checkpoint {
  const timestamp = new Date().toISOString();
  
  const personas: Record<string, PersonaData> = {};
  
  for (const config of personaConfigs) {
    const key = config.id;
    personas[key] = {
      entity: {
        entity: "system",
        id: config.id,
        display_name: config.display_name,
        aliases: [config.display_name],
        short_description: config.short_description ?? `${config.display_name} persona`,
        long_description: `${config.display_name} is a test persona for E2E testing.`,
        traits: [],
        topics: [],
        facts: [],
        people: [],
        is_paused: config.is_paused ?? false,
        is_archived: config.is_archived ?? false,
        last_updated: timestamp,
        last_activity: timestamp,
      },
      messages: (config.messages ?? []).map((m, i) => ({
        id: `msg-${key}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: new Date(Date.now() - (config.messages!.length - i) * 60000).toISOString(),
        read: m.read ?? (m.role === "human"), // Human messages are always "read"
        context_status: "default",
      })),
    };
  }
  
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
      settings: { auto_save_interval_ms: 30000 },
    },
    personas,
    queue: [],
    settings: {},
  };
}

async function loadCheckpoint(
  page: import("@playwright/test").Page,
  mockServerUrl: string,
  checkpoint: Checkpoint
): Promise<void> {
  await page.addInitScript(
    ({ url, key, data }) => {
      localStorage.clear();
      localStorage.setItem("EI_LLM_BASE_URL", url);
      localStorage.setItem(key, JSON.stringify(data));
    },
    { url: mockServerUrl, key: STATE_KEY, data: checkpoint }
  );
}

test.describe("Session Bug Coverage (0112)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  /**
   * Test Case 1: Archive Flow
   * Bug: Archived personas weren't filtered from the persona list
   */
  test("archive flow - persona disappears from list and can be unarchived", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    // Setup: Create checkpoint with TestPersona
    const checkpoint = createCheckpoint([
      { id: "ei", display_name: "Ei", short_description: "Your companion" },
      { id: "00", display_name: "TestPersona", short_description: "Test persona for archiving" },
    ]);

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Acknowledged",
      statusCode: 200,
    });

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Verify both personas visible
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "TestPersona" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Ei" })).toBeVisible();

    // Archive TestPersona: hover to reveal controls, click archive
    const testPersonaPill = page.locator(".ei-persona-pill").filter({ hasText: "TestPersona" });
    await testPersonaPill.hover();
    await page.locator(".ei-control-btn--archive").click();

    // Verify toast appears
    await expect(page.locator(".ei-toast")).toContainText("archived", { timeout: 3000 });

    // Verify TestPersona no longer in main list
    await expect(testPersonaPill).not.toBeVisible({ timeout: 3000 });

    // Open archived modal
    await page.locator(".ei-btn--archive").click();
    await expect(page.locator(".ei-archived-modal")).toBeVisible({ timeout: 2000 });

    // Verify TestPersona is in archived modal (use specific selector to avoid matching aliases)
    await expect(page.locator(".ei-archived-modal .ei-persona-card__name").filter({ hasText: "TestPersona" })).toBeVisible();

    // Unarchive TestPersona
    await page.locator(".ei-archived-modal .ei-persona-card").filter({ hasText: "TestPersona" }).locator("button:has-text('Unarchive')").click();

    // Close modal (click outside or close button)
    await page.locator(".ei-archived-modal").locator('button[aria-label="Close archived personas"]').click();

    // Verify TestPersona is back in main list
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "TestPersona" })).toBeVisible({ timeout: 5000 });
  });

  /**
   * Test Case 2: Unread Count Flow
   * Bug: unread_count was hardcoded to 0; race condition with IntersectionObserver
   * 
   * Badge updates when switching AWAY from a persona (markAllRead + getPersonaList refresh).
   */
  test("unread count - badge shows correct count and clears after viewing", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    const checkpoint = createCheckpoint([
      { 
        id: "00",
        display_name: "Alice", 
        short_description: "First persona",
        messages: [
          { role: "human", content: "Hello Alice" },
          { role: "system", content: "Hi there!", read: true },
        ],
      },
      { 
        id: "01",
        display_name: "Bob", 
        short_description: "Second persona",
        messages: [
          { role: "human", content: "Hello Bob" },
          { role: "system", content: "Hey! How are you?", read: false },
          { role: "system", content: "I have more to say!", read: false },
        ],
      },
    ]);

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Mock response from AI",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Alice" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Bob" })).toBeVisible();

    const bobPill = page.locator(".ei-persona-pill").filter({ hasText: "Bob" });
    const alicePill = page.locator(".ei-persona-pill").filter({ hasText: "Alice" });

    // VERIFY: Bob shows unread badge with count 2
    await expect(bobPill.locator(".ei-persona-pill__badge")).toBeVisible();
    await expect(bobPill.locator(".ei-persona-pill__badge")).toHaveText("2");

    // VERIFY: Alice has no badge (all messages read)
    await expect(alicePill.locator(".ei-persona-pill__badge")).not.toBeVisible();

    // Select Bob to view his messages
    await bobPill.click();
    await page.waitForTimeout(500);

    // Bob's messages are visible
    await expect(page.locator("text=Hey! How are you?")).toBeVisible({ timeout: 3000 });

    // Switch away from Bob - this triggers markAllMessagesRead(Bob) + getPersonaList()
    await alicePill.click();
    await page.waitForTimeout(500);

    // VERIFY: Bob's badge should now be gone (messages were marked read when we left)
    await expect(bobPill.locator(".ei-persona-pill__badge")).not.toBeVisible({ timeout: 3000 });
  });

  /**
   * Test Case 3: Bulk Context Status Update
   * Bug: React mutation bug caused only first 2 rows to visually update
   */
  test("bulk context status - all visible rows update to 'Never'", async ({
    page,
    mockServer: _mockServer,
    mockServerUrl,
  }) => {
    // Setup: Persona with many messages for bulk testing
    const messages: Array<{ role: "human" | "system"; content: string; read: boolean }> = [];
    for (let i = 0; i < 15; i++) {
      messages.push({ role: "human", content: `Human message ${i + 1}`, read: true });
      messages.push({ role: "system", content: `AI response ${i + 1}`, read: true });
    }

    const checkpoint = createCheckpoint([
      { 
        id: "01",
        display_name: "ContextTest", 
        short_description: "Persona with many messages",
        messages,
      },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Select ContextTest persona
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "ContextTest" })).toBeVisible({ timeout: 10000 });
    await page.locator(".ei-persona-pill").filter({ hasText: "ContextTest" }).click();

    // Hover to reveal edit button, click to open editor
    await page.locator(".ei-persona-pill").filter({ hasText: "ContextTest" }).hover();
    await page.locator(".ei-control-btn").filter({ hasText: "✏️" }).click();

    // Wait for editor to open
    await expect(page.locator("text=Edit Persona: ContextTest")).toBeVisible({ timeout: 5000 });

    // Navigate to Context tab (use role selector to avoid matching dropdown)
    await page.locator('button[role="tab"]').filter({ hasText: "Context" }).click();

    // Wait for context table to load
    await expect(page.locator(".ei-context-table")).toBeVisible({ timeout: 3000 });

    // Count visible rows before bulk action
    const initialRowCount = await page.locator(".ei-context-table__row").count();
    expect(initialRowCount).toBeGreaterThan(5); // Should have multiple rows

    // Select "Never" from bulk dropdown
    await page.locator(".ei-context-controls__select").selectOption("never");

    // Click Apply
    await page.locator("button:has-text('Apply')").click();

    // Wait for update
    await page.waitForTimeout(500);

    // Verify ALL visible status selects show "Never"
    const statusSelects = page.locator(".ei-context-status-select");
    const selectCount = await statusSelects.count();
    
    for (let i = 0; i < selectCount; i++) {
      const selectValue = await statusSelects.nth(i).inputValue();
      expect(selectValue).toBe("never");
    }
  });

  /**
   * Test Case 4: Persona Generation Live Update
   * Bug: Edit panel didn't refresh when onPersonaUpdated fired
   * 
   * This test verifies that when a persona is created with a description,
   * the LLM generates traits/topics and they appear in the edit panel.
   */
  test("persona generation - edit panel shows generated data after creation", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    test.slow(); // Allow extra time for LLM generation

    const checkpoint = createCheckpoint([
      { id: "ei", display_name: "Ei", short_description: "Your companion" },
    ]);

    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A wise philosopher who ponders life",
        long_description: "Sophia is a contemplative persona.",
        traits: [
          { name: "Contemplative", description: "Thinks deeply", sentiment: 0.5, strength: 0.8 },
          { name: "Articulate", description: "Expresses ideas clearly", sentiment: 0.6, strength: 0.7 },
          { name: "Curious", description: "Always seeking knowledge", sentiment: 0.7, strength: 0.9 },
        ],
        topics: [
          { name: "Philosophy", description: "Philosophical thought", sentiment: 0.8, exposure_current: 0.5, exposure_desired: 0.9 },
          { name: "Ethics", description: "Moral reasoning", sentiment: 0.6, exposure_current: 0.3, exposure_desired: 0.7 },
          { name: "Metaphysics", description: "Nature of reality", sentiment: 0.5, exposure_current: 0.2, exposure_desired: 0.6 },
        ],
      }),
      statusCode: 200,
    });

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Ei" })).toBeVisible({ timeout: 10000 });

    // Open creator modal
    await page.locator("button:has-text('+ New')").click();
    await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 3000 });

    // Fill in the form (use placeholder to distinguish from Group input)
    const nameInput = page.locator('.ei-creator-modal__core .ei-input[placeholder*="Primary Name"]');
    await nameInput.fill("Sophia");

    const descTextarea = page.locator('.ei-creator-modal__core .ei-textarea');
    await descTextarea.fill("A philosophical persona who loves discussions");

    // Handle any dialogs
    page.on("dialog", (dialog) => dialog.accept());

    // Click Create
    await page.locator(".ei-creator-modal__footer button:has-text('Create Persona')").click();

    // Wait for persona to appear in list
    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Sophia" })).toBeVisible({ timeout: 30000 });

    // Modal should close
    await expect(page.locator(".ei-creator-modal")).not.toBeVisible({ timeout: 5000 });

    const sophiaPill = page.locator(".ei-persona-pill").filter({ hasText: "Sophia" });
    
    await expect(sophiaPill.locator(".ei-persona-pill__desc")).toContainText(/philosopher|wise/i, { timeout: 30000 });

    // Open edit panel
    await sophiaPill.hover();
    await expect(sophiaPill.locator(".ei-persona-pill__controls")).toBeVisible({ timeout: 2000 });
    await sophiaPill.locator(".ei-control-btn").filter({ hasText: "✏️" }).click();

    await expect(page.locator("text=Edit Persona: Sophia")).toBeVisible({ timeout: 5000 });

    await page.locator('button[role="tab"]').filter({ hasText: "Identity" }).click();
    
    const modalContent = page.locator('.ei-tab-container__content');
    await modalContent.evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(300);
    
    await expect(page.locator('input.ei-data-card__name[value="Contemplative"]')).toBeVisible({ timeout: 10000 });

    await page.locator('button[role="tab"]').filter({ hasText: "Topics" }).click();
    await expect(page.locator('input.ei-data-card__name[value="Philosophy"]')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Test Case 5: Pause/Unpause Flow (stretch)
   */
  test("pause/unpause - persona shows paused indicator", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    const checkpoint = createCheckpoint([
      { "id": "ei", display_name: "Ei", short_description: "Your companion" },
      { "id": "01", display_name: "TestBot", short_description: "Test persona for pausing" },
    ]);

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "I will respond!",
      statusCode: 200,
    });

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "TestBot" })).toBeVisible({ timeout: 10000 });

    // Select TestBot
    const testBotPill = page.locator(".ei-persona-pill").filter({ hasText: "TestBot" });
    await testBotPill.click();

    // Hover to show controls, click pause button
    await testBotPill.hover();
    
    // Click pause button (⏸) - this should show pause options
    await page.locator(".ei-control-btn").filter({ hasText: "⏸" }).click();

    // Select "Forever" from pause options
    await page.locator(".ei-pause-options button:has-text('Forever')").click();

    // Verify paused indicator appears (avatar gets paused class)
    await expect(testBotPill.locator(".ei-persona-pill__avatar.paused")).toBeVisible({ timeout: 3000 });

    // Hover again and click unpause (▶)
    await testBotPill.hover();
    await page.locator(".ei-control-btn.active").filter({ hasText: "▶" }).click();

    // Verify paused indicator is gone
    await expect(testBotPill.locator(".ei-persona-pill__avatar.paused")).not.toBeVisible({ timeout: 3000 });
  });

  /**
   * Test Case 6: Human Editor Round-Trip (stretch)
   */
  test("human editor - fact modification persists after close and reopen", async ({
    page,
    mockServerUrl,
  }) => {
    const timestamp = new Date().toISOString();
    const checkpoint: Checkpoint = {
      version: 1,
      timestamp,
      human: {
        entity: "human",
        facts: [
          {
            id: "fact-1",
            name: "Favorite Color",
            description: "The user's favorite color is blue",
            sentiment: 0.5,
            last_updated: timestamp,
          },
        ],
        traits: [],
        topics: [],
        people: [],
        last_updated: timestamp,
        last_activity: timestamp,
        settings: { auto_save_interval_ms: 30000 },
      },
      personas: {
        ei: {
          entity: {
            id: "ei",
            display_name: "Ei",
            entity: "system",
            aliases: ["Ei"],
            short_description: "Your companion",
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
          messages: [],
        },
      },
      queue: [],
      settings: {},
    };

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").filter({ hasText: "Ei" })).toBeVisible({ timeout: 10000 });

    // Open My Data (Human editor) via hamburger menu
    await openMyDataModal(page);

    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });

    // Navigate to Facts tab
    await page.locator('button[role="tab"]').filter({ hasText: "Facts" }).click();

    await expect(page.locator("text=Favorite Color")).toBeVisible({ timeout: 3000 });

    // Find the fact card and modify its description
    const factCard = page.locator(".ei-data-card").filter({ hasText: "Favorite Color" });
    await expect(factCard).toBeVisible();
    
    const descriptionTextarea = factCard.locator('.ei-data-card__description');
    await descriptionTextarea.click();
    await descriptionTextarea.fill("The user's favorite color is now green");

    // Blur triggers auto-save (click outside the card)
    await page.locator('.ei-tab-container__content').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    // Close editor via X button
    await page.locator('.ei-tab-container button[aria-label="Close"]').click();
    await expect(page.locator("text=My Data")).not.toBeVisible({ timeout: 3000 });

    // Reopen Human editor
    await openMyDataModal(page);
    await expect(page.locator("text=My Data")).toBeVisible({ timeout: 5000 });

    await page.locator('button[role="tab"]').filter({ hasText: "Facts" }).click();

    // Verify modification persisted
    await expect(page.locator("text=favorite color is now green")).toBeVisible({ timeout: 3000 });
  });
});
