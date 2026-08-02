import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";

// Verifies the exact jq expression documented in skills/ei-search/SKILL.md's
// command reference and drill-down section for the search-then-drill-down
// pipeline:
//
//   ei "query" | jq -r '.[0].id' | ei --id
//
// mapQuote() (src/cli/retrieval.ts) emits `id` on quote results, so every
// search hit — quote or entity — carries an `id` and the same one-liner
// works regardless of which type lands first. This test locks that
// expression's behavior against both result shapes so a future edit to the
// documented jq snippet is caught if it regresses on either one.
//
// A quote also carries `message_id`, but that addresses the *source message*
// the quote came from — nullable, and shared by every quote lifted from the
// same message — so it is never a substitute for the quote's own `id`.

const JQ_EXPR = ".[0].id";

let jqAvailable = false;

beforeAll(() => {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
    jqAvailable = true;
  } catch {
    jqAvailable = false;
  }
});

function runJq(input: unknown): string {
  return execFileSync("jq", ["-r", JQ_EXPR], {
    input: JSON.stringify(input),
    encoding: "utf-8",
  }).trim();
}

describe("quote-safe drill-down jq pipeline", () => {
  it("extracts id when the top hit is quote-shaped", () => {
    if (!jqAvailable) return;
    const quoteFirst = [
      {
        type: "quote",
        id: "7f1c9d34-2b58-4e0a-9c61-8ad3f5e2b410",
        text: "That's the core reason I was thinking of a single Review skill",
        speaker: "human",
        timestamp: "2026-06-22T12:17:29.621Z",
        message_id: "opencode:jeremys-macbook-pro:ses_38a7:msg_c75b",
        linked_items: [],
      },
      {
        type: "fact",
        id: "2aa93a36-3ad3-4537-8832-7f60067c3bcf",
        name: "Years of Experience",
        description: "20+",
      },
    ];
    expect(runJq(quoteFirst)).toBe("7f1c9d34-2b58-4e0a-9c61-8ad3f5e2b410");
  });

  it("extracts id when the top hit is fact/person-shaped", () => {
    if (!jqAvailable) return;
    const factFirst = [
      {
        type: "fact",
        id: "2aa93a36-3ad3-4537-8832-7f60067c3bcf",
        name: "Years of Experience",
        description: "20+",
      },
      {
        type: "quote",
        id: "b3e40f21-77c6-4d19-8f52-1c0ae9d6b884",
        text: "unrelated quote",
        speaker: "human",
        timestamp: "2026-01-01T00:00:00Z",
        message_id: "ei:some-uuid",
        linked_items: [],
      },
    ];
    expect(runJq(factFirst)).toBe("2aa93a36-3ad3-4537-8832-7f60067c3bcf");
  });

  it("never falls back to message_id, which addresses the source message, not the quote", () => {
    if (!jqAvailable) return;
    const quoteFirst = [
      {
        type: "quote",
        id: "b3e40f21-77c6-4d19-8f52-1c0ae9d6b884",
        text: "quote text",
        speaker: "human",
        timestamp: "2026-01-01T00:00:00Z",
        message_id: "ei:some-uuid",
        linked_items: [],
      },
    ];
    expect(runJq(quoteFirst)).toBe("b3e40f21-77c6-4d19-8f52-1c0ae9d6b884");
    expect(runJq(quoteFirst)).not.toBe("ei:some-uuid");
  });
});
