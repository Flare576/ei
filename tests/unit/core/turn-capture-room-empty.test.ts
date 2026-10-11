import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callLLMRaw: vi.fn(),
}));

import { createTurnFixture, type TurnFixture } from "../../helpers/turn-capture-fixture.js";
import { handleRoomResponse } from "../../../src/core/handlers/rooms.js";
import { LLMNextStep, LLMPriority, LLMRequestType } from "../../../src/core/types.js";
import type { LLMResponse, ToolCallRecord } from "../../../src/core/types.js";

describe("room turn with no final reply", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    if (fx) await fx.stop();
  });

  it("does not invent a RoomMessage for empty output after a tool ran, including structured output", async () => {
    fx = await createTurnFixture();
    const before = fx.roomMessages().length;
    const call: ToolCallRecord = {
      name: "read_room_context",
      arguments: { topic: "meeting" },
      result: "a useful result",
      error: false,
      kind: "read",
    };
    const response: LLMResponse = {
      request: {
        id: "room-empty-final",
        created_at: new Date().toISOString(),
        attempts: 0,
        state: "processing",
        type: LLMRequestType.Raw,
        priority: LLMPriority.Room,
        system: "room system",
        user: "room user",
        next_step: LLMNextStep.HandleRoomResponse,
        data: {
          roomId: fx.roomId,
          personaId: fx.personaId,
          personaDisplayName: fx.personaName,
          parentMessageId: fx.roomMessages()[0]?.id ?? null,
        },
      },
      success: true,
      content: "   \n ",
      turn_capture: { tool_calls: [call], thinking: "considered a reply" },
    };

    // A nonempty control proves the same real handler and store can persist this capture.
    handleRoomResponse({ ...response, content: "room reply" }, fx.stateManager);
    const written = fx.roomMessages().at(-1);
    expect(fx.roomMessages()).toHaveLength(before + 1);
    expect(written?.content).toBe("room reply");
    expect(written?.tool_calls).toEqual([call]);
    expect(written?.thinking).toBe("considered a reply");

    handleRoomResponse(response, fx.stateManager);
    expect(fx.roomMessages()).toHaveLength(before + 1);
    expect(fx.roomMessages().at(-1)?.id).toBe(written?.id);

    // A parsed response can enter this handler directly even though no known producer takes that route.
    handleRoomResponse({ ...response, content: "", parsed: { should_respond: true, content: "" } }, fx.stateManager);
    expect(fx.roomMessages()).toHaveLength(before + 1);
    expect(fx.roomMessages().at(-1)?.id).toBe(written?.id);
  });
});
