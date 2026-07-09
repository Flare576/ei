import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";

// Verifies the exact jq expression documented in skills/ei-search/SKILL.md's
// command reference and drill-down section for the quote-safe pipeline:
//
//   ei "query" | jq -r '.[0] | if .id != null then .id else .message_id end' | ei --id
//
// The old pipeline (`jq '.[0].id'`) breaks whenever the top search hit is a
// quote, because mapQuote() never puts an `id` field on quote results
// (src/cli/retrieval.ts's mapQuote) — jq would emit `null`, and
// `ei --id null` fails. This test locks the replacement expression's
// behavior against both result shapes so a future edit to the documented
// jq snippet is caught if it regresses on either branch.

const JQ_EXPR = ".[0] | if .id != null then .id else .message_id end";

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
  it("extracts message_id when the top hit is quote-shaped (no id field)", () => {
    if (!jqAvailable) return;
    const quoteFirst = [
      {
        type: "quote",
        text: "That's the core reason I was thinking of a single Review skill",
        speaker: "human",
        message_id: "opencode:jeremys-macbook-pro:ses_38a7:msg_c75b",
        timestamp: "2026-06-22T12:17:29.621Z",
        linked_items: [],
      },
      {
        type: "fact",
        id: "2aa93a36-3ad3-4537-8832-7f60067c3bcf",
        name: "Years of Experience",
        description: "20+",
      },
    ];
    expect(runJq(quoteFirst)).toBe("opencode:jeremys-macbook-pro:ses_38a7:msg_c75b");
  });

  it("extracts id when the top hit is fact/person-shaped (has an id field)", () => {
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
        text: "unrelated quote",
        speaker: "human",
        message_id: "ei:some-uuid",
        timestamp: "2026-01-01T00:00:00Z",
        linked_items: [],
      },
    ];
    expect(runJq(factFirst)).toBe("2aa93a36-3ad3-4537-8832-7f60067c3bcf");
  });

  it("would have produced literal 'null' under the old unsafe expression on a quote-first result", () => {
    if (!jqAvailable) return;
    const quoteFirst = [
      {
        type: "quote",
        text: "quote text",
        speaker: "human",
        message_id: "ei:some-uuid",
        timestamp: "2026-01-01T00:00:00Z",
        linked_items: [],
      },
    ];
    const oldUnsafeResult = execFileSync("jq", ["-r", ".[0].id"], {
      input: JSON.stringify(quoteFirst),
      encoding: "utf-8",
    }).trim();
    expect(oldUnsafeResult).toBe("null");
    // The replacement expression does not reproduce that failure:
    expect(runJq(quoteFirst)).not.toBe("null");
  });
});
