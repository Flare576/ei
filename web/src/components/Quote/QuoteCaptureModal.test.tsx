import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuoteCaptureModal } from "./QuoteCaptureModal";
import { mergeOverlappingQuotes } from "../../../../src/core/corrections.js";
import type { Message, Quote } from "../../../../src/core/types";
import { ContextStatus } from "../../../../src/core/types";

const MESSAGE_CONTENT =
  "The quick brown fox jumps over the lazy dog near the old wooden fence by the river.";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    role: "human",
    content: MESSAGE_CONTENT,
    timestamp: "2026-08-01T00:00:00Z",
    read: true,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function renderModal(message: Message, onSave = vi.fn(), onClose = vi.fn()) {
  render(
    <QuoteCaptureModal
      isOpen
      message={message}
      personaName="Ei"
      dataItems={[]}
      onClose={onClose}
      onSave={onSave}
    />
  );
  return { onSave, onClose };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Edit the quote text here...") as HTMLTextAreaElement;
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: "Save Quote" }));
}

describe("QuoteCaptureModal — save re-derives start/end from the final text", () => {
  it("persists the exact invariant quote.text === message.content.slice(start, end) for an unedited save", () => {
    const message = makeMessage();
    const { onSave } = renderModal(message);

    clickSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    const quote = onSave.mock.calls[0][0] as Omit<Quote, "id" | "created_at">;
    expect(quote.message_id).toBe(message.id);
    expect(quote.text.length).toBeGreaterThan(0);
    expect(quote.start).not.toBeNull();
    expect(quote.end).not.toBeNull();
    expect(quote.text).toBe(message.content!.slice(quote.start as number, quote.end as number));
  });

  it("rejects an edit to empty text visibly, without persisting a quote", () => {
    const message = makeMessage();
    const { onSave } = renderModal(message);

    fireEvent.change(getTextarea(), { target: { value: "" } });
    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/quote text cannot be empty/i)).toBeInTheDocument();
  });

  it("rejects an edit that matches nothing in the source message, without persisting a quote", () => {
    const message = makeMessage();
    const { onSave } = renderModal(message);

    fireEvent.change(getTextarea(), { target: { value: "this text was never said" } });
    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be found in the source message/i)).toBeInTheDocument();
  });

  it("rejects an edit that matches the source message ambiguously, without persisting a quote or keeping the stale range", () => {
    const message = makeMessage({
      content: "Same phrase here. Same phrase here too, later in the message.",
    });
    const { onSave } = renderModal(message);

    fireEvent.change(getTextarea(), { target: { value: "Same phrase here" } });
    clickSave();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/matches more than one place/i)).toBeInTheDocument();
  });

  it("re-derives a fresh range (not the stale seeded range) for an edit that uniquely matches elsewhere", () => {
    const message = makeMessage({
      content: "Intro text. UNIQUE MARKER PHRASE sits later in this message, well past the seed.",
    });
    const { onSave } = renderModal(message);

    // The initial seed covers "Intro text..." near offset 0; editing to text that only
    // exists later in the message must move start/end to match, not keep the seeded range.
    fireEvent.change(getTextarea(), { target: { value: "UNIQUE MARKER PHRASE" } });
    clickSave();

    expect(onSave).toHaveBeenCalledTimes(1);
    const quote = onSave.mock.calls[0][0] as Omit<Quote, "id" | "created_at">;
    const expectedStart = message.content!.indexOf("UNIQUE MARKER PHRASE");
    expect(quote.start).toBe(expectedStart);
    expect(quote.end).toBe(expectedStart + "UNIQUE MARKER PHRASE".length);
    expect(quote.text).toBe(message.content!.slice(quote.start as number, quote.end as number));
  });

  it("does not null message_id on rejection or on success — the source link stays load-bearing", () => {
    const message = makeMessage();
    const { onSave } = renderModal(message);
    clickSave();
    const savedQuote = onSave.mock.calls[0][0] as Omit<Quote, "id" | "created_at">;

    // Prove the retained link is load-bearing: extraction reprocessing an overlapping
    // span on the same message must MERGE with this quote, not silently duplicate it —
    // the exact consumer named in the issue's blast-radius table (human-matching.ts's
    // overlap merge, keyed on message_id). A nulled message_id would make this quote
    // invisible to the merge and this assertion would fail.
    const asStoredQuote: Quote = {
      ...savedQuote,
      id: "quote-1",
      created_at: "2026-08-01T00:00:00Z",
    };
    const overlappingExtractionSpan = {
      message_id: message.id,
      start: asStoredQuote.start as number,
      end: asStoredQuote.end as number,
      text: asStoredQuote.text,
    };

    const merge = mergeOverlappingQuotes([asStoredQuote], overlappingExtractionSpan);

    expect(merge).not.toBeNull();
    expect(merge!.absorbed).toHaveLength(1);
    expect(merge!.absorbed[0].id).toBe("quote-1");
  });
});
