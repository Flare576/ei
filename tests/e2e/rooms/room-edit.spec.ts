import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

test.use({ browserName: "chromium" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a checkpoint with Ei + 007 personas and one pre-existing FFA room
 * named "Fellowship". The room is active (not archived) so we can test the
 * edit flow without going through the creation UI.
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
          last_activity: timestamp,
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
        last_activity: timestamp,
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

/** Hover the Fellowship room pill and return a locator for it. */
async function hoverFellowship(page: import("@playwright/test").Page) {
  const roomPill = page.locator(".ei-room-pill", { hasText: "Fellowship" });
  await expect(roomPill).toBeVisible({ timeout: 5000 });
  await roomPill.hover();
  return roomPill;
}

/** Open the Room Editor modal for Fellowship (hover + click pencil). */
async function openEditor(page: import("@playwright/test").Page) {
  const roomPill = await hoverFellowship(page);
  const editBtn = roomPill.locator(".ei-control-btn[title='Edit Room']");
  await expect(editBtn).toBeVisible({ timeout: 3000 });
  await editBtn.click();
  const modal = page.locator(".ei-creator-modal");
  await expect(modal).toBeVisible({ timeout: 5000 });
  return modal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Room Edit (W6)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  // -------------------------------------------------------------------------
  // W6-1: Hovering room pill reveals pencil edit button
  // -------------------------------------------------------------------------
  test("hovering room pill reveals pencil edit button", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    // Wait for persona panel to load
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    // Switch to Rooms tab
    await openRoomsTab(page);

    // The Fellowship pill should be visible
    const roomPill = page.locator(".ei-room-pill", { hasText: "Fellowship" });
    await expect(roomPill).toBeVisible({ timeout: 5000 });

    // Edit controls should NOT be visible before hover
    await expect(roomPill.locator(".ei-room-pill__controls")).not.toBeVisible();

    // Hover over the room pill
    await roomPill.hover();

    // Edit button should now appear with "Edit Room" title
    const editBtn = roomPill.locator(".ei-control-btn[title='Edit Room']");
    await expect(editBtn).toBeVisible({ timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // W6-2: Clicking pencil opens room editor modal pre-populated with room data
  // -------------------------------------------------------------------------
  test("clicking pencil opens room editor modal pre-populated with room data", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });
    await openRoomsTab(page);

    const modal = await openEditor(page);

    // Modal title should say "Edit Room"
    await expect(modal.locator("#room-editor-modal-title")).toHaveText("Edit Room");

    // Name input should be pre-populated with "Fellowship"
    await expect(modal.locator("input.ei-input")).toHaveValue("Fellowship");

    // Free For All radio should be selected
    const ffaRadio = modal.locator('input[type="radio"][value="free_for_all"]');
    await expect(ffaRadio).toBeChecked();
  });

  // -------------------------------------------------------------------------
  // W6-3: Editing room display_name updates the room pill
  // -------------------------------------------------------------------------
  test("editing room display_name updates the room pill", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });
    await openRoomsTab(page);

    const modal = await openEditor(page);

    // Clear the name input and type a new name
    const nameInput = modal.locator("input.ei-input");
    await nameInput.clear();
    await nameInput.fill("The Shire");

    // Click "Save Changes"
    await modal.locator(".ei-btn--primary", { hasText: "Save Changes" }).click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Room pill should now show the new name
    await expect(page.locator(".ei-room-pill", { hasText: "The Shire" })).toBeVisible({ timeout: 5000 });

    // Original name should be gone
    await expect(page.locator(".ei-room-pill", { hasText: "Fellowship" })).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // W6-4: Cancel closes modal without saving
  // -------------------------------------------------------------------------
  test("cancel closes modal without saving", async ({ page, mockServerUrl }) => {
    await seedOneFfaRoom(page, mockServerUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });
    await openRoomsTab(page);

    const modal = await openEditor(page);

    // Change the name
    const nameInput = modal.locator("input.ei-input");
    await nameInput.clear();
    await nameInput.fill("Mordor");

    // Click "Cancel" — this triggers the dirty-check confirm dialog
    await modal.locator(".ei-btn--secondary", { hasText: "Cancel" }).click();

    // The discard confirm prompt should appear — click "Discard"
    await expect(modal.locator("text=Discard unsaved changes?")).toBeVisible({ timeout: 3000 });
    await modal.locator(".ei-btn--primary", { hasText: "Discard" }).click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Room pill should still show the original name
    await expect(page.locator(".ei-room-pill", { hasText: "Fellowship" })).toBeVisible({ timeout: 5000 });

    // The changed name should not appear
    await expect(page.locator(".ei-room-pill", { hasText: "Mordor" })).not.toBeVisible();
  });
});
