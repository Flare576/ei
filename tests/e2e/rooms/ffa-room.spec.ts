import { test, expect, createMinimalCheckpoint } from "../fixtures.js";

test.use({ browserName: "chromium" });

const STATE_KEY = "ei_state";

function buildFfaCheckpoint(mockServerUrl: string) {
  const checkpoint = createMinimalCheckpoint(mockServerUrl) as unknown as Record<string, unknown>;
  const timestamp = new Date().toISOString();

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
      heartbeat_delay_ms: 999999999,
    },
    messages: [],
  };

  const eiPersonas = checkpoint.personas as Record<string, { entity: Record<string, unknown> }>;
  if (eiPersonas["ei"]) {
    eiPersonas["ei"].entity.heartbeat_delay_ms = 999999999;
    eiPersonas["ei"].entity.last_heartbeat = timestamp;
    eiPersonas["ei"].entity.last_activity = timestamp;
  }

  const initialMessageId = "ffa-initial-msg-001";
  checkpoint.rooms = {
    "fellowship-room": {
      id: "fellowship-room",
      entity: "room",
      display_name: "Fellowship",
      mode: "free_for_all",
      persona_ids: ["ei", "007"],
      judge_persona_id: null,
      active_node_id: initialMessageId,
      is_archived: false,
      messages: [
        {
          id: initialMessageId,
          parent_id: null,
          role: "human",
          content: "Let's begin.",
          timestamp,
          read: true,
          context_status: "default",
        },
        {
          id: "ffa-initial-ei-response",
          parent_id: initialMessageId,
          role: "persona",
          persona_id: "ei",
          content: "Hello! Ready to chat.",
          timestamp,
          read: true,
          context_status: "default",
        },
        {
          id: "ffa-initial-sage-response",
          parent_id: initialMessageId,
          role: "persona",
          persona_id: "007",
          content: "Greetings, indeed.",
          timestamp,
          read: true,
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

test.describe("FFA Room message flow", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("FFA room appears in sidebar and can be selected", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();

    const roomPill = page.locator(".ei-room-pill").filter({ hasText: "Fellowship" });
    await expect(roomPill).toBeVisible({ timeout: 10000 });
    await expect(roomPill.locator(".ei-room-pill__mode-badge--ffa")).toBeVisible();

    await roomPill.click();

    await expect(page.locator(".ei-room-chat-panel__title")).toContainText("Fellowship", {
      timeout: 5000,
    });
    await expect(page.locator(".ei-room-chat-panel__mode--ffa")).toBeVisible({ timeout: 5000 });
  });

  test("sending message in FFA room triggers persona responses", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: "Mock persona response",
      statusCode: 200,
    });

    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
    await page.locator(".ei-room-pill").filter({ hasText: "Fellowship" }).click();
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });

    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("Hello everyone!");
    await textarea.press("Enter");

    await expect(page.locator(".ei-room-message-wrapper.human").last()).toBeVisible({ timeout: 5000 });

    await expect(page.locator("text=Mock persona response").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator("text=Mock persona response")).toHaveCount(2, { timeout: 5000 });
  });

  test("FFA room shows thinking indicators while personas process", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: "Mock persona response",
      statusCode: 200,
    });

    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
    await page.locator(".ei-room-pill").filter({ hasText: "Fellowship" }).click();
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });

    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("Are you there?");
    await textarea.press("Enter");

    const thinkingOrStatus = page.locator(".ei-room-thinking__item, .ei-room-status--ffa");
    await expect(thinkingOrStatus.first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator("text=Mock persona response").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator("text=Mock persona response")).toHaveCount(2, { timeout: 5000 });
  });

  test("FFA room per-speaker attribution shows persona name", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: "Mock persona response",
      statusCode: 200,
    });

    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
    await page.locator(".ei-room-pill").filter({ hasText: "Fellowship" }).click();
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });

    const textarea = page.locator(".ei-room-chat-panel textarea");
    await textarea.fill("Introduce yourselves!");
    await textarea.press("Enter");

    await expect(
      page.locator(".ei-room-message-wrapper.persona")
    ).toHaveCount(4, { timeout: 30000 });

    const speakerNames = page.locator(".ei-room-message__speaker-name");
    const allNames = await speakerNames.allTextContents();
    expect(allNames).toContain("Ei");
    expect(allNames).toContain("Sage");
  });
});

test.describe("FFA Room context overview (web)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("root row has no delete button in FFA context view", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
    await page.locator(".ei-room-pill").filter({ hasText: "Fellowship" }).click();
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });

    await page.locator('button[aria-label="Overview"]').click();
    await expect(page.locator(".ei-ffa-context")).toBeVisible({ timeout: 5000 });

    const rows = page.locator(".ei-ffa-context__row");
    const firstRow = rows.first();

    await expect(firstRow.locator(".ei-ffa-context__delete-btn")).toHaveCount(0);
  });

  test("status badge cycles default → always → never on click", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildFfaCheckpoint(mockServerUrl);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab", { hasText: "Rooms" }).click();
    await page.locator(".ei-room-pill").filter({ hasText: "Fellowship" }).click();
    await expect(page.locator(".ei-room-chat-panel")).toBeVisible({ timeout: 5000 });

    await page.locator('button[aria-label="Overview"]').click();
    await expect(page.locator(".ei-ffa-context")).toBeVisible({ timeout: 5000 });

    const firstStatus = page.locator(".ei-ffa-context__status-btn").first();

    await expect(firstStatus).toContainText("Default");

    await firstStatus.click();
    await expect(firstStatus).toContainText("Always");

    await firstStatus.click();
    await expect(firstStatus).toContainText("Never");

    await firstStatus.click();
    await expect(firstStatus).toContainText("Default");
  });
});
