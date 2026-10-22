// Tested by Beta — 2026-10-22
import { describe, it, expect } from "vitest";
import {
  convertToEiMessage,
  convertToPreMarkedEiMessage,
} from "../../../../src/integrations/shared/message-converter.js";
import {
  qualifyPiMessage,
  qualifyClaudeCodeMessage,
  qualifyCursorMessage,
  qualifyCodexMessage,
} from "../../../../src/core/utils/message-id.js";
import { getMachineId } from "../../../../src/integrations/machine-id.js";

const SESSION_ID = "session-1";

const NATIVE = {
  id: "native-message",
  role: "user" as const,
  content: "A human statement.",
  timestamp: "2026-08-01T00:01:00.000Z",
};

// Each importer passes its own qualifier and no options.
const CALLERS = [
  { name: "pi", qualify: qualifyPiMessage, prefix: "pi" },
  { name: "claude-code", qualify: qualifyClaudeCodeMessage, prefix: "claudecode" },
  { name: "cursor", qualify: qualifyCursorMessage, prefix: "cursor" },
  { name: "codex", qualify: qualifyCodexMessage, prefix: "codex" },
];

function expectedJson(prefix: string, extra: Record<string, boolean> = {}): string {
  return JSON.stringify({
    id: `${prefix}:${getMachineId()}:${SESSION_ID}:native-message`,
    role: "human",
    content: "A human statement.",
    timestamp: "2026-08-01T00:01:00.000Z",
    read: true,
    context_status: "default",
    external: true,
    ...extra,
  });
}

describe.each(CALLERS)("convertToEiMessage as called by the $name importer", ({ qualify, prefix }) => {
  it("stores a user-role message as the human's, with no speaker_name", () => {
    const result = convertToEiMessage(NATIVE, SESSION_ID, qualify);

    expect(JSON.stringify(result)).toBe(expectedJson(prefix));
    expect(result).not.toHaveProperty("speaker_name");
  });

  it("keeps a user-role message human when attribution is agent and no options are passed", () => {
    const result = convertToEiMessage({ ...NATIVE, attribution: "agent" }, SESSION_ID, qualify);

    expect(JSON.stringify(result)).toBe(expectedJson(prefix));
    expect(result).not.toHaveProperty("speaker_name");
  });

  it("pre-marked variant adds f/t/p/e flags after the base fields", () => {
    const result = convertToPreMarkedEiMessage(NATIVE, SESSION_ID, qualify);

    expect(JSON.stringify(result)).toBe(
      expectedJson(prefix, { f: true, t: true, p: true, e: true })
    );
    expect(result).not.toHaveProperty("speaker_name");
  });
});
