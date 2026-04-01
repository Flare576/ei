import { test, expect, createMinimalCheckpoint } from "./fixtures.js";

const STATE_KEY = "ei_state";

function buildCheckpointWithQueue(
  mockServerUrl: string,
  queueItems: object[]
) {
  const timestamp = new Date().toISOString();
  const base = createMinimalCheckpoint(mockServerUrl);
  const account = {
    id: "mock-llm-account",
    name: "Mock LLM",
    type: "llm",
    url: mockServerUrl,
    api_key: "",
    enabled: true,
    created_at: timestamp,
    models: [
      {
        id: "mock-model-id",
        name: "mock-model",
        created_at: timestamp,
      },
    ],
    default_model: "mock-model-id",
  };
  return {
    ...base,
    human: {
      ...base.human,
      settings: {
        ...base.human.settings,
        default_model: "Mock LLM:mock-model",
        accounts: [account],
      },
    },
    queue: queueItems,
  };
}

function makeDlqItem(id: string) {
  const timestamp = new Date().toISOString();
  return {
    id,
    created_at: timestamp,
    attempts: 3,
    last_attempt: timestamp,
    state: "dlq",
    type: "json",
    priority: "normal",
    next_step: "handleHeartbeatCheck",
    model: "Mock LLM:mock-model",
    system: "test system prompt",
    user: "test user prompt",
    data: { personaId: "ei" },
  };
}

function makePendingItemNoModel(id: string) {
  const farFuture = new Date(Date.now() + 3600000).toISOString();
  const timestamp = new Date().toISOString();
  return {
    id,
    created_at: timestamp,
    attempts: 0,
    state: "pending",
    retry_after: farFuture,
    type: "json",
    priority: "normal",
    next_step: "handleHeartbeatCheck",
    system: "test system prompt",
    user: "test user prompt",
    data: { personaId: "ei" },
  };
}

test.describe("Queue / DLQ Panel", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("queue panel opens with DLQ items visible", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildCheckpointWithQueue(mockServerUrl, [
      makeDlqItem("dlq-test-1"),
    ]);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    const dlqBadge = page.locator(".ei-control-area__dlq");
    await expect(dlqBadge).toBeVisible({ timeout: 5000 });
    await expect(dlqBadge).toContainText("[DLQ:1]");

    await dlqBadge.click();

    const queuePanel = page.locator(".ei-queue-panel");
    await expect(queuePanel).toBeVisible({ timeout: 5000 });

    const dlqItemBadge = queuePanel.locator(".ei-queue-panel__dlq-badge");
    await expect(dlqItemBadge).toBeVisible({ timeout: 5000 });
    await expect(dlqItemBadge).toContainText("DLQ");
  });

  test("delete a DLQ item reduces count and updates badge", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildCheckpointWithQueue(mockServerUrl, [
      makeDlqItem("dlq-test-1"),
      makeDlqItem("dlq-test-2"),
    ]);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    const dlqBadge = page.locator(".ei-control-area__dlq");
    await expect(dlqBadge).toBeVisible({ timeout: 5000 });
    await expect(dlqBadge).toContainText("[DLQ:2]");

    await dlqBadge.click();
    const queuePanel = page.locator(".ei-queue-panel");
    await expect(queuePanel).toBeVisible({ timeout: 5000 });

    const dlqListCheckboxes = queuePanel.locator(
      ".ei-queue-panel__list--dlq .ei-queue-panel__checkbox"
    );
    await expect(dlqListCheckboxes).toHaveCount(2, { timeout: 5000 });
    await dlqListCheckboxes.first().check();

    const deleteBtn = queuePanel.locator('button[aria-label="Delete selected"]');
    await expect(deleteBtn).toBeEnabled({ timeout: 3000 });
    await deleteBtn.click();

    const remainingDlqBadges = queuePanel.locator(".ei-queue-panel__dlq-badge");
    await expect(remainingDlqBadges).toHaveCount(1, { timeout: 5000 });

    await expect(dlqBadge).toContainText("[DLQ:1]", { timeout: 5000 });
  });

  test("save button disabled until model selected on pending item", async ({
    page,
    mockServerUrl,
  }) => {
    const checkpoint = buildCheckpointWithQueue(mockServerUrl, [
      makePendingItemNoModel("pending-test-1"),
    ]);

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: STATE_KEY, data: checkpoint }
    );

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", {
      timeout: 10000,
    });

    const statusText = page.locator(".ei-control-area__status-text--clickable");
    await expect(statusText).toBeVisible({ timeout: 5000 });
    await statusText.click();

    const queuePanel = page.locator(".ei-queue-panel");
    await expect(queuePanel).toBeVisible({ timeout: 5000 });

    const saveBtn = page.locator('button[aria-label="Update selected"]');
    await expect(saveBtn).toBeDisabled({ timeout: 3000 });

    const pendingListCheckboxes = queuePanel.locator(
      ".ei-queue-panel__list:not(.ei-queue-panel__list--dlq) .ei-queue-panel__checkbox"
    );
    await expect(pendingListCheckboxes).toHaveCount(1, { timeout: 5000 });
    await pendingListCheckboxes.first().check();

    await expect(saveBtn).toBeDisabled({ timeout: 3000 });

    const modelPicker = queuePanel.locator("#ei-queue-model-picker");
    await expect(modelPicker).toBeVisible({ timeout: 3000 });
    await modelPicker.selectOption({ index: 1 });

    await expect(saveBtn).toBeEnabled({ timeout: 3000 });
  });
});
