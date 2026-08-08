import type { Page } from "@playwright/test";
import { expect, seedCheckpoint, selectEiPersona, test } from "./fixtures.js";

// Tested by Beta — 2026-08-08

const MESSAGE_ID = "msg-0";
const INITIAL_RANGE_START = 0;
const UNIQUE_LATER_TARGET = "A late unique observation confirms the source range was re-derived.";
const UNIQUE_LATER_SOURCE = `${"Opening context establishes a long initial excerpt before any quoted detail appears. ".repeat(4)}${UNIQUE_LATER_TARGET} Closing context follows the edited quote.`;
const ANCHOR_PREFERENCE_TARGET = "Anchor preference keeps the nearby matching excerpt.";
const ANCHOR_PREFERENCE_SOURCE = `${"Opening context ".repeat(7)}${ANCHOR_PREFERENCE_TARGET} ${"Bridge text keeps the next matching phrase far beyond the anchor window. ".repeat(8)}${ANCHOR_PREFERENCE_TARGET}`;
const GENERIC_SOURCE = `${"Opening context establishes enough text for the initial selection. ".repeat(5)}The remaining source text is intentionally unrelated to rejected edits.`;
const AMBIGUOUS_TARGET = "Same phrase here";
const AMBIGUOUS_SOURCE = `${"Opening context ".repeat(6)}${AMBIGUOUS_TARGET} bridge wording repeats nearby ${AMBIGUOUS_TARGET} before the initial anchor window ends.`;

type StoredQuote = {
  message_id: string | null;
  text: string;
  start: number | null;
  end: number | null;
};

async function openQuoteCapture(page: Page, mockServerUrl: string, source: string): Promise<void> {
  await seedCheckpoint(page, mockServerUrl, [{ role: "human", content: source }]);
  await page.goto("/");
  await selectEiPersona(page);

  const captureButton = page.locator(`[data-message-id="${MESSAGE_ID}"] .ei-message__scissors`);
  await expect(captureButton).toBeVisible();
  await captureButton.click();
  await expect(page.locator(".ei-quote-capture-modal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Capture Quote" })).toBeVisible();
}

async function getQuotesForMessage(page: Page): Promise<StoredQuote[]> {
  return page.evaluate(async (messageId) => {
    const processor = (window as Window & {
      __processor: {
        getQuotes(filter: { message_id: string }): Promise<StoredQuote[]>;
      };
    }).__processor;

    return processor.getQuotes({ message_id: messageId });
  }, MESSAGE_ID);
}

async function reloadAndSelectEi(page: Page): Promise<void> {
  await page.reload();
  await selectEiPersona(page);
}

async function expectRejectedQuoteEdit(
  page: Page,
  mockServerUrl: string,
  source: string,
  editedText: string,
  error: string,
): Promise<void> {
  await openQuoteCapture(page, mockServerUrl, source);

  const modal = page.locator(".ei-quote-capture-modal");
  await modal.getByPlaceholder("Edit the quote text here...").fill(editedText);
  await modal.getByRole("button", { name: "Save Quote" }).click();

  await expect(modal).toBeVisible();
  await expect(modal.locator(".ei-form-error")).toHaveText(error);
  await expect(await getQuotesForMessage(page)).toHaveLength(0);

  await reloadAndSelectEi(page);
  await expect(await getQuotesForMessage(page)).toHaveLength(0);
  await expect(page.locator(`[data-message-id="${MESSAGE_ID}"] .ei-quote-highlight`)).toHaveCount(0);
}

test.describe("Quote capture", () => {
  test.beforeEach(async ({ mockServer, page }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    await page.route("**/jsdelivr.net/**", (route) => route.abort());
    await page.route("**/huggingface.co/**", (route) => route.abort());
  });

  test("re-derives and persists a unique edited quote later in the source", async ({ page, mockServerUrl }) => {
    await openQuoteCapture(page, mockServerUrl, UNIQUE_LATER_SOURCE);

    const modal = page.locator(".ei-quote-capture-modal");
    await modal.getByPlaceholder("Edit the quote text here...").fill(UNIQUE_LATER_TARGET);
    await modal.getByRole("button", { name: "Save Quote" }).click();

    const highlight = page.locator(`[data-message-id="${MESSAGE_ID}"] .ei-quote-highlight`);
    await expect(modal).not.toBeVisible();
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText(UNIQUE_LATER_TARGET);

    await page.waitForTimeout(150);
    await reloadAndSelectEi(page);
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText(UNIQUE_LATER_TARGET);

    const quotes = await getQuotesForMessage(page);
    expect(quotes).toHaveLength(1);
    const [quote] = quotes;
    const expectedStart = UNIQUE_LATER_SOURCE.indexOf(UNIQUE_LATER_TARGET);
    expect(quote.message_id).toBe(MESSAGE_ID);
    expect(quote.text).toBe(UNIQUE_LATER_TARGET);
    expect(quote.start).toBe(expectedStart);
    expect(quote.end).toBe(expectedStart + UNIQUE_LATER_TARGET.length);
    expect(quote.text).toBe(UNIQUE_LATER_SOURCE.slice(quote.start!, quote.end!));
    expect(quote.start).not.toBe(INITIAL_RANGE_START);
  });

  test("persists the nearby occurrence when an edited quote has a distant duplicate", async ({ page, mockServerUrl }) => {
    await openQuoteCapture(page, mockServerUrl, ANCHOR_PREFERENCE_SOURCE);

    const modal = page.locator(".ei-quote-capture-modal");
    await modal.getByPlaceholder("Edit the quote text here...").fill(ANCHOR_PREFERENCE_TARGET);
    await modal.getByRole("button", { name: "Save Quote" }).click();

    const highlight = page.locator(`[data-message-id="${MESSAGE_ID}"] .ei-quote-highlight`);
    await expect(modal).not.toBeVisible();
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText(ANCHOR_PREFERENCE_TARGET);

    await page.waitForTimeout(150);
    await reloadAndSelectEi(page);
    await expect(highlight).toHaveCount(1);
    await expect(highlight).toHaveText(ANCHOR_PREFERENCE_TARGET);

    const quotes = await getQuotesForMessage(page);
    expect(quotes).toHaveLength(1);
    const [quote] = quotes;
    const nearbyStart = ANCHOR_PREFERENCE_SOURCE.indexOf(ANCHOR_PREFERENCE_TARGET);
    const distantStart = ANCHOR_PREFERENCE_SOURCE.lastIndexOf(ANCHOR_PREFERENCE_TARGET);
    expect(quote.message_id).toBe(MESSAGE_ID);
    expect(quote.text).toBe(ANCHOR_PREFERENCE_TARGET);
    expect(quote.start).toBe(nearbyStart);
    expect(quote.start).not.toBe(distantStart);
    expect(quote.end).toBe(nearbyStart + ANCHOR_PREFERENCE_TARGET.length);
    expect(quote.text).toBe(ANCHOR_PREFERENCE_SOURCE.slice(quote.start!, quote.end!));
  });

  test("rejects an empty quote edit without persisting it", async ({ page, mockServerUrl }) => {
    await expectRejectedQuoteEdit(
      page,
      mockServerUrl,
      GENERIC_SOURCE,
      "",
      "Quote text cannot be empty.",
    );
  });

  test("rejects an edit absent from the source without persisting it", async ({ page, mockServerUrl }) => {
    await expectRejectedQuoteEdit(
      page,
      mockServerUrl,
      GENERIC_SOURCE,
      "THIS WORDING DOES NOT OCCUR IN THE SOURCE",
      "This text cannot be found in the source message. Edit it to match the original wording exactly.",
    );
  });

  test("rejects an edit with multiple matches in the initial anchor window", async ({ page, mockServerUrl }) => {
    await expectRejectedQuoteEdit(
      page,
      mockServerUrl,
      AMBIGUOUS_SOURCE,
      AMBIGUOUS_TARGET,
      "This text matches more than one place in the source message. Edit it to a more specific excerpt.",
    );
  });
});
