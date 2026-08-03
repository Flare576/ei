import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, PersonaEntity, Message, Quote } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handlePersonaGeneration: vi.fn(),
    handleFactFind: vi.fn(),
    handleHumanTopicScan: vi.fn(),
    handleHumanPersonScan: vi.fn(),
    handlePersonaTraitExtraction: vi.fn(),
    handlePersonaTopicDetection: vi.fn(),
    handlePersonaTopicExploration: vi.fn(),
    handleHeartbeatCheck: vi.fn(),
    handleEiHeartbeat: vi.fn(),
    handleOneShot: vi.fn(),
  },
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
  shouldStartCeremony: vi.fn(),
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

const mockGetMessageById = vi.fn();

vi.mock("../../../src/integrations/opencode/reader-factory.js", () => ({
  createOpenCodeReader: vi.fn().mockResolvedValue({
    getMessageById: mockGetMessageById,
    getSessionsUpdatedSince: vi.fn().mockResolvedValue([]),
    getSessionsInRange: vi.fn().mockResolvedValue([]),
    getMessagesForSession: vi.fn().mockResolvedValue([]),
    getAgentInfo: vi.fn().mockResolvedValue(null),
    getAllUniqueAgents: vi.fn().mockResolvedValue([]),
    getFirstAgent: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../src/integrations/machine-id.js", () => ({
  getMachineId: vi.fn().mockReturnValue("test-machine"),
}));

function createMockInterface(): Ei_Interface {
  return {
    onPersonaAdded: vi.fn(),
    onPersonaRemoved: vi.fn(),
    onPersonaUpdated: vi.fn(),
    onMessageAdded: vi.fn(),
    onMessageProcessing: vi.fn(),
    onMessageQueued: vi.fn(),
    onMessageRecalled: vi.fn(),
    onHumanUpdated: vi.fn(),
    onQueueStateChanged: vi.fn(),
    onError: vi.fn(),
    onStateImported: vi.fn(),
    onOneShotReturned: vi.fn(),
  };
}

function createMockStorage(preloadState?: any) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(preloadState ?? null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
  };
}

function makePersona(id: string): PersonaEntity {
  return {
    id,
    display_name: `Persona ${id}`,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeMessage(id: string, external = false, content: string | undefined = "test content"): Message {
  return {
    id,
    role: "human",
    content,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: "normal",
    external: external || undefined,
  };
}

function makeQuote(messageId: string | null, text = "test quote"): Quote {
  return {
    id: `quote-${Math.random().toString(36).slice(2)}`,
    text,
    message_id: messageId,
    persona_id: "persona-1",
    timestamp: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    sentiment: 0,
  };
}

describe("Processor.migrateMessageIds()", () => {
  let processor: Processor;

  beforeEach(() => {
    mockGetMessageById.mockReset();
    processor = new Processor(createMockInterface());
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("rewrites naked msg_ quote when OpenCode reader finds the message", async () => {
    const state = createDefaultTestState();
    const nakdMsgId = "msg_abc123XYZ";
    state.human.quotes = [makeQuote(nakdMsgId, "test quote")];
    mockGetMessageById.mockResolvedValue({
      message: { id: nakdMsgId, content: "Quote: test quote appears here." },
      before: [],
      after: [],
      session: { id: "ses_sessionABC" },
    });

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(`opencode:test-machine:ses_sessionABC:${nakdMsgId}`);
  });

  it("leaves naked msg_ quote unqualified when OpenCode content does not contain the quote text", async () => {
    const state = createDefaultTestState();
    const nakdMsgId = "msg_mismatch456";
    state.human.quotes = [makeQuote(nakdMsgId, "test quote")];
    mockGetMessageById.mockResolvedValue({
      message: { id: nakdMsgId, content: "Completely unrelated content." },
      before: [],
      after: [],
      session: { id: "ses_sessionMismatch" },
    });

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(nakdMsgId);
  });

  it("rewrites naked UUID quote to ei: when found in persona messages", async () => {
    const bareUuid = "550e8400-e29b-41d4-a716-446655440000";
    const personaId = "persona-uuid-test";
    const state = createDefaultTestState();
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [makeMessage(bareUuid, false, "Quote: test quote appears here.")],
    };
    state.human.quotes = [makeQuote(bareUuid, "test quote")];
    mockGetMessageById.mockResolvedValue(null);

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(`ei:${bareUuid}`);
  });

  it("leaves naked UUID quote unqualified when mapped message content does not contain the quote text", async () => {
    const bareUuid = "550e8400-e29b-41d4-a716-446655440002";
    const personaId = "persona-uuid-mismatch";
    const state = createDefaultTestState();
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [makeMessage(bareUuid, false, "This message has nothing to do with the stored quote.")],
    };
    state.human.quotes = [makeQuote(bareUuid, "test quote")];

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(bareUuid);
  });

  it("leaves naked UUID quote unqualified when mapped message has no content", async () => {
    const bareUuid = "550e8400-e29b-41d4-a716-446655440003";
    const personaId = "persona-uuid-no-content";
    const state = createDefaultTestState();
    const contentlessMessage = makeMessage(bareUuid, false, "test quote");
    delete contentlessMessage.content;
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [contentlessMessage],
    };
    state.human.quotes = [makeQuote(bareUuid, "test quote")];

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(bareUuid);
  });

  it("is idempotent: a second migration pass against already-migrated state makes zero further rewrites", async () => {
    const bareUuid = "550e8400-e29b-41d4-a716-446655440004";
    const personaId = "persona-uuid-idempotent";
    const nakdMsgId = "msg_idempotent789";
    const matchingContent = "Quote: test quote appears here.";

    const state = createDefaultTestState();
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [makeMessage(bareUuid, false, matchingContent)],
    };
    state.human.quotes = [makeQuote(bareUuid, "test quote"), makeQuote(nakdMsgId, "test quote")];
    mockGetMessageById.mockResolvedValue({
      message: { id: nakdMsgId, content: matchingContent },
      before: [],
      after: [],
      session: { id: "ses_sessionIdem" },
    });

    const storage = createMockStorage(state);
    await processor.start(storage);

    const firstPassQuotes = processor.getStateManager().getHuman().quotes;
    const firstPassMessages = processor.getStateManager().messages_get(personaId);
    expect(firstPassQuotes[0].message_id).toBe(`ei:${bareUuid}`);
    expect(firstPassQuotes[1].message_id).toBe(`opencode:test-machine:ses_sessionIdem:${nakdMsgId}`);

    const firstPassSnapshot = JSON.parse(JSON.stringify({ quotes: firstPassQuotes, messages: firstPassMessages }));

    await processor.stop();

    const secondPassState = {
      ...createDefaultTestState(),
      human: { ...state.human, quotes: firstPassQuotes },
      personas: { [personaId]: { entity: makePersona(personaId), messages: firstPassMessages } },
    };

    const secondProcessor = new Processor(createMockInterface());
    await secondProcessor.start(createMockStorage(secondPassState));

    const secondPassSnapshot = JSON.parse(JSON.stringify({
      quotes: secondProcessor.getStateManager().getHuman().quotes,
      messages: secondProcessor.getStateManager().messages_get(personaId),
    }));

    expect(secondPassSnapshot).toEqual(firstPassSnapshot);
    expect(mockGetMessageById).toHaveBeenCalledTimes(1);

    await secondProcessor.stop();
  });

  it("leaves null message_id alone", async () => {
    const state = createDefaultTestState();
    state.human.quotes = [makeQuote(null)];

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBeNull();
  });

  it("skips already-qualified message_ids", async () => {
    const state = createDefaultTestState();
    const fqId = "ei:550e8400-e29b-41d4-a716-446655440000";
    state.human.quotes = [makeQuote(fqId)];

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(fqId);
    expect(mockGetMessageById).not.toHaveBeenCalled();
  });

  it("leaves naked msg_ quote alone when OpenCode reader returns null", async () => {
    const state = createDefaultTestState();
    const nakdMsgId = "msg_otherMachine99";
    state.human.quotes = [makeQuote(nakdMsgId)];
    mockGetMessageById.mockResolvedValue(null);

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();
    expect(human.quotes[0].message_id).toBe(nakdMsgId);
  });

  it("rewrites bare persona message IDs to ei: prefix", async () => {
    const bareId = "550e8400-e29b-41d4-a716-446655440001";
    const personaId = "persona-bare-test";
    const state = createDefaultTestState();
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [makeMessage(bareId)],
    };

    const storage = createMockStorage(state);
    await processor.start(storage);

    const messages = processor.getStateManager().messages_get(personaId);
    expect(messages[0].id).toBe(`ei:${bareId}`);
  });

  it("does not rewrite external message IDs", async () => {
    const externalId = "opencode:some-machine:ses_xyz:msg_abc";
    const personaId = "persona-external-test";
    const state = createDefaultTestState();
    state.personas[personaId] = {
      entity: makePersona(personaId),
      messages: [makeMessage(externalId, true)],
    };

    const storage = createMockStorage(state);
    await processor.start(storage);

    const messages = processor.getStateManager().messages_get(personaId);
    expect(messages[0].id).toBe(externalId);
  });
});
