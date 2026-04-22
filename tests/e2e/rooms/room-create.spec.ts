import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

const ROOM_MOCK_RESPONSE = {
  type: "fixed" as const,
  content: JSON.stringify({ should_respond: true, content: "Mock room response" }),
  statusCode: 200,
};

const MODE_LABELS: Record<"ffa" | "map" | "cyp", string> = {
  ffa: "Free For All (FFA)",
  map: "Messages Against Persona (MAP)",
  cyp: "Choose Your Path (CYP)",
};

async function seedTwoPersonasNoRooms(
  page: import("@playwright/test").Page,
  mockServerUrl: string
) {
  const base = createMinimalCheckpoint(mockServerUrl);
  const timestamp = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: any = {
    ...base,
    rooms: {},
    personas: {
      ...base.personas,
      sage: {
        entity: {
          entity: "persona",
          id: "sage",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise advisor",
          long_description: "An ancient, thoughtful guide",
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
  };
  await page.addInitScript(
    ({ key, data }: { key: string; data: unknown }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: "ei_state", data: state }
  );
}

async function openNewRoomModal(page: import("@playwright/test").Page) {
  await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
  await page.locator(".ei-btn--primary", { hasText: "+ New" }).click();
  await expect(page.locator(".ei-creator-modal")).toBeVisible({ timeout: 5000 });
}

async function fillRoomForm(
  page: import("@playwright/test").Page,
  options: {
    name: string;
    mode: "ffa" | "map" | "cyp";
    participantNames: string[];
    judgeName?: string;
    initialMessage?: string;
  }
) {
  const modal = page.locator(".ei-creator-modal");
  await modal.locator("input.ei-input").fill(options.name);
  await modal.locator("label.ei-checkbox", { hasText: MODE_LABELS[options.mode] }).click();
  for (const name of options.participantNames) {
    await modal.locator("label.ei-checkbox").filter({ hasText: new RegExp(`^${name}$`) }).click();
  }
  if (options.mode === "map" && options.judgeName) {
    const judgeSelect = modal.locator("select.ei-input");
    await expect(judgeSelect).toBeVisible({ timeout: 3000 });
    await judgeSelect.selectOption({ label: options.judgeName });
  }
  await modal.locator("textarea.ei-textarea").fill(options.initialMessage ?? "Hello room!");
}

test.describe("Room Creation (W1)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("can create FFA room via New Room button", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("room-response", ROOM_MOCK_RESPONSE);

    await seedTwoPersonasNoRooms(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openNewRoomModal(page);
    await fillRoomForm(page, { name: "FFA Test Room", mode: "ffa", participantNames: ["Ei", "Sage"] });
    await page.locator(".ei-creator-modal").locator(".ei-btn--primary", { hasText: "Create Room" }).click();

    await expect(page.locator(".ei-creator-modal")).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(".ei-room-pill", { hasText: "FFA Test Room" })).toBeVisible({ timeout: 10000 });
  });

  test("can create MAP room with judge selection", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("room-response", ROOM_MOCK_RESPONSE);

    await seedTwoPersonasNoRooms(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openNewRoomModal(page);

    const modal = page.locator(".ei-creator-modal");
    await modal.locator("input.ei-input").fill("MAP Test Room");
    await modal.locator("label.ei-checkbox", { hasText: MODE_LABELS.map }).click();
    await modal.locator("label.ei-checkbox").filter({ hasText: /^Ei$/ }).click();
    await modal.locator("label.ei-checkbox").filter({ hasText: /^Sage$/ }).click();

    const judgeSelect = modal.locator("select.ei-input");
    await expect(judgeSelect).toBeVisible({ timeout: 3000 });
    await judgeSelect.selectOption({ label: "Sage" });

    await modal.locator("textarea.ei-textarea").fill("Debate topic: AI ethics");
    await modal.locator(".ei-btn--primary", { hasText: "Create Room" }).click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(".ei-room-pill", { hasText: "MAP Test Room" })).toBeVisible({ timeout: 10000 });
  });

  test("can create CYP room and mode badge shows CYP", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("room-response", ROOM_MOCK_RESPONSE);

    await seedTwoPersonasNoRooms(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openNewRoomModal(page);
    await fillRoomForm(page, { name: "CYP Test Room", mode: "cyp", participantNames: ["Ei", "Sage"] });
    await page.locator(".ei-creator-modal").locator(".ei-btn--primary", { hasText: "Create Room" }).click();

    await expect(page.locator(".ei-creator-modal")).not.toBeVisible({ timeout: 5000 });

    const roomPill = page.locator(".ei-room-pill", { hasText: "CYP Test Room" });
    await expect(roomPill).toBeVisible({ timeout: 10000 });
    await expect(roomPill.locator(".ei-room-pill__mode-badge--cyp")).toBeVisible({ timeout: 5000 });
    await expect(roomPill.locator(".ei-room-pill__mode-badge--cyp")).toContainText("CYP");
  });

  test("clicking created room opens room chat panel", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("room-response", ROOM_MOCK_RESPONSE);

    await seedTwoPersonasNoRooms(page, mockServerUrl);
    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toBeVisible({ timeout: 10000 });

    await openNewRoomModal(page);
    await fillRoomForm(page, { name: "Chat Panel Room", mode: "ffa", participantNames: ["Ei", "Sage"] });
    await page.locator(".ei-creator-modal").locator(".ei-btn--primary", { hasText: "Create Room" }).click();

    await expect(page.locator(".ei-creator-modal")).not.toBeVisible({ timeout: 5000 });

    const roomPill = page.locator(".ei-room-pill", { hasText: "Chat Panel Room" });
    await expect(roomPill).toBeVisible({ timeout: 10000 });
    await roomPill.click();

    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });
  });
});
