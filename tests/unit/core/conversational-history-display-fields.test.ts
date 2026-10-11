import { describe, expect, it, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { QueueProcessor } from "../../../src/core/queue-processor.js";
import { sendMessage, fetchMessagesForLLM } from "../../../src/core/message-manager.js";
import { activateRoom, submitHumanRoomMessage } from "../../../src/core/room-manager.js";
import { normalizeRoomMessages } from "../../../src/core/handlers/utils.js";
import { ContextStatus, LLMNextStep, RoomMode } from "../../../src/core/types.js";
import type { LLMRequest, Message, PersonaEntity, RoomMessage } from "../../../src/core/types.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import type * as LlmClient from "../../../src/core/llm-client.js";

// The provider is the only mocked boundary: history selection, Room placeholder
// hydration, queue processing and persisted state remain the real implementations.
vi.mock("../../../src/core/llm-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof LlmClient>();
  return {
    ...actual,
    callLLMRaw: vi.fn().mockResolvedValue({ content: "OK", finishReason: "stop" }),
  };
});

import { callLLMRaw } from "../../../src/core/llm-client.js";

const PERSONA_ID = "history-guard-persona";
const CONTENT = "AT23-visible-content-sentinel";
const THINKING = "AT23-hidden-thinking-sentinel";
const ARGUMENT = "AT23-hidden-argument-sentinel";
const RESULT = "AT23-hidden-result-sentinel";
const HIDDEN = [THINKING, ARGUMENT, RESULT];
const noop = () => {};

function persona(): PersonaEntity {
  return {
    id: PERSONA_ID,
    entity: "system",
    display_name: "History Guard",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: true,
    last_updated: new Date().toISOString(),
  };
}

function capturedTurn(): Message {
  return {
    id: "at23-persona-record",
    role: "system",
    content: CONTENT,
    thinking: THINKING,
    tool_calls: [
      { name: "find_memory", arguments: { query: ARGUMENT }, result: "first result", error: false, kind: "read" },
      { name: "find_memory", arguments: { query: "second query" }, result: RESULT, error: false, kind: "read" },
    ],
    timestamp: new Date().toISOString(),
    read: true,
    context_status: ContextStatus.Default,
  };
}

async function savedAndReloaded(sm: StateManager): Promise<StateManager> {
  const storage = createMockStorage();
  await storage.save(sm.getStorageState());
  const reloaded = new StateManager();
  await reloaded.initialize(storage);
  return reloaded;
}

async function deliveredPrompt(
  request: LLMRequest,
  sm: StateManager,
): Promise<string> {
  vi.mocked(callLLMRaw).mockClear();
  const processor = new QueueProcessor();
  const callback = vi.fn().mockResolvedValue(undefined);
  processor.start(request, callback, {
    messageFetcher: id => fetchMessagesForLLM(sm, id),
    rawMessageFetcher: id => id.startsWith("room:")
      ? normalizeRoomMessages(sm.getRoomMessages(id.slice(5)), sm)
      : sm.messages_get(id),
  });
  await vi.waitFor(() => expect(callback).toHaveBeenCalled());
  expect(callback.mock.calls[0][0].success).toBe(true);
  expect(callLLMRaw).toHaveBeenCalledTimes(1);
  const [system, user, messages] = vi.mocked(callLLMRaw).mock.calls[0];
  return `${system}\n${user}\n${JSON.stringify(messages)}`;
}

function expectOnlyOrdinaryContent(prompt: string): void {
  expect(prompt).toContain(CONTENT);
  for (const hidden of HIDDEN) expect(prompt).not.toContain(hidden);
}

describe("persisted display-only fields in next conversational-response request", () => {
  it("includes a persisted 1:1 message's ordinary content, not its thinking, tool arguments or tool result", async () => {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(persona());
    expect(sm.messages_append(PERSONA_ID, capturedTurn())).toBe(true);
    const reloaded = await savedAndReloaded(sm);
    expect(reloaded.messages_get(PERSONA_ID)[0]).toMatchObject({ content: CONTENT, thinking: THINKING, tool_calls: capturedTurn().tool_calls });

    await sendMessage(reloaded, new QueueProcessor(), null, PERSONA_ID, "Next turn", false,
      () => undefined, error => { throw new Error(error.message); }, noop, noop);
    const request = reloaded.queue_getAllActiveItems().find(item => item.next_step === LLMNextStep.HandlePersonaResponse);
    expect(request).toBeDefined();
    expectOnlyOrdinaryContent(await deliveredPrompt(request!, reloaded));
  });

  it("includes a persisted Room message's ordinary content, not its thinking, tool arguments or tool result", async () => {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(persona());
    const room = sm.addRoom({ display_name: "History Guard Room", mode: RoomMode.FreeForAll,
      persona_ids: [PERSONA_ID], initial_message: "First turn" });
    const turn: RoomMessage = {
      ...capturedTurn(), id: "at23-room-record", parent_id: room.active_node_id,
      role: "persona", persona_id: PERSONA_ID,
    };
    sm.appendRoomMessage(room.id, turn);
    expect(sm.setRoomActiveNode(room.id, turn.id)).toBe(true);
    const reloaded = await savedAndReloaded(sm);
    expect(reloaded.getRoomMessages(room.id).find(m => m.id === turn.id)).toMatchObject({
      content: CONTENT, thinking: THINKING, tool_calls: turn.tool_calls,
    });

    expect(submitHumanRoomMessage(reloaded, room.id, "Next turn", undefined,
      error => { throw new Error(error.message); }, noop)).not.toBeNull();
    await activateRoom(reloaded, room.id, false,
      error => { throw new Error(error.message); }, noop, noop);
    const request = reloaded.queue_getAllActiveItems().find(item => item.next_step === LLMNextStep.HandleRoomResponse);
    expect(request).toBeDefined();
    expectOnlyOrdinaryContent(await deliveredPrompt(request!, reloaded));
  });
});
