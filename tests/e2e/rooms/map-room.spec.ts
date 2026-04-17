import { test, expect } from "../fixtures.js";

function createMAPRoomCheckpoint(mockServerUrl: string) {
  const timestamp = new Date().toISOString();

  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: {
        ceremony: {
          time: "23:59",
        },
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
            created_at: timestamp,
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
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [
          {
            id: "msg-0",
            role: "assistant",
            verbal_response:
              "Hello! I'm Ei, your personal companion. I'm here to chat, learn about you, and grow alongside you. What's on your mind today?",
            timestamp,
          },
        ],
      },
      "007": {
        entity: {
          entity: "system",
          id: "007",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise advisor",
          long_description: "A thoughtful and wise persona",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [],
      },
      "oracle-judge": {
        entity: {
          entity: "system",
          id: "oracle-judge",
          display_name: "Oracle",
          aliases: ["Oracle"],
          short_description: "The impartial judge",
          long_description: "An impartial judge who evaluates responses",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [],
      },
    },
    rooms: {
      "map-room-1": {
        id: "map-room-1",
        display_name: "Test MAP Room",
        entity: "room",
        mode: "messages_against_persona",
        persona_ids: ["ei", "007", "oracle-judge"],
        judge_persona_id: "oracle-judge",
        active_node_id: "map-seed-msg",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        capture_used: false,
        messages: [
          {
            id: "map-seed-msg",
            parent_id: null,
            role: "human",
            verbal_response: "Starting the MAP room",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-ei-response",
            parent_id: "map-seed-msg",
            role: "persona",
            persona_id: "ei",
            verbal_response: "My MAP response",
            timestamp,
            read: false,
            context_status: "default",
          },
          {
            id: "map-007-response",
            parent_id: "map-seed-msg",
            role: "persona",
            persona_id: "007",
            verbal_response: "My MAP response",
            timestamp,
            read: false,
            context_status: "default",
          },
        ],
      },
    },
    queue: [],
    providers: [],
    tools: [],
    settings: {},
  };
}

function createMAPCompletedRoundCheckpoint(mockServerUrl: string) {
  const timestamp = new Date().toISOString();

  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: {
        ceremony: {
          time: "23:59",
          last_ceremony: timestamp,
        },
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
            created_at: timestamp,
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
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [],
      },
      "007": {
        entity: {
          entity: "system",
          id: "007",
          display_name: "Sage",
          aliases: ["Sage"],
          short_description: "A wise advisor",
          long_description: "A thoughtful and wise persona",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [],
      },
      "oracle-judge": {
        entity: {
          entity: "system",
          id: "oracle-judge",
          display_name: "Oracle",
          aliases: ["Oracle"],
          short_description: "The impartial judge",
          long_description: "An impartial judge who evaluates responses",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: [],
      },
    },
    rooms: {
      "map-room-1": {
        id: "map-room-1",
        display_name: "Test MAP Room",
        entity: "room",
        mode: "messages_against_persona",
        persona_ids: ["ei", "007", "oracle-judge"],
        judge_persona_id: "oracle-judge",
        // active_node_id points to the winner so the active path is:
        //   map-seed-msg → map-round2-msg → map-ei-response
        // giving two human messages and one persona winner, producing a completed round row.
        active_node_id: "map-ei-response",
        is_archived: false,
        created_at: timestamp,
        last_updated: timestamp,
        last_activity: timestamp,
        capture_used: false,
        messages: [
          {
            id: "map-seed-msg",
            parent_id: null,
            role: "human",
            verbal_response: "Starting the MAP room",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-round2-msg",
            parent_id: "map-seed-msg",
            role: "human",
            verbal_response: "Which response is best?",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-ei-response",
            parent_id: "map-round2-msg",
            role: "persona",
            persona_id: "ei",
            verbal_response: "My winning response",
            timestamp,
            read: true,
            context_status: "default",
          },
          {
            id: "map-verdict",
            parent_id: "map-ei-response",
            role: "persona",
            persona_id: "oracle-judge",
            silence_reason: "Best answer",
            timestamp,
            read: true,
            context_status: "default",
          },
        ],
      },
    },
    queue: [],
    providers: [],
    tools: [],
    settings: {},
  };
}

test.describe("MAP Room — activation cycle (W3)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseOverrides();
    mockServer.clearResponseQueue();
  });

  test("MAP room hides persona responses until judge picks winner", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "My MAP response",
      }),
      statusCode: 200,
    });

    const checkpoint = createMAPRoomCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await expect(
      page.locator(".ei-panel-tab").filter({ hasText: "Rooms" })
    ).toBeVisible({ timeout: 10000 });
    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    const input = page.locator("textarea");
    await input.fill("Which response is best?");
    await input.press("Enter");

    await expect(page.locator(".ei-room-status__activate")).toBeVisible({ timeout: 10000 });

    const personaMessages = page.locator(".ei-room-message-wrapper.persona");
    await expect(personaMessages).toHaveCount(0, { timeout: 1000 });
  });

  test("MAP room shows activate button after all personas respond", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "My MAP response",
      }),
      statusCode: 200,
    });

    const checkpoint = createMAPRoomCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    const input = page.locator("textarea");
    await input.fill("Which response is best?");
    await input.press("Enter");

    await expect(page.locator(".ei-room-status__activate")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".ei-room-status__activate")).toContainText(
      "Activate"
    );
  });

  test("MAP room shows judge verdict after activation", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: "My MAP response",
      statusCode: 200,
      delayMs: 500,
    });
    mockServer.setResponseForType("room-judge", {
      type: "fixed",
      content: JSON.stringify({
        winner_message_id: "map-ei-response",
        reason: "Best answer",
      }),
      statusCode: 200,
    });

    const checkpoint = createMAPRoomCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    const input = page.locator("textarea");
    await input.fill("Which response is best?");
    await input.press("Enter");

    await expect(page.locator(".ei-room-status__activate")).toBeVisible({
      timeout: 20000,
    });
    await page.locator(".ei-room-status__activate").click();

    await expect(
      page.locator(".ei-room-message__silence")
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".ei-room-message__silence")).toContainText(
      "verdict"
    );
  });

  test("MAP overview shows MAP score table", async ({ page, mockServerUrl }) => {
    const checkpoint = createMAPCompletedRoundCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await expect(
      page.locator(".ei-panel-tab").filter({ hasText: "Rooms" })
    ).toBeVisible({ timeout: 10000 });
    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    await expect(page.locator('button[title="Overview"]')).toBeVisible({ timeout: 5000 });
    await page.locator('button[title="Overview"]').click();

    await expect(page.locator(".ei-map-score")).toBeVisible({ timeout: 5000 });
  });

  test("MAP overview shows winner name in scoreboard", async ({ page, mockServerUrl }) => {
    const checkpoint = createMAPCompletedRoundCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await expect(
      page.locator(".ei-panel-tab").filter({ hasText: "Rooms" })
    ).toBeVisible({ timeout: 10000 });
    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    await expect(page.locator('button[title="Overview"]')).toBeVisible({ timeout: 5000 });
    await page.locator('button[title="Overview"]').click();

    await expect(page.locator(".ei-map-score")).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(".ei-map-score__winner--name").filter({ hasText: "Ei" })
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(".ei-map-score__winner--name").filter({ hasText: "Ei" })
    ).toContainText("(1)");
  });

  test("MAP judge verdict does not say chose-not-to-respond", async ({
    page,
    mockServer,
    mockServerUrl,
  }) => {
    mockServer.setResponseForType("room-response", {
      type: "fixed",
      content: "My MAP response",
      statusCode: 200,
      delayMs: 500,
    });
    mockServer.setResponseForType("room-judge", {
      type: "fixed",
      content: JSON.stringify({
        winner_message_id: "map-ei-response",
        reason: "Best answer",
      }),
      statusCode: 200,
    });

    const checkpoint = createMAPRoomCheckpoint(mockServerUrl);
    await page.addInitScript(
      ({ data }: { data: unknown }) => {
        localStorage.clear();
        localStorage.setItem("ei_state", JSON.stringify(data));
      },
      { data: checkpoint }
    );

    await page.goto("/");

    await page.locator(".ei-panel-tab").filter({ hasText: "Rooms" }).click();

    await expect(page.locator(".ei-room-pill")).toBeVisible({ timeout: 5000 });
    await page.locator(".ei-room-pill").click();

    const input = page.locator("textarea");
    await input.fill("Which response is best?");
    await input.press("Enter");

    await expect(page.locator(".ei-room-status__activate")).toBeVisible({
      timeout: 20000,
    });
    await page.locator(".ei-room-status__activate").click();

    await expect(
      page.locator(".ei-room-message__silence")
    ).toBeVisible({ timeout: 20000 });

    await expect(page.locator(".ei-room-message__silence")).not.toContainText(
      "chose not to respond"
    );
  });
});
