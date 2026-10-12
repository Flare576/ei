import type { Page } from "@playwright/test";
import type { ToolCallRecord } from "../../src/core/types/llm.js";
import type { Processor } from "../../src/core/processor.js";
import { expect, seedCheckpoint, selectEiPersona, test, type CheckpointMessage } from "./fixtures.js";

const MESSAGE_COUNT = 60;
const TOOL_MESSAGE_ID = `msg-${MESSAGE_COUNT - 1}`;
const ICON_NAME = "Show tool calls (includes write)";

const TOOL_CALLS: ToolCallRecord[] = [
  { name: "find_memory", arguments: { query: "birthday" }, result: "nothing found", error: false, kind: "read" },
  {
    name: "edit_trait",
    arguments: { action: "update", id: "T1", name: "Curious", sentiment: 0.5 },
    result: "trait updated",
    error: false,
    kind: "write",
  },
];

function seedMessages(): CheckpointMessage[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    role: "system",
    content: `Persona reply number ${i}`,
    ...(i === MESSAGE_COUNT - 1 && { tool_calls: TOOL_CALLS }),
  }));
}

type QueueProbe = {
  resume: number;
  abort: number;
  pendingStatusReads: Promise<unknown>[];
};

// `__processor` is declared by other specs with their own member lists; redeclaring it here would
// conflict, so only the probe this spec installs is declared and the processor is narrowed below.
declare global {
  interface Window {
    __queueProbe?: QueueProbe;
  }
}

type ObservedProcessor = Pick<Processor, "resumeQueue" | "abortCurrentOperation" | "getQueueStatus">;

async function openChat(page: Page, mockServerUrl: string): Promise<void> {
  await seedCheckpoint(page, mockServerUrl, seedMessages());
  await page.goto("/");
  await selectEiPersona(page);
  await expect(page.locator(`[data-message-id="${TOOL_MESSAGE_ID}"]`)).toBeVisible();
}

/** Tab from the row's preceding action button until the tool-call icon takes focus. */
async function tabToIcon(page: Page): Promise<void> {
  const icon = page.getByRole("button", { name: ICON_NAME });
  await page.locator(`[data-message-id="${TOOL_MESSAGE_ID}"] .ei-message__scissors`).focus();
  for (let presses = 0; presses < 3; presses++) {
    await page.keyboard.press("Tab");
    if (await icon.evaluate((el) => el === document.activeElement)) return;
  }
  await expect(icon).toBeFocused();
}

/**
 * Wraps the running App's Processor so every resume/abort is counted and every status read is
 * remembered, then calls straight through to the original method.
 */
async function observeQueue(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidate: unknown = Reflect.get(window, "__processor");
    const isObserved = (value: unknown): value is ObservedProcessor =>
      typeof value === "object" &&
      value !== null &&
      typeof Reflect.get(value, "resumeQueue") === "function" &&
      typeof Reflect.get(value, "abortCurrentOperation") === "function" &&
      typeof Reflect.get(value, "getQueueStatus") === "function";
    if (!isObserved(candidate)) throw new Error("window.__processor is not exposed by the running app");
    const processor = candidate;
    const probe: QueueProbe = { resume: 0, abort: 0, pendingStatusReads: [] };
    const resumeQueue = processor.resumeQueue.bind(processor);
    const abortCurrentOperation = processor.abortCurrentOperation.bind(processor);
    const getQueueStatus = processor.getQueueStatus.bind(processor);
    processor.resumeQueue = (...args) => {
      probe.resume++;
      return resumeQueue(...args);
    };
    processor.abortCurrentOperation = (...args) => {
      probe.abort++;
      return abortCurrentOperation(...args);
    };
    processor.getQueueStatus = (...args) => {
      const read = getQueueStatus(...args);
      probe.pendingStatusReads.push(read);
      return read;
    };
    window.__queueProbe = probe;
  });
}

async function resetQueueCounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__queueProbe;
    if (!probe) throw new Error("queue probe is not installed");
    probe.resume = 0;
    probe.abort = 0;
  });
}

/**
 * Waits until every status read the Escape path started has resolved, yields one macrotask so the
 * continuation that follows the read (resume or abort) has run, and returns the resulting counts.
 */
async function settleQueueCounts(page: Page): Promise<{ resume: number; abort: number }> {
  return page.evaluate(async () => {
    const probe = window.__queueProbe;
    if (!probe) throw new Error("queue probe is not installed");
    await Promise.all(probe.pendingStatusReads.splice(0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.all(probe.pendingStatusReads.splice(0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { resume: probe.resume, abort: probe.abort };
  });
}

function pauseControl(page: Page) {
  return page.locator(".ei-control-area__status button.ei-btn--icon");
}

test.describe("tool-call modal in a real browser", () => {
  test("Tab reaches the icon, Enter opens the modal, Tab and Shift+Tab stay inside it", async ({ page, mockServerUrl }) => {
    await openChat(page, mockServerUrl);
    await tabToIcon(page);

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: /tool calls/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("find_memory");
    await expect(dialog).toContainText("edit_trait");
    await expect(dialog).toContainText("action: update");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    const close = dialog.getByRole("button", { name: "Close tool calls" });
    for (const key of ["Tab", "Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(close).toBeFocused();
    }
  });

  test("Space opens the modal; its overlay covers the viewport and it survives its source row being scrolled out", async ({ page, mockServerUrl }) => {
    await openChat(page, mockServerUrl);
    await tabToIcon(page);

    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name: /tool calls/i });
    await expect(dialog).toBeVisible();

    const overlay = page.locator(".ei-tool-calls-overlay");
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await overlay.boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: viewport!.width, height: viewport!.height });
    expect(await dialog.evaluate((el) => el.closest("[data-index]"))).toBeNull();

    await page.locator(".ei-chat-panel__messages").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.locator(`[data-message-id="${TOOL_MESSAGE_ID}"]`)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("find_memory");
    await expect(dialog).toContainText("trait updated");
  });

  for (const startingState of ["running", "paused"] as const) {
    test(`Escape in the modal closes it and returns focus to the icon without touching the queue (${startingState} start)`, async ({ page, mockServerUrl }) => {
      await openChat(page, mockServerUrl);
      const expectedLabel = startingState === "paused" ? "Resume" : "Pause";
      const expectedTitle = `${expectedLabel} (Escape)`;
      if (startingState === "paused") {
        await pauseControl(page).click();
      }
      await expect(pauseControl(page)).toHaveAttribute("title", expectedTitle);
      await observeQueue(page);

      await tabToIcon(page);
      const icon = page.getByRole("button", { name: ICON_NAME });
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: /tool calls/i });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      await resetQueueCounts(page);
      await page.keyboard.press("Escape");
      const afterClose = await settleQueueCounts(page);

      expect(afterClose).toEqual({ resume: 0, abort: 0 });
      await expect(dialog).toBeHidden();
      await expect(icon).toBeFocused();
      await expect(pauseControl(page)).toHaveAttribute("title", expectedTitle);

      // Same observation and settling path with no modal open: the global shortcut still works.
      await resetQueueCounts(page);
      await page.keyboard.press("Escape");
      const afterShortcut = await settleQueueCounts(page);

      if (startingState === "paused") {
        expect(afterShortcut).toEqual({ resume: 1, abort: 0 });
        await expect(pauseControl(page)).toHaveAttribute("title", "Pause (Escape)");
      } else {
        expect(afterShortcut).toEqual({ resume: 0, abort: 1 });
        await expect(pauseControl(page)).toHaveAttribute("title", "Resume (Escape)");
      }
    });
  }
});
