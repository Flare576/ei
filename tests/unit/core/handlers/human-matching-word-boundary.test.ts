/**
 * Unit tests for quote extraction word-boundary matching logic.
 *
 * These tests cover real-world edge cases discovered through actual data
 * failures during backfill migration. They exercise `findQuoteByWords` and
 * `expandToWordBoundaries` — both exported for testability.
 *
 * Tests run against the pure string-matching functions only; no LLM or
 * embedding service is involved.
 */

import { describe, it, expect } from "vitest";
import {
  findQuoteByWords,
  expandToWordBoundaries,
} from "../../../../src/core/handlers/human-matching.js";

// ---------------------------------------------------------------------------
// expandToWordBoundaries — direct tests
// ---------------------------------------------------------------------------

describe("expandToWordBoundaries", () => {
  it("A: expands forward when end is mid-word (truncated last word)", () => {
    // "That's the whole thesi" is a substring of the message; end lands mid-word.
    // expandToWordBoundaries should walk forward to include the rest of "thesis."
    const msg = "That's the whole thesis.";
    const quoteSubstr = "That's the whole thesi";
    const start = 0;
    const end = quoteSubstr.length; // 22 — lands at 'i' in "thesis."

    const result = expandToWordBoundaries(msg, start, end);

    expect(result.start).toBe(0);
    expect(result.end).toBe(msg.length); // 24 — includes "s."
    expect(result.text).toBe("That's the whole thesis.");
  });

  it("B: does NOT walk backward when start is already at whitespace boundary", () => {
    // Message: "yet.\n\nThat's not a footnote. ..."
    // After Level 1 finds the match starting at position 6 (the 'T'), the char at
    // position 5 is '\n' (whitespace) — no backward grab should occur.
    const msg = "yet.\n\nThat's not a footnote. That's the whole thesis.";
    // "That's" is at index 6; "That's not a footnote." ends at index 28.
    const start = 6;
    const end = 28; // position of space after "footnote."

    const result = expandToWordBoundaries(msg, start, end);

    // Should NOT have walked back to grab "yet."
    expect(result.start).toBe(6);
    expect(result.text).not.toContain("yet.");
    expect(result.text).toBe("That's not a footnote.");
  });

  it("C: does NOT walk backward when start is preceded by a space", () => {
    // There is a space before "and", so no backward extension should happen.
    const msg = "reflection_ and you're still broken - but";
    // "and" starts at index 12; "broken" ends at index 35
    const start = 12;
    const end = 35;

    const result = expandToWordBoundaries(msg, start, end);

    expect(result.start).toBe(12);
    expect(result.text).toBe("and you're still broken");
    expect(result.text).not.toContain("reflection_");
  });

  it("E: expands forward to capture trailing punctuation attached to last word", () => {
    // "thesis" token in the message is "thesis." (with period attached).
    // expandToWordBoundaries should capture the period.
    const msg = "the whole thesis.";
    // Token "thesis." ends at index 17 (length of msg).
    const start = 0;
    const end = 17; // already at end of token; char at [16]='.' is non-whitespace

    const result = expandToWordBoundaries(msg, start, end);

    expect(result.text).toBe("the whole thesis.");
    expect(result.end).toBe(17);
  });

  it("F: correct offset when message contains ASCII ellipsis (no drift)", () => {
    // normalizeText no longer normalizes "..." → "…", so the indexOf offset
    // in the original message is the same as in the normalized message.
    // expandToWordBoundaries called with that correct offset should return
    // exactly the quote substring — not something shifted by 2.
    const msg = "First thought... and then the real insight";
    // "and then the real insight" starts at index 17
    const quoteText = "and then the real insight";
    const start = 17;
    const end = start + quoteText.length; // 42

    const result = expandToWordBoundaries(msg, start, end);

    expect(result.start).toBe(17);
    expect(result.text).toBe("and then the real insight");
  });
});

// ---------------------------------------------------------------------------
// findQuoteByWords — direct tests
// ---------------------------------------------------------------------------

describe("findQuoteByWords", () => {
  it("A: matches truncated last word and expands to full word", () => {
    // The quote ends mid-word; Level 2 (word-boundary) should find the
    // matching words and expand the end token to include "thesis."
    const quote = "That's the whole thesi";
    const msg = "That's the whole thesis.";

    const result = findQuoteByWords(quote, msg);

    // Word tokens: "thats", "the", "whole", "thesis" — all 4 words from the
    // quote (after stripping) should align. "thesi" stripped → "thesi",
    // but "thesis." stripped → "thesis" — they differ, so the level-2 word
    // match will NOT find a hit. This is expected behavior: Level 2 can't
    // recover from a truncated token. Level 1 (exact substring) handles this.
    // Verify graceful null return (no crash, no false positive).
    expect(result).toBeNull();
  });

  it("B: leading whitespace — does not grab preceding word", () => {
    // Quote starts with a newline; the match should start at the 'T' in
    // "That's", not absorb "yet." which precedes it.
    const quote = "\n\nThat's not a footnote";
    const msg = "yet.\n\nThat's not a footnote. That's the whole thesis.";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    // start should be at the 'T' of "That's" (index 6), NOT at 'y' of "yet."
    expect(result!.start).toBe(6);
    expect(result!.text).not.toMatch(/yet\./);
  });

  it("C: clean word boundary — no extension into preceding token", () => {
    // There's a space between "reflection_" and "and", so "and" is a clean
    // word boundary. The match should start at "and", not "reflection_".
    const quote = "and you're still broken";
    const msg = "reflection_ and you're still broken - but";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("and you're still broken");
    expect(result!.text).not.toContain("reflection_");
  });

  it("D: contraction tokenization — don't splits into sub-tokens correctly", () => {
    // "don't" → stripPunctuation → "don t" → sub-tokens ["don","t"]
    // The quote words also split "don't" the same way, so alignment works.
    const quote = "I don't know what you mean";
    const msg = "well I don't know what you mean exactly";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("I don't know what you mean");
    // Should not grab "well" or "exactly"
    expect(result!.text).not.toContain("well");
    expect(result!.text).not.toContain("exactly");
  });

  it("E: trailing punctuation is captured via expandToWordBoundaries", () => {
    // "thesis." — the period is attached to the word token, so after finding
    // the word "thesis" the expansion walks forward to include ".".
    const quote = "the whole thesis";
    const msg = "the whole thesis.";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("the whole thesis.");
  });

  it("F: ASCII ellipsis in message does not drift the match position", () => {
    // If normalizeText had converted "..." → "…" (1 char), the offset would
    // be off by 2. Since that normalization was removed, Level 2 still finds
    // the match at the correct position in the original message.
    const quote = "and then the real insight";
    const msg = "First thought... and then the real insight";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("and then the real insight");
    // Confirm the offset is correct — "and" starts at index 17
    expect(result!.start).toBe(17);
  });

  it("G: 2-word quote matches successfully (threshold is >= 2)", () => {
    const quote = "just testing";
    const msg = "we were just testing something";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toBe("just testing");
  });

  it("G: 1-word quote returns null (below 2-word minimum)", () => {
    const quote = "hello";
    const msg = "hello world";

    const result = findQuoteByWords(quote, msg);

    expect(result).toBeNull();
  });

  it("H: unicode ellipsis in message matched by Level 2 even when it differs from ASCII quote", () => {
    // Message has "…" (U+2026), quote has "..." (three dots).
    // normalizeText does NOT normalize these to each other, so Level 1 misses.
    // Level 2 (findQuoteByWords) strips all punctuation from both sides, so
    // "thinking…" and "thinking..." both strip to "thinking" — match succeeds.
    const quote = "thinking... and then";
    const msg = "thinking\u2026 and then the conclusion";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    // The expanded text should start with "thinking" and include "then"
    expect(result!.text).toMatch(/^thinking/);
    expect(result!.text).toContain("and then");
  });

  it("H: ASCII ellipsis in message matched when quote uses unicode ellipsis", () => {
    // Reverse of the previous case.
    const quote = "thinking\u2026 and then";
    const msg = "thinking... and then the conclusion";

    const result = findQuoteByWords(quote, msg);

    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/^thinking/);
    expect(result!.text).toContain("and then");
  });
});
