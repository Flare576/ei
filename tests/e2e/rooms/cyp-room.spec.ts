import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

test.use({ browserName: "chromium" });

const STATE_KEY = "ei_state";

/**
 * Builds a checkpoint with two personas (Ei + Sage) and one CYP room.
 * No judge persona — CYP rooms don't use a judge.
 */
function buildCypCheckpoint(mockServerUrl: string) {
  const checkpoint = createMinimalCheckpoint(mockServerUrl) as unknown as Record<string, unknown>;
  const timestamp = new Date().toISOString();

  // Add second persona "Sage"
  const personas = checkpoint.personas as Record<string, unknown>;
  personas["007"] = {
    entity: {
      entity: "persona",
      id: "007",
      display_name: "Sage",
      aliases: ["Sage"],
      short_description: "A wise companion",
      long_description: "A thoughtful and wise persona",
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
  };

  checkpoint.rooms = {
    "crossroads-room": {
      id: "crossroads-room",
      entity: "room",
      display_name: "Crossroads",
      mode: "choose_your_path",
      persona_ids: ["ei", "007"],
      judge_persona_id: null,
      active_node_id: "cyp-seed-msg",
      is_archived: false,
      capture_used: false,
      messages: [
        {
          id: "cyp-seed-msg",
          parent_id: null,
          role: "human",
          content: "Starting the CYP room",
          timestamp,
          read: true,
          context_status: "default",
        },
        {
          id: "cyp-ei-r1",
          parent_id: "cyp-seed-msg",
          role: "persona",
          persona_id: "ei",
          content: "CYP response option",
          timestamp,
          read: false,
          context_status: "default",
        },
        {
          id: "cyp-007-r1",
          parent_id: "cyp-seed-msg",
          role: "persona",
          persona_id: "007",
          content: "CYP response option",
          timestamp,
          read: false,
          context_status: "default",
        },
      ],
      created_at: timestamp,
      last_updated: timestamp,
      last_activity: timestamp,
    },
  };

  return checkpoint;
}

/** Navigate to the CYP room after page load. */
async function openCypRoom(page: import("@playwright/test").Page) {
  await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
  await page.locator(".ei-room-pill").filter({ hasText: "Crossroads" }).click();
  await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });
}

test.describe("CYP Room — branch selection", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  // W4-1: Send message → personas respond → CYP picker / response cards appear
  test("CYP room shows response cards after personas respond", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        content: "CYP response option",
      }),
      statusCode: 200,
    });

    const checkpoint = buildCypCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);

    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("Which path shall we take?");
    await textarea.press("Enter");

    const activateBtn = page.locator(".ei-room-status__activate");
    await expect(activateBtn).toBeVisible({ timeout: 10000 });

    await activateBtn.click();

    await expect(page.locator(".ei-cyp-picker")).toBeVisible({ timeout: 5000 });

    const cards = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human)");
    await expect(cards).toHaveCount(2, { timeout: 5000 });

    await expect(cards.first().locator(".ei-cyp-card__preview")).toContainText("CYP response option");
  });

  // W4-2: Click "Choose" on one response → that branch becomes active / new round starts
  test("CYP room Choose button selects a branch", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        content: "CYP response option",
      }),
      statusCode: 200,
    });

    const checkpoint = buildCypCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);

    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("Choose a path!");
    await textarea.press("Enter");

    const activateBtn = page.locator(".ei-room-status__activate");
    await expect(activateBtn).toBeVisible({ timeout: 10000 });
    await activateBtn.click();

    await expect(page.locator(".ei-cyp-picker")).toBeVisible({ timeout: 5000 });

    const firstCard = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human)").first();
    const chooseBtn = firstCard.locator("button.ei-btn--primary");
    await expect(chooseBtn).toContainText("Choose");
    await chooseBtn.click();

    // The picker should close after selection
    await expect(page.locator(".ei-cyp-picker")).not.toBeVisible({ timeout: 5000 });

    // A new round starts — input becomes available for the next message
    // The textarea should be usable (not disabled, no "Response submitted" placeholder)
    await expect(textarea).not.toBeDisabled({ timeout: 5000 });
    await expect(textarea).not.toHaveAttribute("placeholder", /Response submitted/);

    // The chosen path's response message is now in the active path (displayed)
    await expect(
      page.locator(".ei-room-message-wrapper.persona")
    ).toBeVisible({ timeout: 5000 });
  });

  // W4-3: After choosing a branch and completing a second round,
  //        explored/unexplored indicators appear on branch badges
  test("CYP room shows explored indicators on second round", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        content: "CYP response option",
      }),
      statusCode: 200,
    });

    const checkpoint = buildCypCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);

    // --- Round 1 ---
    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("First question");
    await textarea.press("Enter");

    const activateBtn = page.locator(".ei-room-status__activate");
    await expect(activateBtn).toBeVisible({ timeout: 10000 });
    await activateBtn.click();

    await expect(page.locator(".ei-cyp-picker")).toBeVisible({ timeout: 5000 });

    const firstCard = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human)").first();
    const chooseBtn = firstCard.locator("button.ei-btn--primary");
    await chooseBtn.click();

    await expect(page.locator(".ei-cyp-picker")).not.toBeVisible({ timeout: 5000 });

    // --- Round 2 ---
    await textarea.fill("Second question");
    await textarea.press("Enter");

    const activateBtn2 = page.locator(".ei-room-status__activate");
    await expect(activateBtn2).toBeVisible({ timeout: 20000 });
    await activateBtn2.click();

    await expect(page.locator(".ei-cyp-picker")).toBeVisible({ timeout: 5000 });

    const round2Cards = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human)");
    await expect(round2Cards).toHaveCount(2, { timeout: 5000 });

    const exploredBadges = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human) .ei-cyp-explored-badge");
    await expect(exploredBadges).toHaveCount(2, { timeout: 5000 });

    const unexploredBadges = page.locator(".ei-cyp-picker .ei-cyp-card:not(.ei-cyp-card--human) .ei-cyp-explored-badge--no");
    await expect(unexploredBadges).toHaveCount(2, { timeout: 5000 });

    await page.locator(".ei-cyp-picker__cancel").click();
    await expect(page.locator(".ei-cyp-picker")).not.toBeVisible({ timeout: 3000 });

    const branchBadges = page.locator(".ei-cyp-branch-badge");
    await expect(branchBadges.first()).toBeVisible({ timeout: 5000 });

    await branchBadges.first().click();

    const navPicker = page.locator(".ei-cyp-nav-picker");
    await expect(navPicker).toBeVisible({ timeout: 3000 });

    const navCards = navPicker.locator(".ei-cyp-card");
    await expect(navCards).toHaveCount(3, { timeout: 5000 });

    const exploredNavBadge = navPicker.locator(".ei-cyp-explored-badge--yes");
    await expect(exploredNavBadge).toHaveCount(1, { timeout: 5000 });

    const unexploredNavBadge = navPicker.locator(".ei-cyp-explored-badge--no");
    await expect(unexploredNavBadge).toHaveCount(2, { timeout: 5000 });
  });
});
