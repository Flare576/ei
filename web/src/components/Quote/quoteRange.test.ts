import { describe, it, expect } from "vitest";
import { locateQuoteRange, describeQuoteLocateFailure } from "./quoteRange";

describe("locateQuoteRange", () => {
  it("rejects empty edited text", () => {
    const result = locateQuoteRange("Hello world", "", 0, 5);
    expect(result).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects text absent from the source message", () => {
    const result = locateQuoteRange("Hello world", "goodbye", 0, 5);
    expect(result).toEqual({ ok: false, reason: "no-match" });
  });

  it("re-derives start/end for a unique match, satisfying the slice invariant", () => {
    const source = "The quick brown fox jumps over the lazy dog.";
    // Anchor is stale (points at "The quick") but the edited text now reads "brown fox".
    const result = locateQuoteRange(source, "brown fox", 0, 9);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(source.slice(result.start, result.end)).toBe("brown fox");
    }
  });

  it("rejects ambiguous matches when duplicate text sits near the anchor", () => {
    const source = "The cat sat on the mat. The cat sat on the mat too.";
    // Anchor covers the first occurrence, but the edited text repeats close by.
    const result = locateQuoteRange(source, "The cat sat on the mat", 0, 22);
    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("prefers the occurrence near the anchor over a distant duplicate", () => {
    // Two occurrences of NEEDLE, ~800 characters apart — far outside the anchor window.
    const filler = "x".repeat(400);
    const source = `${filler} NEEDLE ${filler} NEEDLE ${filler}`;
    const firstNeedleStart = source.indexOf("NEEDLE");
    const anchorStart = firstNeedleStart;
    const anchorEnd = firstNeedleStart + "NEEDLE".length;

    const result = locateQuoteRange(source, "NEEDLE", anchorStart, anchorEnd);
    expect(result).toEqual({ ok: true, start: firstNeedleStart, end: firstNeedleStart + "NEEDLE".length });
  });

  it("falls back to a full-message scan and accepts a unique distant match", () => {
    // Anchor sits far from the only occurrence of the edited text.
    const filler = "x".repeat(400);
    const source = `${filler} NEEDLE ${filler}`;
    const needleStart = source.indexOf("NEEDLE");

    const result = locateQuoteRange(source, "NEEDLE", 0, 5);
    expect(result).toEqual({ ok: true, start: needleStart, end: needleStart + "NEEDLE".length });
  });

  it("falls back to a full-message scan and rejects an ambiguous distant match", () => {
    const filler = "x".repeat(400);
    const source = `${filler} NEEDLE ${filler} NEEDLE ${filler}`;

    // Anchor is nowhere near either occurrence, so both surface only on the global fallback.
    const result = locateQuoteRange(source, "NEEDLE", 0, 5);
    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("describes every failure reason with a non-empty, user-facing message", () => {
    expect(describeQuoteLocateFailure("empty")).toMatch(/empty/i);
    expect(describeQuoteLocateFailure("no-match")).toMatch(/cannot be found/i);
    expect(describeQuoteLocateFailure("ambiguous")).toMatch(/more than one/i);
  });
});
