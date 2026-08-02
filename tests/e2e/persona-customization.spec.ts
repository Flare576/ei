/**
 * E2E tests for Persona Customization UI.
 *
 * Covers:
 * - Emoji avatar picker: renders on Identity tab, toggles open/closed
 * - Emoji input: typing sets avatar value and persists after close/reopen
 * - Image tab: renders file input when "Image" tab is selected
 * - Preferred theme selector: renders on Settings tab with all built-in options and persists
 * - Show Timestamps checkbox: persists the enabled setting after close/reopen
 */
import { test, expect } from "./fixtures.js";

const STATE_KEY = "ei_state";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  is_archived: boolean;
  last_updated: string;
  include_message_timestamps?: boolean;
  external_reflection_only?: boolean;
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
    settings: {
      auto_save_interval_ms: number;
      default_model: string;
      accounts: Array<{
        id: string;
        name: string;
        type: string;
        url: string;
        api_key: string;
        default_model: string;
        enabled: boolean;
        created_at: string;
      }>;
    };
  };
  personas: Record<string, { entity: PersonaEntity; messages: unknown[] }>;
  queue: unknown[];
  settings: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createCheckpoint(
  mockServerUrl: string,
  personaConfigs: Array<{
    id: string;
    display_name: string;
    short_description?: string;
    avatar_emoji?: string;
    preferred_theme?: string;
    include_message_timestamps?: boolean;
    external_reflection_only?: boolean;
  }>
): Checkpoint {
  const timestamp = new Date().toISOString();

  const personas: Record<string, { entity: PersonaEntity; messages: unknown[] }> = {};

  for (const config of personaConfigs) {
    personas[config.id] = {
      entity: {
        entity: "system",
        id: config.id,
        display_name: config.display_name,
        aliases: [config.display_name],
        short_description: config.short_description ?? `${config.display_name} test persona`,
        long_description: `${config.display_name} is a test persona for E2E testing.`,
        traits: [],
        topics: [],
        facts: [],
        people: [],
        is_paused: false,
        is_archived: false,
        last_updated: timestamp,
        // Spread extra optional fields (avatar_emoji, preferred_theme)
        ...(config.avatar_emoji !== undefined ? { avatar_emoji: config.avatar_emoji } : {}),
        ...(config.preferred_theme !== undefined ? { preferred_theme: config.preferred_theme } : {}),
        ...(config.include_message_timestamps !== undefined
          ? { include_message_timestamps: config.include_message_timestamps }
          : {}),
        ...(config.external_reflection_only !== undefined
          ? { external_reflection_only: config.external_reflection_only }
          : {}),
      } as PersonaEntity,
      messages: [],
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
      settings: {
        auto_save_interval_ms: 30000,
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
            created_at: timestamp,
          },
        ],
      },
    },
    personas,
    queue: [],
    settings: {},
  };
}

async function loadCheckpoint(
  page: import("@playwright/test").Page,
  _mockServerUrl: string,
  checkpoint: Checkpoint
): Promise<void> {
  await page.addInitScript(
    ({ key, data }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STATE_KEY, data: checkpoint }
  );
}

/**
 * Open the persona editor for the first pill matching `name`.
 * Waits for the "Edit Persona: NAME" heading to confirm it opened.
 */
async function openEditorForPersona(
  page: import("@playwright/test").Page,
  name: string
): Promise<void> {
  const pill = page.locator(".ei-persona-pill").filter({ hasText: name });
  await expect(pill).toBeVisible({ timeout: 10000 });
  await pill.hover();
  await pill.locator(".ei-control-btn").filter({ hasText: "✏️" }).click();
  await expect(page.locator(`text=Edit Persona: ${name}`)).toBeVisible({ timeout: 5000 });
}

/**
 * Close the editor via the ✕ button.
 * Registers a dialog handler first to auto-accept any "unsaved changes" confirm.
 */
async function closeEditor(page: import("@playwright/test").Page): Promise<void> {
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator('.ei-tab-container button[aria-label="Close"]').click();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Persona Customization UI", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  /**
   * Test 1: Emoji avatar picker renders on Identity tab and toggles open/closed.
   */
  test("emoji avatar picker renders on Identity tab and toggles open/closed", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createCheckpoint(mockServerUrl, [
      { id: "test-01", display_name: "TestBot", short_description: "Test persona" },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor
    await openEditorForPersona(page, "TestBot");

    // Navigate to Identity tab
    await page.locator('button[role="tab"]').filter({ hasText: "Identity" }).click();

    // Scroll to top — avatar section is at the top
    const modalContent = page.locator(".ei-tab-container__content");
    await modalContent.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });

    // Assert Avatar label is visible
    await expect(page.locator('label').filter({ hasText: "Avatar" })).toBeVisible({ timeout: 5000 });

    // Assert Emoji tab button is active (has ei-btn--primary)
    const emojiBtn = page.locator(".ei-avatar-tabs button").filter({ hasText: "Emoji" });
    await expect(emojiBtn).toBeVisible();
    await expect(emojiBtn).toHaveClass(/ei-btn--primary/);

    // Assert Image tab button is visible
    await expect(page.locator(".ei-avatar-tabs button").filter({ hasText: "Image" })).toBeVisible();

    // Assert emoji text input is visible
    const emojiInput = page.locator('input.ei-input[placeholder*="emoji"]');
    await expect(emojiInput).toBeVisible();

    // Assert Pick Emoji button is visible
    const pickEmojiBtn = page.locator('button').filter({ hasText: "Pick Emoji" });
    await expect(pickEmojiBtn).toBeVisible();

    // Click Pick Emoji — picker should appear
    await pickEmojiBtn.click();
    // emoji-picker-react renders as <em-emoji-picker> or .EmojiPickerReact
    const emojiPicker = page.locator("em-emoji-picker, .EmojiPickerReact");
    await expect(emojiPicker).toBeVisible({ timeout: 5000 });

    // Close picker by clicking outside it (clicking the button again re-opens because
    // the outside-click handler fires on mousedown before the button's click toggles it back)
    const modalHeader = page.locator('.ei-tab-container__header');
    await modalHeader.click();
    await expect(emojiPicker).not.toBeVisible({ timeout: 3000 });
  });

  /**
   * Test 2: Typing an emoji directly sets avatar and persists after close/reopen.
   */
  test("typing an emoji sets avatar value and persists after close and reopen", async ({
    page,
    mockServerUrl,
  }) => {
    test.slow(); // Extra time for state to settle on reopen

    const checkpoint = createCheckpoint(mockServerUrl, [
      { id: "test-02", display_name: "Mochi", short_description: "Fluffy test persona" },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor and navigate to Identity tab
    await openEditorForPersona(page, "Mochi");
    await page.locator('button[role="tab"]').filter({ hasText: "Identity" }).click();

    // Scroll to top so avatar section is accessible
    const modalContent = page.locator(".ei-tab-container__content");
    await modalContent.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });

    // Type emoji into the input — onChange fires on every keystroke → saves immediately
    const emojiInput = page.locator('input.ei-input[placeholder*="emoji"]');
    await expect(emojiInput).toBeVisible({ timeout: 5000 });
    await emojiInput.fill("🐱");

    // Assert the input now shows the emoji
    await expect(emojiInput).toHaveValue("🐱");

    // Close editor (accept any unsaved-changes dialog)
    await closeEditor(page);

    // Wait for editor to close
    await expect(page.locator('text=Edit Persona: Mochi')).not.toBeVisible({ timeout: 5000 });

    // Re-open editor
    await openEditorForPersona(page, "Mochi");
    await page.locator('button[role="tab"]').filter({ hasText: "Identity" }).click();

    const modalContent2 = page.locator(".ei-tab-container__content");
    await modalContent2.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });

    // Assert emoji persisted
    const emojiInputReopened = page.locator('input.ei-input[placeholder*="emoji"]');
    await expect(emojiInputReopened).toBeVisible({ timeout: 5000 });
    await expect(emojiInputReopened).toHaveValue("🐱");
  });

  /**
   * Test 3: Clicking Image tab renders file input and deactivates Emoji tab.
   */
  test("image tab renders file input and toggles active state correctly", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = createCheckpoint(mockServerUrl, [
      { id: "test-03", display_name: "ImgBot", short_description: "Image test persona" },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor and navigate to Identity tab
    await openEditorForPersona(page, "ImgBot");
    await page.locator('button[role="tab"]').filter({ hasText: "Identity" }).click();

    // Scroll to top
    const modalContent = page.locator(".ei-tab-container__content");
    await modalContent.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });

    // Verify initial state: Emoji is active
    const emojiBtn = page.locator(".ei-avatar-tabs button").filter({ hasText: "Emoji" });
    await expect(emojiBtn).toBeVisible({ timeout: 5000 });
    await expect(emojiBtn).toHaveClass(/ei-btn--primary/);

    // Click Image tab button
    const imageBtn = page.locator(".ei-avatar-tabs button").filter({ hasText: "Image" });
    await expect(imageBtn).toBeVisible();
    await imageBtn.click();

    // Assert Image is now active, Emoji is not
    await expect(imageBtn).toHaveClass(/ei-btn--primary/);
    await expect(emojiBtn).not.toHaveClass(/ei-btn--primary/);

    // Assert file input is visible
    await expect(page.locator('input[type="file"][accept="image/*"]')).toBeVisible({ timeout: 3000 });

    // No Clear button should appear yet (no image set)
    // The Clear button only appears when persona.avatar_image is set
    const clearButtons = page.locator(".ei-avatar-tabs ~ div button").filter({ hasText: "Clear" });
    await expect(clearButtons).not.toBeVisible();
  });

  /**
   * Test 4: Preferred theme selector renders on Settings tab with all built-in options
   * and persists the selected value after close/reopen.
   */
  test("preferred theme selector renders with built-in options and persists selection", async ({
    page,
    mockServerUrl,
  }) => {
    test.slow(); // Extra time for state settle on reopen

    const checkpoint = createCheckpoint(mockServerUrl, [
      { id: "test-04", display_name: "ThemeBot", short_description: "Theme test persona" },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor — it opens on Settings tab by default
    await openEditorForPersona(page, "ThemeBot");

    // Assert the preferred-theme select is visible
    const themeSelect = page.locator('select#preferred-theme');
    await expect(themeSelect).toBeVisible({ timeout: 5000 });

    // Assert "Use global theme" (empty value) option exists
    await expect(themeSelect.locator('option[value=""]')).toHaveCount(1);

    // Spot-check three built-in options
    await expect(themeSelect.locator('option[value="dark"]')).toHaveCount(1);
    await expect(themeSelect.locator('option[value="spoopy"]')).toHaveCount(1);
    await expect(themeSelect.locator('option[value="cotton-candy"]')).toHaveCount(1);

    // Assert the Built-in optgroup exists
    await expect(themeSelect.locator('optgroup[label="Built-in"]')).toHaveCount(1);

    // Select "dark"
    await themeSelect.selectOption("dark");
    await expect(themeSelect).toHaveValue("dark");

    // Close editor (accept any dialog)
    await closeEditor(page);
    await expect(page.locator('text=Edit Persona: ThemeBot')).not.toBeVisible({ timeout: 5000 });

    // Re-open editor
    await openEditorForPersona(page, "ThemeBot");

    // Assert the theme persisted
    const themeSelectReopened = page.locator('select#preferred-theme');
    await expect(themeSelectReopened).toBeVisible({ timeout: 5000 });
    await expect(themeSelectReopened).toHaveValue("dark");
  });

  /**
   * Test 5: Show Timestamps starts disabled and persists after being enabled.
   */
  test("show timestamps checkbox persists after close and reopen", async ({
    page,
    mockServerUrl,
  }) => {
    test.slow(); // Extra time for state to settle on reopen

    const checkpoint = createCheckpoint(mockServerUrl, [
      {
        id: "test-05",
        display_name: "TimestampBot",
        short_description: "Timestamp test persona",
        include_message_timestamps: false,
      },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor — it opens on Settings tab by default
    await openEditorForPersona(page, "TimestampBot");

    const timestampsCheckbox = page.getByLabel("Show Timestamps");
    await expect(timestampsCheckbox).toBeVisible({ timeout: 5000 });
    await expect(timestampsCheckbox).not.toBeChecked();

    // Enable timestamps
    await timestampsCheckbox.check();
    await expect(timestampsCheckbox).toBeChecked();

    // Close editor (accept any dialog)
    await closeEditor(page);
    await expect(page.locator("text=Edit Persona: TimestampBot")).not.toBeVisible({ timeout: 5000 });

    // Re-open editor
    await openEditorForPersona(page, "TimestampBot");

    // Assert timestamps setting persisted
    const timestampsCheckboxReopened = page.getByLabel("Show Timestamps");
    await expect(timestampsCheckboxReopened).toBeVisible({ timeout: 5000 });
    await expect(timestampsCheckboxReopened).toBeChecked();
  });

  /**
   * Test 6: External Reflection Only checkbox persists after close and reopen.
   * Located via data-testid, not label text — see PersonaSettingsTab.tsx.
   */
  test("external reflection only checkbox persists after close and reopen", async ({
    page,
    mockServerUrl,
  }) => {
    test.slow(); // Extra time for state to settle on reopen

    const checkpoint = createCheckpoint(mockServerUrl, [
      {
        id: "test-06",
        display_name: "ReflectBot",
        short_description: "Reflection test persona",
        external_reflection_only: false,
      },
    ]);

    await loadCheckpoint(page, mockServerUrl, checkpoint);
    await page.goto("/");

    // Open editor — it opens on Settings tab by default
    await openEditorForPersona(page, "ReflectBot");

    const externalReflectionCheckbox = page.getByTestId("external-reflection-only-checkbox");
    await expect(externalReflectionCheckbox).toBeVisible({ timeout: 5000 });
    await expect(externalReflectionCheckbox).not.toBeChecked();

    // Enable external-reflection-only
    await externalReflectionCheckbox.check();
    await expect(externalReflectionCheckbox).toBeChecked();

    // Close editor (accept any dialog)
    await closeEditor(page);
    await expect(page.locator("text=Edit Persona: ReflectBot")).not.toBeVisible({ timeout: 5000 });

    // Re-open editor
    await openEditorForPersona(page, "ReflectBot");

    // Assert the setting persisted
    const externalReflectionCheckboxReopened = page.getByTestId("external-reflection-only-checkbox");
    await expect(externalReflectionCheckboxReopened).toBeVisible({ timeout: 5000 });
    await expect(externalReflectionCheckboxReopened).toBeChecked();
  });
});
