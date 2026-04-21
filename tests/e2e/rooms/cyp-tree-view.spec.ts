import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

test.use({ browserName: "chromium" });

const STATE_KEY = "ei_state";

function addSagePersona(checkpoint: Record<string, unknown>, timestamp: string) {
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
}

function buildRoomBase(overrides: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  return {
    id: "crossroads-room",
    entity: "room",
    display_name: "Crossroads",
    mode: "choose_your_path",
    persona_ids: ["ei", "007"],
    judge_persona_id: null,
    is_archived: false,
    capture_used: false,
    created_at: timestamp,
    last_updated: timestamp,
    last_activity: timestamp,
    ...overrides,
  };
}

/**
 * Complete round-1 family (all 3 siblings present: human + ei + 007).
 * active_node_id = "cyp-ei-r1" (human chose Ei's path).
 * cyp-007-r1 is a visible inactive/pending leaf — no missing siblings, not on active path.
 *
 *   cyp-seed-msg  (root, null parent)
 *   ├── cyp-human-r1  (human round-1 response)
 *   ├── cyp-ei-r1     (persona:ei — activated, active_node_id)
 *   └── cyp-007-r1    (persona:007 — pending, visible inactive leaf)
 */
function buildExploredCypCheckpoint(mockServerUrl: string) {
  const checkpoint = createMinimalCheckpoint(mockServerUrl) as unknown as Record<string, unknown>;
  const timestamp = new Date().toISOString();
  addSagePersona(checkpoint, timestamp);

  checkpoint.rooms = {
    "crossroads-room": buildRoomBase({
      active_node_id: "cyp-ei-r1",
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
          id: "cyp-human-r1",
          parent_id: "cyp-seed-msg",
          role: "human",
          content: "My round-one response",
          timestamp,
          read: true,
          context_status: "default",
        },
        {
          id: "cyp-ei-r1",
          parent_id: "cyp-seed-msg",
          role: "persona",
          persona_id: "ei",
          content: "Ei round-one response",
          timestamp,
          read: true,
          context_status: "default",
        },
        {
          id: "cyp-007-r1",
          parent_id: "cyp-seed-msg",
          role: "persona",
          persona_id: "007",
          content: "Sage round-one response",
          timestamp,
          read: false,
          context_status: "default",
        },
      ],
    }),
  };

  return checkpoint;
}

/**
 * Incomplete round-1 family: personas have responded but the human has NOT yet.
 * cyp-ei-r1 and cyp-007-r1 are siblings with a missing sibling (the human) → both masked.
 *
 *   cyp-seed-msg  (root, null parent)
 *   ├── cyp-ei-r1   (persona:ei  — MASKED: human sibling missing)
 *   └── cyp-007-r1  (persona:007 — MASKED: human sibling missing)
 */
function buildMaskedCypCheckpoint(mockServerUrl: string) {
  const checkpoint = createMinimalCheckpoint(mockServerUrl) as unknown as Record<string, unknown>;
  const timestamp = new Date().toISOString();
  addSagePersona(checkpoint, timestamp);

  checkpoint.rooms = {
    "crossroads-room": buildRoomBase({
      active_node_id: "cyp-seed-msg",
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
          content: "Secret Ei response — should be hidden",
          timestamp,
          read: false,
          context_status: "default",
        },
        {
          id: "cyp-007-r1",
          parent_id: "cyp-seed-msg",
          role: "persona",
          persona_id: "007",
          content: "Secret Sage response — should be hidden",
          timestamp,
          read: false,
          context_status: "default",
        },
      ],
    }),
  };

  return checkpoint;
}

async function openCypRoom(page: import("@playwright/test").Page) {
  await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
  await page.locator(".ei-room-pill").filter({ hasText: "Crossroads" }).click();
  await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });
}

async function openMapOverview(page: import("@playwright/test").Page) {
  await page.locator(".ei-boundary-btn", { hasText: "🗺" }).click();
  await expect(page.locator(".ei-room-overview-overlay")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".ei-cyp-tree")).toBeVisible({ timeout: 5000 });
}

test.describe("CYP Tree View — Map overview", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  // W4-4: Map button opens the overlay containing the CYP tree
  test("CYP map overview opens when clicking the map button", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildExploredCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    await expect(page.locator(".ei-room-overview__title")).toContainText("Crossroads");

    await page.locator(".ei-room-overview__close").click();
    await expect(page.locator(".ei-room-overview-overlay")).not.toBeVisible({ timeout: 3000 });
  });

  // W4-5: Activated (on-path) nodes show "Jump here" when expanded
  test("activated nodes in tree view show Jump here button", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildExploredCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    const activatedNode = page.locator(".ei-cyp-node--activated").first();
    await expect(activatedNode).toBeVisible({ timeout: 5000 });
    await activatedNode.click();

    await expect(activatedNode.locator("button", { hasText: "Jump here" })).toBeVisible({ timeout: 3000 });
  });

  // W4-6: Pending (off-path, complete family) leaf nodes show "Jump to parent" when expanded
  test("pending leaf nodes in tree view show Jump to parent button", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildExploredCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    const inactiveNode = page.locator(".ei-cyp-node--inactive").first();
    await expect(inactiveNode).toBeVisible({ timeout: 5000 });
    await inactiveNode.click();

    await expect(inactiveNode.locator("button", { hasText: "Jump to parent" })).toBeVisible({ timeout: 3000 });
  });

  // W4-7: Nodes with a missing sibling are masked and show [Content hidden]
  test("nodes with a missing sibling are masked in the tree view", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildMaskedCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    const maskedNodes = page.locator(".ei-cyp-node--masked");
    await expect(maskedNodes).toHaveCount(2, { timeout: 5000 });
    await expect(maskedNodes.first().locator(".ei-cyp-node__masked-content")).toContainText("[Content hidden]");
  });

  // W4-8: "Jump here" on an activated node closes the overlay and returns to the room
  test("Jump here on an activated node navigates and closes the overlay", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildExploredCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    const activatedNode = page.locator(".ei-cyp-node--activated").first();
    await activatedNode.click();
    const jumpBtn = activatedNode.locator("button", { hasText: "Jump here" });
    await expect(jumpBtn).toBeVisible({ timeout: 3000 });
    await jumpBtn.click();

    await expect(page.locator(".ei-room-overview-overlay")).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 3000 });
  });

  // W4-9: Clicking outside the overview panel (backdrop) closes it
  test("clicking the backdrop closes the map overview", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildExploredCypCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ key, data }) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(data)); },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");
    await openCypRoom(page);
    await openMapOverview(page);

    await page.locator(".ei-room-overview-overlay").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".ei-room-overview-overlay")).not.toBeVisible({ timeout: 3000 });
  });
});
