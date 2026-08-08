// Tested by Beta — 2026-08-08
import type { Page } from "@playwright/test";
import { test, expect, selectEiPersona } from "./fixtures.js";
import { ContextStatus, ProviderType } from "../../src/core/types.js";
import type { StorageState } from "../../src/core/types.js";

const STATE_KEY = "ei_state";
const SENTINEL_FACT_NAME = "Storage fallback sentinel";
const ORIGINAL_DESCRIPTION = "This fact must remain available when IndexedDB fails after its availability check.";
const UPDATED_DESCRIPTION = "This edited fact must survive the IndexedDB fallback save and reload cycle.";

declare global {
  interface Window {
    __processor?: {
      getHuman(): Promise<{ facts: Array<{ id: string; description: string }> }>;
    };
  }
}

function createReturningUserCheckpoint(mockServerUrl: string): StorageState {
  const timestamp = new Date().toISOString();

  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [
        {
          id: "storage-fallback-sentinel",
          name: SENTINEL_FACT_NAME,
          description: ORIGINAL_DESCRIPTION,
          sentiment: 0,
          validated_date: timestamp,
          last_updated: timestamp,
        },
      ],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      settings: {
        default_model: "Mock LLM:mock-model",
        ceremony: {
          time: "09:00",
          last_ceremony: timestamp,
        },
        accounts: [
          {
            id: "mock-llm-account",
            name: "Mock LLM",
            type: ProviderType.LLM,
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
          is_paused: false,
          is_archived: false,
          is_static: true,
          last_updated: timestamp,
        },
        messages: [
          {
            id: "msg-0",
            role: "system",
            content: "Welcome back. Your saved facts are ready.",
            timestamp,
            read: true,
            context_status: ContextStatus.Default,
          },
        ],
      },
    },
    queue: [],
    providers: [],
    tools: [],
  };
}

async function openFacts(page: Page) {
  await page.locator('button[aria-label="Menu"]').click();
  await page.locator('.ei-hamburger-menu__item:has-text("My Data")').click();
  await page.locator('button[role="tab"]').filter({ hasText: "Facts" }).click();
}

function isFallbackWarning(message: string): boolean {
  return /usual browser storage.*indexeddb/i.test(message)
    && /limited fallback/i.test(message)
    && /data has not been erased/i.test(message);
}

test.describe("IndexedDB storage fallback", () => {
  test("preserves returning-user facts through a fallback save and reload", async ({ page, mockServerUrl }) => {
    const checkpoint = createReturningUserCheckpoint(mockServerUrl);
    const dialogs: Array<{ type: string; message: string }> = [];

    await page.addInitScript(({ key, data }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(data));
      }
    }, { key: STATE_KEY, data: checkpoint });

    await page.addInitScript(() => {
      const nativeOpen = indexedDB.open.bind(indexedDB);
      let openCount = 0;

      indexedDB.open = (name: string, version?: number) => {
        openCount += 1;
        if (openCount === 1) {
          return nativeOpen(name, version);
        }
        throw new DOMException("E2E IndexedDB load failure", "InvalidStateError");
      };
    });

    page.on("dialog", async (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });
    await page.route("**/jsdelivr.net/**", (route) => route.abort());
    await page.route("**/huggingface.co/**", (route) => route.abort());

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await expect.poll(
      () => dialogs.find((dialog) => dialog.type === "alert" && isFallbackWarning(dialog.message))?.message ?? "",
      { timeout: 5000 },
    ).toMatch(/usual browser storage.*indexeddb/i);

    const initialWarningMessage = dialogs.find(
      (dialog) => dialog.type === "alert" && isFallbackWarning(dialog.message),
    )?.message ?? "";
    expect(initialWarningMessage).toMatch(/usual browser storage.*indexeddb/i);
    expect(initialWarningMessage).toMatch(/limited fallback/i);
    expect(initialWarningMessage).toMatch(/data has not been erased/i);

    await selectEiPersona(page);
    await openFacts(page);

    const sentinelCard = page
      .locator(".ei-data-card")
      .filter({ has: page.locator(`input.ei-data-card__name[value="${SENTINEL_FACT_NAME}"]`) });
    const description = sentinelCard.locator(".ei-data-card__description");

    await expect(sentinelCard).toBeVisible({ timeout: 10000 });
    await expect(sentinelCard.locator(".ei-data-card__name")).toHaveValue(SENTINEL_FACT_NAME);
    await expect(description).toHaveValue(ORIGINAL_DESCRIPTION);

    await description.fill(UPDATED_DESCRIPTION);
    await expect(sentinelCard).toHaveClass(/ei-data-card--dirty/);
    await page.locator(".ei-tab-container__content").click({ position: { x: 10, y: 10 } });
    await expect(sentinelCard).not.toHaveClass(/ei-data-card--dirty/, { timeout: 8000 });
    await expect(description).toHaveValue(UPDATED_DESCRIPTION);
    await expect.poll(async () => page.evaluate(async (factId) => {
      const human = await window.__processor?.getHuman();
      return human?.facts.find((fact) => fact.id === factId)?.description;
    }, "storage-fallback-sentinel"), { timeout: 5000 }).toBe(UPDATED_DESCRIPTION);
    await page.waitForTimeout(150);

    const warningCountBeforeReload = dialogs.filter((dialog) => (
      dialog.type === "alert" && isFallbackWarning(dialog.message)
    )).length;

    await page.reload();
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await expect.poll(
      () => dialogs.filter((dialog) => dialog.type === "alert" && isFallbackWarning(dialog.message)).length,
      { timeout: 5000 },
    ).toBeGreaterThan(warningCountBeforeReload);

    await selectEiPersona(page);
    await openFacts(page);

    const reloadedSentinelCard = page
      .locator(".ei-data-card")
      .filter({ has: page.locator(`input.ei-data-card__name[value="${SENTINEL_FACT_NAME}"]`) });
    await expect(reloadedSentinelCard).toBeVisible({ timeout: 10000 });
    await expect(reloadedSentinelCard.locator(".ei-data-card__name")).toHaveValue(SENTINEL_FACT_NAME);
    await expect(reloadedSentinelCard.locator(".ei-data-card__description")).toHaveValue(UPDATED_DESCRIPTION);
  });
});
