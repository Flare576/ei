// T11 (Wave 1 quote-attestation review, round 2, finding I3): the browser
// runtime registration of the builtin `fetch_message` executor gets NO
// resolver at all (src/core/processor.ts's completeInitialization only
// passes resolveExternalMessage on the TUI branch). Before this fix, that
// meant a browser Processor's fetch_message unconditionally fell through to
// its local persona/room scan and returned a legacy `{message,before,after,
// persona}` envelope for the exact sources the resolver refusal contract
// says must be terminally refused: Slack, imported-document, and
// generated-document messages, plus a malformed room-persona-primary
// message. This suite starts a real browser-mode Processor (isTUI false,
// forced via a stubbed global `document` — see detectEnvironment(),
// processor.ts:192-199), seeds each refused-source message locally exactly
// as production code would, then drives the REGISTERED fetch_message tool
// through the same executeToolCalls() path the LLM tool-calling pipeline
// uses — not a freshly-constructed executor — so this proves the actual
// runtime wiring, not just the executor's own unit behavior (already
// covered by tests/unit/core/tools/fetch-message.test.ts and the
// real-resolver cases in tests/unit/cli/retrieval-resolver.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import { executeToolCalls, SYSTEM_TOOLS } from "../../../src/core/tools/index.js";
import type { Ei_Interface } from "../../../src/core/types.js";
import { ContextStatus, RoomMode } from "../../../src/core/types/enums.js";
import type { Message } from "../../../src/core/types/llm.js";
import type { PersonaEntity } from "../../../src/core/types/entities.js";
import type { RoomMessage } from "../../../src/core/types/rooms.js";

// Mocked exactly like tests/unit/core/processor-corrections-drain.test.ts so
// start()'s background runLoop can't reach a real LLM/ceremony flow.
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueReflectionDrain: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
}));

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
  };
}

// is_paused: true — a freshly-added persona has no messages, so the live
// runLoop (which start() kicks off for real, alongside our tool calls
// below) would otherwise treat it as immediately overdue for a heartbeat.
// Paused personas are skipped by that check (see the identical comment in
// processor-corrections-drain.test.ts).
function makePersonaEntity(id: string): PersonaEntity {
  return {
    id,
    display_name: id,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: true,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: "system",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: ContextStatus.Always,
    ...overrides,
  };
}

function makeRoomMessage(id: string, overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id,
    parent_id: null,
    role: "human",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

/** Drives fetch_message through the same executeToolCalls() path the LLM tool-calling pipeline uses, dispatching to whatever executor is actually registered in the module-level registry. */
async function callFetchMessage(id: string): Promise<Record<string, unknown>> {
  const { results } = await executeToolCalls(
    [{ id: "call-1", name: "fetch_message", arguments: { id } }],
    SYSTEM_TOOLS,
    new Map(),
    { count: 0 }
  );
  expect(results).toHaveLength(1);
  return JSON.parse(results[0].result);
}

describe("Processor browser-mode fetch_message registration preserves terminal refusals (I3, T11)", () => {
  let processor: Processor;

  beforeEach(async () => {
    vi.stubGlobal("document", {});
    processor = new Processor({} as Ei_Interface);
    await processor.start(createMockStorage() as unknown as Parameters<Processor["start"]>[0]);
  });

  afterEach(async () => {
    await processor.stop();
    vi.unstubAllGlobals();
  });

  it("refuses a locally-stored Slack-imported message instead of a legacy envelope", async () => {
    const sm = processor.getStateManager();
    sm.persona_add(makePersonaEntity("persona-slack"));
    const slackId = "slack:T0123:C0456:1700000000.000100";
    sm.messages_append("persona-slack", makeMessage(slackId, { content: "Alice: hi from slack", speaker_name: "Alice" }));

    const result = await callFetchMessage(slackId);

    expect(result).toEqual({ refused: true, reason: expect.stringContaining("Slack import") });
    expect(result.message).toBeUndefined();
    expect(result.persona).toBeUndefined();
  });

  it("refuses a locally-stored imported-document message instead of a legacy envelope", async () => {
    const sm = processor.getStateManager();
    sm.persona_add(makePersonaEntity("emmet"));
    const importId = `import:document:my-doc:${crypto.randomUUID()}`;
    sm.messages_append("emmet", makeMessage(importId, { content: "a segment of the imported document" }));

    const result = await callFetchMessage(importId);

    expect(result).toEqual({ refused: true, reason: expect.stringContaining("imported document") });
    expect(result.message).toBeUndefined();
    expect(result.persona).toBeUndefined();
  });

  it("refuses a locally-stored generated-document message instead of a legacy envelope", async () => {
    const sm = processor.getStateManager();
    sm.persona_add(makePersonaEntity("emmet"));
    const generateId = `generate:document:my-doc:${crypto.randomUUID()}`;
    sm.messages_append("emmet", makeMessage(generateId, { content: "synthesized document content" }));

    const result = await callFetchMessage(generateId);

    expect(result).toEqual({ refused: true, reason: expect.stringContaining("generated document") });
    expect(result.message).toBeUndefined();
    expect(result.persona).toBeUndefined();
  });

  it("refuses a malformed room-persona-primary message (role persona, no persona_id) instead of the Participant-fallback legacy envelope", async () => {
    const sm = processor.getStateManager();
    const room = sm.addRoom({ display_name: "Test Room", mode: RoomMode.FreeForAll, persona_ids: [], initial_message: "hello" });
    const malformedId = "malformed-room-primary-1";
    sm.appendRoomMessage(room.id, makeRoomMessage(malformedId, { role: "persona", content: "no persona_id at all" }));

    const result = await callFetchMessage(malformedId);

    expect(result).toEqual({ refused: true, reason: expect.stringContaining("no persona_id") });
    expect(result.message).toBeUndefined();
    expect(result.persona).toBeUndefined();
  });

  it("still resolves an ordinary local message normally — the classifier only refuses the three specific formats, not everything", async () => {
    const sm = processor.getStateManager();
    sm.persona_add(makePersonaEntity("persona-ordinary"));
    sm.messages_append("persona-ordinary", makeMessage("ei:11111111-1111-1111-1111-111111111111", { content: "an ordinary local message" }));

    const result = await callFetchMessage("ei:11111111-1111-1111-1111-111111111111");

    expect(result.refused).toBeUndefined();
    expect((result.message as Record<string, unknown>)?.content).toBe("an ordinary local message");
    expect(result.persona).toBe("persona-ordinary");
  });
});
