import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

test.use({ browserName: "chromium" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a checkpoint with Ei + 007 personas and one pre-existing FFA room
 * named "Fellowship". The room is active (not archived) so we can test the
 * archive/unarchive flow without going through the creation UI.
 */
async function seedOneFfaRoom(
  page: import("@playwright/test").Page,
  mockServerUrl: string
) {
  const base = createMinimalCheckpoint(mockServerUrl);
  const timestamp = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = {
    ...base,
    personas: {
      ...base.personas,
      "007": {
        entity: {
          entity: "persona",
          id: "007",
          display_name: "007",
          aliases: ["007"],
          short_description: "A suave secret agent",
          long_description: "Shaken, not stirred",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
        },
        messages: [],
      },
    },
    rooms: {
      fellowship: {
        id: "fellowship",
        display_name: "Fellowship",
        entity: "room",
        mode: "free_for_all",
        persona_ids: ["ei", "007"],
        active_node_id: null,
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        messages: [],
      },
    },
  };

  await page.addInitScript(
    ({ key, data }: { key: string; data: unknown }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: "ei_state", data: state }
  );
}

/** Switch the sidebar to the Rooms tab. */
async function openRoomsTab(page: import("@playwright/test").Page) {
  await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Room Archive/Unarchive (W5)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  // -------------------------------------------------------------------------
  // W5-1: Hovering room pill reveals archive button
  // -------------------------------------------------------------------------
  test("hovering room pill reveals archive button", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    // Wait for persona panel to load
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    // Switch to Rooms tab
    await openRoomsTab(page);

    // The Fellowship pill should be visible
    const roomPill = page.locator(".ei-room-pill", { hasText: "Fellowship" });
    await expect(roomPill).toBeVisible({ timeout: 5000 });

    // Archive controls should NOT be visible before hover
    await expect(roomPill.locator(".ei-room-pill__controls")).not.toBeVisible();

    // Hover over the room pill
    await roomPill.hover();

    // Archive button should now appear
    const archiveBtn = roomPill.locator(".ei-control-btn--archive");
    await expect(archiveBtn).toBeVisible({ timeout: 3000 });
    await expect(archiveBtn).toHaveAttribute("title", "Archive Room");
  });

  // -------------------------------------------------------------------------
  // W5-2: Clicking archive removes room from list
  // -------------------------------------------------------------------------
  test("clicking archive removes room from list", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openRoomsTab(page);

    const roomPill = page.locator(".ei-room-pill", { hasText: "Fellowship" });
    await expect(roomPill).toBeVisible({ timeout: 5000 });

    // Hover to reveal controls, then click the archive button
    await roomPill.hover();
    const archiveBtn = roomPill.locator(".ei-control-btn--archive");
    await expect(archiveBtn).toBeVisible({ timeout: 3000 });
    await archiveBtn.click();

    // "Fellowship" room pill should disappear from the sidebar
    await expect(page.locator(".ei-room-pill", { hasText: "Fellowship" })).not.toBeVisible({
      timeout: 5000,
    });
  });

  // -------------------------------------------------------------------------
  // W5-3: Archived room can be unarchived
  // -------------------------------------------------------------------------
  test("archived room can be unarchived", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openRoomsTab(page);

    // Archive the Fellowship room first
    const roomPill = page.locator(".ei-room-pill", { hasText: "Fellowship" });
    await expect(roomPill).toBeVisible({ timeout: 5000 });
    await roomPill.hover();
    const archiveBtn = roomPill.locator(".ei-control-btn--archive");
    await expect(archiveBtn).toBeVisible({ timeout: 3000 });
    await archiveBtn.click();

    // Confirm it's gone from active list
    await expect(page.locator(".ei-room-pill", { hasText: "Fellowship" })).not.toBeVisible({
      timeout: 5000,
    });

    // Open archived rooms via the 📦 button in the panel header
    const viewArchivedBtn = page.locator(".ei-btn--icon.ei-btn--archive[title='View Archived Rooms']");
    await expect(viewArchivedBtn).toBeVisible({ timeout: 3000 });
    await viewArchivedBtn.click();

    // The archived rooms modal should appear
    const modal = page.locator(".ei-archived-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fellowship should appear in the archived list
    await expect(modal.locator("text=Fellowship")).toBeVisible({ timeout: 3000 });

    // Click "Unarchive"
    const unarchiveBtn = modal.locator(".ei-btn--secondary", { hasText: "Unarchive" });
    await expect(unarchiveBtn).toBeVisible({ timeout: 3000 });
    await unarchiveBtn.click();

    // Modal closes (or Fellowship is removed from it)
    // Wait for the room to return to the active rooms list
    await expect(page.locator(".ei-room-pill", { hasText: "Fellowship" })).toBeVisible({
      timeout: 5000,
    });
  });
});
