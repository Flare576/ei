/**
 * Re-derives a quote's `start`/`end` offsets from its (possibly edited) text,
 * rather than trusting stale range state carried from when the quote was
 * seeded. See `.sisyphus/issues/web-quote-claims-unverified-source.md`.
 *
 * The caller's prior `start`/`end` (from before the edit) is used only as a
 * search ANCHOR: occurrences of `editedText` near that position are
 * preferred over an unanchored scan of the entire message, matching how
 * every other quote-location surface in the codebase works (anchor first,
 * widen only when nothing is nearby). A unique match near the anchor is
 * accepted without checking the rest of the message for duplicates. Only
 * when nothing is found nearby does the search widen to the full message —
 * where it must still resolve to exactly one occurrence.
 *
 * Never returns a range unless `source.slice(start, end) === editedText`
 * holds by construction.
 */

export type QuoteLocateFailureReason = "empty" | "no-match" | "ambiguous";

export type QuoteLocateResult =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: QuoteLocateFailureReason };

/** Minimum half-width (in characters) of the anchor search window on each side. */
const ANCHOR_WINDOW_RADIUS = 200;

/** Every start offset (including overlapping ones) at which `needle` occurs in `haystack`. */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const offsets: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return offsets;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    offsets.push(idx);
    from = idx + 1;
  }
  return offsets;
}

export function locateQuoteRange(
  sourceText: string,
  editedText: string,
  anchorStart: number,
  anchorEnd: number,
): QuoteLocateResult {
  if (editedText.length === 0) return { ok: false, reason: "empty" };

  const radius = Math.max(ANCHOR_WINDOW_RADIUS, editedText.length);
  const windowStart = Math.max(0, anchorStart - radius);
  const windowEnd = Math.min(sourceText.length, anchorEnd + radius);

  const nearbyOffsets = findAllOccurrences(sourceText.slice(windowStart, windowEnd), editedText).map(
    (offset) => offset + windowStart,
  );

  if (nearbyOffsets.length === 1) {
    const start = nearbyOffsets[0];
    return { ok: true, start, end: start + editedText.length };
  }
  if (nearbyOffsets.length > 1) return { ok: false, reason: "ambiguous" };

  // Nothing near the anchor — widen to the whole message before giving up.
  const globalOffsets = findAllOccurrences(sourceText, editedText);
  if (globalOffsets.length === 0) return { ok: false, reason: "no-match" };
  if (globalOffsets.length > 1) return { ok: false, reason: "ambiguous" };

  const start = globalOffsets[0];
  return { ok: true, start, end: start + editedText.length };
}

export function describeQuoteLocateFailure(reason: QuoteLocateFailureReason): string {
  switch (reason) {
    case "empty":
      return "Quote text cannot be empty.";
    case "no-match":
      return "This text cannot be found in the source message. Edit it to match the original wording exactly.";
    case "ambiguous":
      return "This text matches more than one place in the source message. Edit it to a more specific excerpt.";
  }
}
