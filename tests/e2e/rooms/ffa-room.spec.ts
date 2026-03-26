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
    },
    messages: [],
  };

  checkpoint.rooms = {
    "fellowship-room": {
      id: "fellowship-room",
      entity: "room",
      display_name: "Fellowship",
      mode: "free_for_all",
      persona_ids: ["ei", "007"],
      judge_persona_id: null,
      active_node_id: null,
      is_archived: false,
      messages: [],
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
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Mock persona response",
      }),
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

    await expect(page.locator(".ei-room-message-wrapper.human")).toBeVisible({ timeout: 5000 });

    await expect(
      page.locator(".ei-room-message-wrapper.persona")
    ).toHaveCount(2, { timeout: 20000 });

    await expect(page.locator("text=Mock persona response").first()).toBeVisible({ timeout: 20000 });
  });

  test("FFA room shows thinking indicators while personas process", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Mock persona response",
      }),
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

    await expect(
      page.locator(".ei-room-message-wrapper.persona")
    ).toHaveCount(2, { timeout: 20000 });
  });

  test("FFA room per-speaker attribution shows persona name", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Mock persona response",
      }),
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
    ).toHaveCount(2, { timeout: 20000 });

    const speakerNames = page.locator(".ei-room-message__speaker-name");
    await expect(speakerNames).toHaveCount(2, { timeout: 5000 });

    const allNames = await speakerNames.allTextContents();
    expect(allNames).toContain("Ei");
    expect(allNames).toContain("Sage");
  });
});
