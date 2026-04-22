/**
 * E2E tests for Person Identifiers UI (PersonCard.tsx):
 *
 * - Pre-migration state shows "Migration pending" message, no add row
 * - Post-migration with no identifiers shows empty state message
 * - Adding a built-in type identifier (type select + value input + Add button)
 * - Adding a custom type identifier via "+ Add new type…" option
 * - Adding an Ei Persona identifier renders a persona dropdown (not a text input)
 * - First identifier added auto-saves and becomes primary (★)
 * - Setting a different identifier as primary updates the card heading
 * - Deleting an identifier removes it from the list
 * - Deleting the primary identifier promotes the next one to primary
 * - Identifier value search filtering in HumanPeopleTab
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

async function openPeopleTab(page: import("@playwright/test").Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
  await page.locator('button[role="tab"]').filter({ hasText: "People" }).click();
}

async function expandIdentifiers(page: import("@playwright/test").Page) {
  await page.locator(".ei-identifiers-collapsible__toggle").first().click();
  await expect(page.locator(".ei-identifiers__add-row")).toBeVisible({ timeout: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint builders
// ─────────────────────────────────────────────────────────────────────────────

/** Person with `identifiers: undefined` — simulates pre-migration record */
function buildCheckpointPreMigration(mockServerUrl: string) {
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
          name: "Alice",
          relationship: "friend",
          description: "College friend.",
          sentiment: 0.8,
          exposure_current: 0.4,
          exposure_desired: 0.6,
          last_updated: ts,
          // intentionally no `identifiers` field
        },
      ],
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

/** Person with `identifiers: []` — post-migration, no identifiers yet */
function buildCheckpointNoIdentifiers(mockServerUrl: string) {
  const base = buildCheckpointPreMigration(mockServerUrl);
  return {
    ...base,
    human: {
      ...base.human,
      people: [
        {
          ...base.human.people[0],
          identifiers: [],
        },
      ],
    },
  };
}

/** Person with two identifiers, one primary */
function buildCheckpointWithIdentifiers(mockServerUrl: string) {
  const base = buildCheckpointPreMigration(mockServerUrl);
  const ts = base.timestamp;
  return {
    ...base,
    human: {
      ...base.human,
      people: [
        {
          ...base.human.people[0],
          identifiers: [
            { type: "Full Name", value: "Alice Smith", is_primary: true },
            { type: "Email", value: "alice@example.com", is_primary: false },
          ],
        },
      ],
    },
    personas: {
      ...base.personas,
      alice_persona: {
        entity: {
          entity: "system",
          id: "alice_persona",
          display_name: "Alice",
          aliases: ["Alice"],
          short_description: "A friendly persona",
          long_description: "Alice is a helpful persona for testing.",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: ts,
        },
        messages: [],
      },
    },
  };
}

/** Two people whose identifier values can be searched */
function buildCheckpointWithTwoPeople(mockServerUrl: string) {
  const base = buildCheckpointPreMigration(mockServerUrl);
  const ts = base.timestamp;
  return {
    ...base,
    human: {
      ...base.human,
      people: [
        {
          id: "person-001",
          name: "Bob",
          relationship: "coworker",
          description: "Works on the backend team.",
          sentiment: 0.6,
          exposure_current: 0.3,
          exposure_desired: 0.5,
          last_updated: ts,
          identifiers: [
            { type: "Full Name", value: "Robert Johnson", is_primary: true },
            { type: "GitHub", value: "rjohnson", is_primary: false },
          ],
        },
        {
          id: "person-002",
          name: "Carol",
          relationship: "friend",
          description: "Hiking buddy.",
          sentiment: 0.9,
          exposure_current: 0.5,
          exposure_desired: 0.7,
          last_updated: ts,
          identifiers: [
            { type: "Full Name", value: "Carol Martinez", is_primary: true },
            { type: "Discord", value: "carol#1234", is_primary: false },
          ],
        },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Person Identifiers UI", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    if (typeof (mockServer as any).clearResponseOverrides === "function") {
      (mockServer as any).clearResponseOverrides();
    }
  });

  // ── Pre-migration state ───────────────────────────────────────────────────

  test("pre-migration person shows migration pending notice and no add row", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointPreMigration(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });

    await expect(page.locator(".ei-identifiers__migration-note")).toContainText("Migration pending");
    await expect(page.locator(".ei-identifiers__add-row")).not.toBeVisible();
  });

  // ── Post-migration, no identifiers ───────────────────────────────────────

  test("post-migration person with no identifiers shows empty state and add row", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await expect(page.locator(".ei-identifiers__empty")).toContainText("No identifiers yet");
    await expect(page.locator(".ei-identifiers__add-row")).toBeVisible();
  });

  // ── Adding a built-in type identifier ────────────────────────────────────

  test("adding a built-in type identifier shows it in the list", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    // Select "Email" from the type dropdown
    await page.locator(".ei-identifiers__type-select").selectOption("Email");

    // Fill in value
    await page.locator(".ei-identifiers__value-input").fill("alice@example.com");

    // Click Add
    await page.locator(".ei-identifiers__add-btn").click();

    // Identifier row should appear
    await expect(page.locator(".ei-identifier-row")).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(".ei-identifier-row__type-badge")).toContainText("Email");
    await expect(page.locator(".ei-identifier-row__value")).toHaveValue("alice@example.com");
  });

  test("first identifier added auto-saves and is marked primary (★)", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await page.locator(".ei-identifiers__type-select").selectOption("Full Name");
    await page.locator(".ei-identifiers__value-input").fill("Alice Smith");
    await page.locator(".ei-identifiers__add-btn").click();

    // Primary button should be active (★ not ☆)
    await expect(
      page.locator(".ei-identifier-row__primary-btn--active")
    ).toBeVisible({ timeout: 3000 });

    // Card heading should update to "Alice Smith"
    await expect(page.locator(".ei-person-heading")).toContainText("Alice Smith", { timeout: 3000 });
  });

  test("Enter key in value input adds the identifier", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await page.locator(".ei-identifiers__type-select").selectOption("Nickname");
    await page.locator(".ei-identifiers__value-input").fill("Ally");
    await page.locator(".ei-identifiers__value-input").press("Enter");

    await expect(page.locator(".ei-identifier-row")).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(".ei-identifier-row__type-badge")).toContainText("Nickname");
  });

  test("Add button disabled when type or value is empty", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    // Value empty → Add disabled
    await expect(page.locator(".ei-identifiers__add-btn")).toBeDisabled();

    // Fill value → Add enabled
    await page.locator(".ei-identifiers__value-input").fill("something");
    await expect(page.locator(".ei-identifiers__add-btn")).toBeEnabled();

    // Clear value → Add disabled again
    await page.locator(".ei-identifiers__value-input").fill("");
    await expect(page.locator(".ei-identifiers__add-btn")).toBeDisabled();
  });

  // ── Custom type ───────────────────────────────────────────────────────────

  test("selecting '+ Add new type…' shows custom type input, Escape cancels", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await page.locator(".ei-identifiers__type-select").selectOption("__custom__");

    // Custom type input should appear (replaces the select)
    await expect(page.locator(".ei-identifiers__type-input")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".ei-identifiers__type-select")).not.toBeVisible();

    // Escape should cancel and restore the select
    await page.locator(".ei-identifiers__type-input").press("Escape");
    await expect(page.locator(".ei-identifiers__type-select")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".ei-identifiers__type-input")).not.toBeVisible();
  });

  test("adding a custom type identifier shows it in the list", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointNoIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await page.locator(".ei-identifiers__type-select").selectOption("__custom__");
    await page.locator(".ei-identifiers__type-input").fill("Slack RNP");
    await page.locator(".ei-identifiers__value-input").fill("U123456");
    await page.locator(".ei-identifiers__add-btn").click();

    await expect(page.locator(".ei-identifier-row")).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(".ei-identifier-row__type-badge")).toContainText("Slack RNP");
    await expect(page.locator(".ei-identifier-row__value")).toHaveValue("U123456");
  });

  // ── Ei Persona type ───────────────────────────────────────────────────────

  test("selecting Ei Persona type renders a persona dropdown in the add row", async ({
    page,
    mockServerUrl,
  }) => {
    // Need a persona in state so the dropdown has options
    await loadCheckpoint(page, buildCheckpointWithIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    await page.locator(".ei-identifiers__type-select").selectOption("Ei Persona");

    // Should render a select (persona dropdown) instead of text input
    await expect(page.locator(".ei-identifiers__value-input.ei-select")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".ei-identifiers__value-input[type='text']")).not.toBeVisible();

    // Hint text should appear
    await expect(page.locator(".ei-identifiers__hint")).toContainText("UUID");
  });

  test("existing Ei Persona identifier renders persona display name (not raw UUID)", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildCheckpointWithIdentifiers(mockServerUrl);
    // Add an Ei Persona identifier pointing at alice_persona
    (checkpoint.human.people[0] as any).identifiers = [
      { type: "Ei Persona", value: "alice_persona", is_primary: false },
      { type: "Full Name", value: "Alice Smith", is_primary: true },
    ];
    await loadCheckpoint(page, checkpoint);
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    // The Ei Persona row should show the display name "Alice" not the UUID
    const eiPersonaRow = page.locator(".ei-identifier-row").filter({ hasText: "Ei Persona" });
    await expect(eiPersonaRow).toBeVisible({ timeout: 3000 });

    // It should render as a select (not a readonly text input) since personas are available
    const valueSelect = eiPersonaRow.locator("select.ei-identifier-row__value");
    await expect(valueSelect).toBeVisible();
    // The selected option should be the persona ID; display name is shown via <option>
    await expect(valueSelect).toHaveValue("alice_persona");
  });

  // ── Primary identifier controls ───────────────────────────────────────────

  test("clicking ☆ on non-primary identifier promotes it to primary", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);

    // Initially "Alice Smith" (Full Name) is primary → heading shows "Alice Smith"
    await expect(page.locator(".ei-person-heading")).toContainText("Alice Smith");

    // The second row (Email) has ☆ — click it to make Email primary
    const nonPrimaryBtn = page.locator(".ei-identifier-row__primary-btn:not(.ei-identifier-row__primary-btn--active)");
    await expect(nonPrimaryBtn).toBeVisible({ timeout: 3000 });
    await nonPrimaryBtn.click();

    // Now Email row should be primary (★)
    const primaryBtns = page.locator(".ei-identifier-row__primary-btn--active");
    await expect(primaryBtns).toHaveCount(1);

    // Heading should update to the email value
    await expect(page.locator(".ei-person-heading")).toContainText("alice@example.com");
  });

  // ── Deleting identifiers ─────────────────────────────────────────────────

  test("clicking × deletes the identifier", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);
    await expect(page.locator(".ei-identifier-row")).toHaveCount(2, { timeout: 5000 });

    // Delete the second identifier (Email)
    await page.locator(".ei-identifier-row__delete-btn").nth(1).click();

    await expect(page.locator(".ei-identifier-row")).toHaveCount(1, { timeout: 3000 });
    // The remaining one should be Full Name
    await expect(page.locator(".ei-identifier-row__type-badge")).toContainText("Full Name");
  });

  test("deleting the primary identifier promotes the next one to primary", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithIdentifiers(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card").first()).toBeVisible({ timeout: 5000 });
    await expandIdentifiers(page);
    await expect(page.locator(".ei-identifier-row")).toHaveCount(2, { timeout: 5000 });

    // Full Name is primary. Delete it.
    await page.locator(".ei-identifier-row__delete-btn").first().click();

    await expect(page.locator(".ei-identifier-row")).toHaveCount(1, { timeout: 3000 });

    // The remaining Email row should now be primary
    await expect(
      page.locator(".ei-identifier-row__primary-btn--active")
    ).toHaveCount(1);

    // Heading should reflect the new primary value
    await expect(page.locator(".ei-person-heading")).toContainText("alice@example.com");
  });

  // ── Identifier value search filtering ────────────────────────────────────

  test("filter search matches on identifier value, not just name", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithTwoPeople(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    // Both people visible initially
    await expect(page.locator(".ei-data-card")).toHaveCount(2, { timeout: 5000 });

    // Search by GitHub handle — neither person's display name contains "rjohnson"
    // but Bob's GitHub identifier value does
    const filterInput = page.locator('.ei-search-input');
    await filterInput.fill("rjohnson");

    await expect(page.locator(".ei-data-card")).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(".ei-person-heading")).toContainText("Robert Johnson");
  });

  test("filter search on identifier value is case-insensitive", async ({
    page,
    mockServerUrl,
  }) => {
    await loadCheckpoint(page, buildCheckpointWithTwoPeople(mockServerUrl));
    await blockEmbeddingCDN(page);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    await openPeopleTab(page);
    await expect(page.locator(".ei-data-card")).toHaveCount(2, { timeout: 5000 });

    // "carol#1234" is Carol's Discord — search with mixed case
    await page.locator('.ei-search-input').fill("CAROL#1234");

    await expect(page.locator(".ei-data-card")).toHaveCount(1, { timeout: 3000 });
    await expect(page.locator(".ei-person-heading")).toContainText("Carol Martinez");
  });
});
