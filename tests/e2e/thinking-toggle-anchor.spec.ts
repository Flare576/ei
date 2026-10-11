import type { Page } from "@playwright/test";
import { expect, seedCheckpoint, selectEiPersona, test, type CheckpointMessage } from "./fixtures.js";

const MESSAGE_COUNT = 80;
// Observation of a toggle: the requested change must be visible and the geometry must agree over this
// many consecutive looks, spaced this far apart, before anything is compared with the pre-click position.
const SETTLE_CONSECUTIVE_LOOKS = 12;
const SETTLE_INTERVAL_MS = 100;
const SETTLE_EPSILON_PX = 1;
const SETTLE_TIMEOUT_MS = 20_000;
const LATE_RECHECK_MS = 600;
// Pixels of slack for sub-pixel layout and borders when comparing a row to the scroller's box.
const TOLERANCE_PX = 2;
// How far the clicked reply may move on screen where the list has room to keep it exactly in place.
const HELD_IN_PLACE_PX = 4;

type Position = "middle" | "near-bottom" | "bottom";

interface ReplyBox {
  /** Reply top, relative to the top of the scrolling chat container. */
  top: number;
  bottom: number;
  containerHeight: number;
}

interface Fixture {
  name: string;
  viewport: { width: number; height: number };
  thinking: (messageIndex: number) => string;
}

/** Every reply carries seven lines of thinking, so toggling it changes the height of every row. */
const FIXTURES: Fixture[] = [
  {
    name: "short thinking lines",
    viewport: { width: 1280, height: 720 },
    thinking: (i) =>
      Array.from({ length: 7 }, (_, line) => `Thinking line ${line + 1} of message ${i}: weighing the options carefully before answering.`).join("\n"),
  },
  {
    // An unbroken run of letters wraps character by character in the narrow bubble, so each row
    // ends up several times taller than its width-based height estimate.
    name: "tall wrapped thinking",
    viewport: { width: 1280, height: 720 },
    thinking: (i) => Array.from({ length: 7 }, (_, line) => `Thought ${i} line ${line} ${"T".repeat(90)}`).join("\n"),
  },
  {
    name: "tall wrapped thinking in a tall window",
    viewport: { width: 1280, height: 1200 },
    thinking: (i) => Array.from({ length: 7 }, (_, line) => `Thought ${i} line ${line} ${"T".repeat(90)}`).join("\n"),
  },
];

function seedMessages(fixture: Fixture): CheckpointMessage[] {
  return Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    role: "system",
    content: `Persona reply number ${i}`,
    thinking: fixture.thinking(i),
  }));
}

function scroller(page: Page) {
  return page.locator(".ei-chat-panel__messages");
}

function thinkingIcon(page: Page, messageId: string) {
  return page.locator(`[data-message-id="${messageId}"] .ei-message__thinking-toggle`);
}

async function openChat(page: Page, mockServerUrl: string, fixture: Fixture): Promise<void> {
  await page.setViewportSize(fixture.viewport);
  await seedCheckpoint(page, mockServerUrl, seedMessages(fixture));
  await page.goto("/");
  await selectEiPersona(page);
  await expect(page.locator("[data-message-id]").first()).toBeVisible();
  // Opening a chat lands at the bottom; wait for the list to stop moving before the test scrolls.
  await expect.poll(() => scrollGap(page)).toBeLessThanOrEqual(2);
}

async function scrollGap(page: Page): Promise<number> {
  return scroller(page).evaluate((el) => Math.round(el.scrollHeight - el.clientHeight - el.scrollTop));
}

/** Resolves once the scroll position and extent have stopped changing. */
async function waitForStableScroll(page: Page): Promise<void> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = await scroller(page).evaluate((el) => `${el.scrollTop}/${el.scrollHeight}`);
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { intervals: [300], timeout: 10_000 },
    )
    .toBe(true);
}

interface ToggleObservation {
  thinkingBlocks: number;
  scrollTop: number;
  scrollHeight: number;
  reply: ReplyBox | null;
}

async function observeToggle(page: Page, messageId: string): Promise<ToggleObservation> {
  const reply = await replyBox(page, messageId);
  const rest = await scroller(page).evaluate((el, id) => ({
    thinkingBlocks: el.querySelectorAll(`[data-message-id="${id}"] .ei-message__thinking`).length,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
  }), messageId);
  return { ...rest, reply };
}

/**
 * Resolves with the reply's position once the thinking block is present (or absent) as requested and
 * the reply, scroll position and scroll extent have agreed with each other over several consecutive
 * looks. Fails if that has not happened within a generous bound.
 */
async function waitForSettledToggle(page: Page, messageId: string, thinkingShown: boolean): Promise<ReplyBox> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let run: ToggleObservation[] = [];
  let last: ToggleObservation | null = null;
  while (Date.now() < deadline) {
    const now = await observeToggle(page, messageId);
    last = now;
    const asRequested = now.thinkingBlocks === (thinkingShown ? 1 : 0) && now.reply !== null;
    const first = run[0];
    const agrees =
      asRequested &&
      (first === undefined ||
        (Math.abs(now.scrollTop - first.scrollTop) <= SETTLE_EPSILON_PX &&
          Math.abs(now.scrollHeight - first.scrollHeight) <= SETTLE_EPSILON_PX &&
          Math.abs(now.reply!.top - first.reply!.top) <= SETTLE_EPSILON_PX));
    run = agrees ? [...run, now] : asRequested ? [now] : [];
    if (run.length >= SETTLE_CONSECUTIVE_LOOKS) return run[run.length - 1].reply!;
    await page.waitForTimeout(SETTLE_INTERVAL_MS);
  }
  throw new Error(`the list did not settle with thinking ${thinkingShown ? "shown" : "hidden"} within ${SETTLE_TIMEOUT_MS} ms; last look: ${JSON.stringify(last)}`);
}

/** Scrolls up from the bottom with real wheel input, the way a reader moves through the chat. */
async function scrollTo(page: Page, position: Position): Promise<void> {
  const box = await scroller(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  if (position !== "bottom") {
    for (let step = 0; step < 600; step++) {
      const { top, max } = await scroller(page).evaluate((el) => ({
        top: el.scrollTop,
        max: el.scrollHeight - el.clientHeight,
      }));
      const target = position === "middle" ? Math.round(max / 2) : max - 80;
      if (top <= target) break;
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(30);
    }
  }
  await waitForStableScroll(page);
}

/**
 * The reply, with its icon, fully inside the scroller that sits closest to the vertical middle of the
 * viewport. Rows can be taller than the window, so no row may qualify at the exact scroll position the
 * test asked for; the reader then scrolls up a little, as a person would, until one does.
 */
async function pickVisibleReply(page: Page): Promise<string> {
  for (let nudge = 0; nudge < 12; nudge++) {
    const id = await scroller(page).evaluate((el) => {
      const containerBox = el.getBoundingClientRect();
      const middle = containerBox.top + containerBox.height / 2;
      let best: { id: string; distance: number } | null = null;
      for (const row of el.querySelectorAll("[data-message-id]")) {
        const id = row.getAttribute("data-message-id");
        const icon = row.querySelector(".ei-message__thinking-toggle")?.getBoundingClientRect();
        if (!id || !icon || icon.top < containerBox.top || icon.bottom > containerBox.bottom) continue;
        const text = [...row.querySelectorAll("*")].find(
          (node) => node.children.length === 0 && node.textContent?.startsWith("Persona reply number"),
        );
        if (!text) continue;
        const box = text.getBoundingClientRect();
        if (box.top < containerBox.top || box.bottom > containerBox.bottom) continue;
        const distance = Math.abs((box.top + box.bottom) / 2 - middle);
        if (!best || distance < best.distance) best = { id, distance };
      }
      return best ? best.id : null;
    });
    if (id) return id;
    await page.mouse.wheel(0, -120);
    await waitForStableScroll(page);
  }
  throw new Error("no reply with its thinking icon fits on screen at this scroll position");
}

/** Position of the message's reply text within the scroller, or null once its row is unmounted. */
async function replyBox(page: Page, messageId: string): Promise<ReplyBox | null> {
  return scroller(page).evaluate((el, id) => {
    const row = el.querySelector(`[data-message-id="${id}"]`);
    if (!row) return null;
    const text = [...row.querySelectorAll("*")].find(
      (node) => node.children.length === 0 && node.textContent?.startsWith("Persona reply number"),
    );
    if (!text) return null;
    const containerBox = el.getBoundingClientRect();
    const box = text.getBoundingClientRect();
    return { top: box.top - containerBox.top, bottom: box.bottom - containerBox.top, containerHeight: containerBox.height };
  }, messageId);
}

function expectInside(box: ReplyBox | null, when: string): asserts box is ReplyBox {
  expect(box, `${when}: the clicked reply is no longer rendered`).not.toBeNull();
  expect(box!.top, `${when}: reply top is above the visible area`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
  expect(box!.bottom, `${when}: reply bottom is below the visible area`).toBeLessThanOrEqual(box!.containerHeight + TOLERANCE_PX);
}

/** Makes the next persona save fail once, then lets every later save through untouched. */
async function failNextPersonaUpdate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const processor: unknown = Reflect.get(window, "__processor");
    if (typeof processor !== "object" || processor === null) throw new Error("window.__processor is not exposed by the running app");
    const original: unknown = Reflect.get(processor, "updatePersona");
    if (typeof original !== "function") throw new Error("the processor has no updatePersona method");
    let failed = false;
    Reflect.set(processor, "updatePersona", (...args: unknown[]) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error("simulated save failure"));
      }
      return Reflect.apply(original, processor, args);
    });
  });
}

/** Turns thinking off through the Persona editor's checkbox, the way a user does from the menu. */
async function turnThinkingOffInEditor(page: Page): Promise<void> {
  const pill = page.locator(".ei-persona-pill").first();
  await pill.hover();
  await pill.getByTitle("Edit").click();
  const dialog = page.getByRole("dialog", { name: /Edit Persona/ });
  await dialog.getByRole("checkbox", { name: /Show Thinking/ }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
}

for (const fixture of FIXTURES) {
  test.describe(`thinking toggle keeps the reading position: ${fixture.name}`, () => {
    test.setTimeout(90_000);

    for (const position of ["middle", "near-bottom", "bottom"] as const) {
      for (const mode of ["show", "hide"] as const) {
        test(`${mode} thinking from the ${position} keeps the clicked reply on screen`, async ({ page, mockServerUrl }) => {
          await openChat(page, mockServerUrl, fixture);

          // Thinking starts visible (the default). To exercise "show", hide it first with a real click.
          if (mode === "show") {
            await scrollTo(page, "bottom");
            const lastVisibleId = await pickVisibleReply(page);
            await thinkingIcon(page, lastVisibleId).click();
            await expect(page.locator(".ei-message__thinking")).toHaveCount(0);
            await scrollTo(page, "bottom");
          }

          await scrollTo(page, position);
          const messageId = await pickVisibleReply(page);
          const before = await replyBox(page, messageId);
          expectInside(before, "before the click");
          const thinkingBefore = await page.locator(`[data-message-id="${messageId}"] .ei-message__thinking`).count();
          expect(thinkingBefore).toBe(mode === "hide" ? 1 : 0);

          await thinkingIcon(page, messageId).click();

          // Wait for the requested change and for the list to stop moving; the time that takes depends on
          // the machine, so it is observed rather than assumed.
          const settled = await waitForSettledToggle(page, messageId, mode === "show");

          // Everything below compares against where the reply was before the click.
          expectInside(settled, "after the list settled");

          // With room above and below the list can hold the reply exactly where it was.
          // Hiding at the very end of the list cannot: the list gets shorter than the reader's offset.
          if (position === "middle" || mode === "show") {
            const shift = settled.top - before.top;
            expect(Math.abs(shift), `reply shifted ${shift}px on screen`).toBeLessThanOrEqual(HELD_IN_PLACE_PX);
          }

          // A later look must find the reply where it settled.
          await page.waitForTimeout(LATE_RECHECK_MS);
          const later = await replyBox(page, messageId);
          expectInside(later, `${LATE_RECHECK_MS} ms after the list settled`);
          expect(Math.abs(later.top - settled.top), `reply moved ${later.top - settled.top}px after settling`).toBeLessThanOrEqual(TOLERANCE_PX);
        });
      }
    }
  });
}

test.describe("a toggle that failed leaves no trace for later setting changes", () => {
  test.setTimeout(90_000);

  const fixture = FIXTURES[1];

  /** Scrolls to a fixed spot (without any input event), changes the setting in the editor, and reports where the list ends up. */
  async function editorChangeOutcome(page: Page, mockServerUrl: string, clickFirst: boolean) {
    await openChat(page, mockServerUrl, fixture);
    await scrollTo(page, "middle");

    if (clickFirst) {
      await failNextPersonaUpdate(page);
      const messageId = await pickVisibleReply(page);
      await thinkingIcon(page, messageId).click();
      // The save was refused, so nothing about the chat changes.
      await expect(page.locator(".ei-message__thinking").first()).toBeVisible();
    }

    // Move somewhere else without wheel, key or pointer input.
    await scroller(page).evaluate((el) => {
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.75);
    });
    await waitForStableScroll(page);

    await turnThinkingOffInEditor(page);
    await expect(page.locator(".ei-message__thinking")).toHaveCount(0);
    await waitForStableScroll(page);
    return scroller(page).evaluate((el) => ({ top: Math.round(el.scrollTop), height: el.scrollHeight }));
  }

  test("a refused toggle followed by an editor change scrolls the list exactly as an editor change alone does", async ({ browser, mockServerUrl }) => {
    const withoutClick = await browser.newPage();
    const control = await editorChangeOutcome(withoutClick, mockServerUrl, false);
    await withoutClick.close();

    const withClick = await browser.newPage();
    const outcome = await editorChangeOutcome(withClick, mockServerUrl, true);
    await withClick.close();

    expect(Math.abs(outcome.top - control.top), `scroll position ${outcome.top}px vs ${control.top}px without the refused click`).toBeLessThanOrEqual(HELD_IN_PLACE_PX);
    expect(Math.abs(outcome.height - control.height)).toBeLessThanOrEqual(HELD_IN_PLACE_PX);
  });
});
