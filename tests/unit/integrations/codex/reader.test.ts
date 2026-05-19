import { describe, expect, it } from "vitest";
import { parseCodexRolloutMessages } from "../../../../src/integrations/codex/reader.js";

describe("parseCodexRolloutMessages", () => {
  it("extracts visible user and agent messages from rollout JSONL", () => {
    const text = [
      JSON.stringify({ type: "session_meta", payload: { cwd: "/tmp/project" } }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Can you wire up the hook?" },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:02.000Z",
        type: "event_msg",
        payload: { type: "token_count", tokens: 123 },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:03.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "On it." },
      }),
      "not json",
    ].join("\n");

    expect(parseCodexRolloutMessages(text, "thread-1")).toEqual([
      {
        id: "evt_2",
        sessionId: "thread-1",
        role: "user",
        content: "Can you wire up the hook?",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "evt_4",
        sessionId: "thread-1",
        role: "assistant",
        content: "On it.",
        timestamp: "2026-01-01T00:00:03.000Z",
      },
    ]);
  });
});
