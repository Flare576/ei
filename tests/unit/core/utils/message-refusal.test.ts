// Direct unit coverage for src/core/utils/message-refusal.ts -- no dedicated
// test file existed for this module before now (it was only exercised
// indirectly through fetch-message.test.ts and retrieval-resolver.test.ts).
// This file locks down classifyRefusedMessageId/classifyMalformedRoomPrimary's
// id-free reason wording and sanitizeMessageIdForLog's control-byte strip
// (I6, .sisyphus/reviews/quote-attestation-final-implementation.md).
import { describe, it, expect } from "vitest";
import {
  classifyRefusedMessageId,
  classifyMalformedRoomPrimary,
  sanitizeMessageIdForLog,
} from "../../../../src/core/utils/message-refusal.js";

describe("classifyRefusedMessageId", () => {
  it("refuses a Slack-qualified id without echoing the id into the reason", () => {
    const id = "slack:T0123:C0456:1700000000.000100";
    const result = classifyRefusedMessageId(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("Slack import") });
    expect(result!.reason).not.toContain(id);
  });

  it("refuses an imported-document id without echoing the id into the reason", () => {
    const id = "import:document:my-doc-slug:00000000-0000-4000-8000-000000000000";
    const result = classifyRefusedMessageId(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("imported document") });
    expect(result!.reason).not.toContain(id);
  });

  it("refuses a generated-document id without echoing the id into the reason", () => {
    const id = "generate:document:my-doc-slug:00000000-0000-4000-8000-000000000000";
    const result = classifyRefusedMessageId(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("generated document") });
    expect(result!.reason).not.toContain(id);
  });

  it("returns null for an unrecognized/unrelated id shape", () => {
    expect(classifyRefusedMessageId("ei:00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(classifyRefusedMessageId("opencode:machine:ses_abc:msg_1")).toBeNull();
    expect(classifyRefusedMessageId("totally-unknown-legacy-id")).toBeNull();
  });

  it("I6/T7: a control/ANSI-bearing Slack id produces no raw control bytes in the reason, while remaining a Slack-labeled refusal", () => {
    const evilId = "slack:\x1b[31mT0123\x1b[0m:C0456:1700000000.000100";
    const result = classifyRefusedMessageId(evilId);
    expect(result?.refused).toBe(true);
    expect(result!.reason).toContain("Slack import");
    expect(result!.reason).not.toContain("\x1b[31m");
    expect(result!.reason).not.toContain(evilId);
  });
});

describe("classifyMalformedRoomPrimary", () => {
  it("refuses a persona-role message with no persona_id, without echoing the message id", () => {
    const id = "ei:cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const result = classifyMalformedRoomPrimary({ id, role: "persona" });
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("no persona_id") });
    expect(result!.reason).not.toContain(id);
  });

  it("does not refuse a persona-role message with a present (even if orphaned) persona_id", () => {
    expect(classifyMalformedRoomPrimary({ id: "m-1", role: "persona", persona_id: "deleted-persona-id" })).toBeNull();
  });

  it("does not refuse a human-role message", () => {
    expect(classifyMalformedRoomPrimary({ id: "m-1", role: "human" })).toBeNull();
  });

  it("I6/T7: a control/ANSI-bearing message id produces no raw control bytes in the reason, while remaining distinguishable as the missing-persona_id category", () => {
    const evilId = "attest\x07bell\x1b[31mred\x1b[0mroom-msg-1";
    const result = classifyMalformedRoomPrimary({ id: evilId, role: "persona" });
    expect(result?.refused).toBe(true);
    expect(result!.reason).toContain("no persona_id");
    expect(result!.reason).not.toContain("\x1b[31m");
    expect(result!.reason).not.toContain("\x07");
    expect(result!.reason).not.toContain(evilId);
  });
});

describe("sanitizeMessageIdForLog", () => {
  it("returns a clean id unchanged", () => {
    expect(sanitizeMessageIdForLog("ei:00000000-0000-4000-8000-000000000000")).toBe(
      "ei:00000000-0000-4000-8000-000000000000"
    );
  });

  it("strips C0 control bytes (including ESC-driven ANSI sequences) while keeping the rest of the id legible", () => {
    const evil = "attest\x1b[31mRED\x1b[0mquote-1";
    const cleaned = sanitizeMessageIdForLog(evil);
    expect(cleaned).not.toContain("\x1b");
    expect(cleaned).toBe("attest[31mRED[0mquote-1");
  });

  it("strips a bell character and other C0 bytes", () => {
    expect(sanitizeMessageIdForLog("id\x07with\x00bell")).toBe("idwithbell");
  });

  it("strips C1 control bytes (0x7f-0x9f)", () => {
    expect(sanitizeMessageIdForLog("id\x7fwith\x9fdel")).toBe("idwithdel");
  });

  it("returns an empty string unchanged", () => {
    expect(sanitizeMessageIdForLog("")).toBe("");
  });
});
