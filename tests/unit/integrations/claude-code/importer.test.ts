import { describe, it, expect, beforeEach, vi } from "vitest";
import { importClaudeCodeSessions } from "../../../../src/integrations/claude-code/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, HumanEntity, Message, ContextStatus } from "../../../../src/core/types.js";
import type { IClaudeCodeReader, ClaudeCodeSession, ClaudeCodeMessage } from "../../../../src/integrations/claude-code/types.js";
import { CLAUDE_CODE_PERSONA_NAME } from "../../../../src/integrations/claude-code/types.js";

const OLD_TIMESTAMP = "2020-01-01T00:00:00.000Z";
const FLOOR_TIMESTAMP = "2020-06-01T00:00:00.000Z";
const ABOVE_FLOOR_TIMESTAMP = "2020-12-01T00:00:00.000Z";

function makeSession(overrides: Partial<ClaudeCodeSession> & { id: string }): ClaudeCodeSession {
  return {
    cwd: "/test/project",
    title: "test",
    firstMessageAt: OLD_TIMESTAMP,
    lastMessageAt: OLD_TIMESTAMP,
    ...overrides,
  };
}

function makeMsg(id: string, sessionId: string, timestamp = OLD_TIMESTAMP): ClaudeCodeMessage {
  return {
    id,
    sessionId,
    role: "assistant",
    content: "Hello",
    timestamp,
  };
}

describe("importClaudeCodeSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<IClaudeCodeReader>;
  let mockHuman: HumanEntity;
  let messageStore: Map<string, Message[]>;
  let personaExists: boolean;
  let personaId: string;

  beforeEach(() => {
    messageStore = new Map();
    personaExists = false;
    personaId = "persona-claude-code";

    mockHuman = {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: OLD_TIMESTAMP,
      last_activity: OLD_TIMESTAMP,
    };

    mockStateManager = {
      getHuman: vi.fn(() => mockHuman),
      setHuman: vi.fn((h: HumanEntity) => { mockHuman = h; }),
      persona_getById: vi.fn((id: string) => {
        if (!personaExists || id !== personaId) return null;
        return {
          id: personaId,
          display_name: CLAUDE_CODE_PERSONA_NAME,
          entity: "system" as const,
          aliases: ["claude-code", "claude code"],
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: OLD_TIMESTAMP,
          last_activity: OLD_TIMESTAMP,
        };
      }),
      persona_getByName: vi.fn((name: string) => {
        if (!personaExists) return null;
        if (name === CLAUDE_CODE_PERSONA_NAME || name === "claude-code" || name === "claude code") {
          return {
            id: personaId,
            display_name: CLAUDE_CODE_PERSONA_NAME,
            entity: "system" as const,
            aliases: ["claude-code", "claude code"],
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: OLD_TIMESTAMP,
            last_activity: OLD_TIMESTAMP,
          };
        }
        return null;
      }),
      persona_add: vi.fn(() => {
        personaExists = true;
        return personaId;
      }),
      persona_update: vi.fn(),
      persona_archive: vi.fn(),
      messages_get: vi.fn((id: string) => messageStore.get(id) ?? []),
      messages_append: vi.fn((id: string, msg: Message) => {
        const existing = messageStore.get(id) ?? [];
        existing.push(msg);
        messageStore.set(id, existing);
      }),
      messages_remove: vi.fn((id: string, ids: string[]): Message[] => {
        const existing = messageStore.get(id) ?? [];
        const idSet = new Set(ids);
        const removed = existing.filter(m => idSet.has(m.id));
        messageStore.set(id, existing.filter(m => !idSet.has(m.id)));
        return removed;
      }),
      messages_sort: vi.fn(),
      messages_markExtracted: vi.fn(),
      messages_getUnextracted: vi.fn().mockReturnValue([]),
      human_topic_upsert: vi.fn(),
      queue_enqueue: vi.fn(),
    };

    mockInterface = {
      onPersonaAdded: vi.fn(),
      onMessageAdded: vi.fn(),
      onHumanUpdated: vi.fn(),
    };

    mockReader = {
      getSessions: vi.fn().mockResolvedValue([]),
      getMessagesForSession: vi.fn().mockResolvedValue([]),
    };
  });

  it("returns empty result when no sessions", async () => {
    const result = await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });
    expect(result.sessionsProcessed).toBe(0);
    expect(result.messagesImported).toBe(0);
  });

  it("imports messages from an unprocessed session", async () => {
    const session = makeSession({ id: "ses_1" });
    const msg = makeMsg("msg_1", "ses_1");

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    const result = await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.messagesImported).toBe(1);
  });

  it("advances extraction_point to session.lastMessageAt after import", async () => {
    const session = makeSession({ id: "ses_1", lastMessageAt: ABOVE_FLOOR_TIMESTAMP });
    const msg = makeMsg("msg_1", "ses_1", ABOVE_FLOOR_TIMESTAMP);

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(mockHuman.settings?.claudeCode?.extraction_point).toBe(ABOVE_FLOOR_TIMESTAMP);
  });

  it("records session in processed_sessions after import", async () => {
    const session = makeSession({ id: "ses_1" });
    const msg = makeMsg("msg_1", "ses_1");

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(mockHuman.settings?.claudeCode?.processed_sessions?.["ses_1"]).toBeDefined();
  });

  it("skips sessions below extraction_point that are already in processed_sessions", async () => {
    mockHuman.settings = {
      claudeCode: {
        extraction_point: FLOOR_TIMESTAMP,
        processed_sessions: { "ses_old": new Date().toISOString() },
      },
    };

    const sessions = [
      makeSession({ id: "ses_old", lastMessageAt: OLD_TIMESTAMP }),
      makeSession({ id: "ses_new", lastMessageAt: ABOVE_FLOOR_TIMESTAMP }),
    ];
    const msg = makeMsg("msg_new", "ses_new", ABOVE_FLOOR_TIMESTAMP);

    mockReader.getSessions = vi.fn().mockResolvedValue(sessions);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    const result = await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(mockHuman.settings?.claudeCode?.processed_sessions?.["ses_new"]).toBeDefined();
    expect(mockHuman.settings?.claudeCode?.processed_sessions?.["ses_old"]).toBeDefined();
  });

  it("does NOT skip sessions above extraction_point even if in processed_sessions", async () => {
    const recentImport = new Date(new Date(ABOVE_FLOOR_TIMESTAMP).getTime() - 1000).toISOString();
    mockHuman.settings = {
      claudeCode: {
        extraction_point: FLOOR_TIMESTAMP,
        processed_sessions: { "ses_above": recentImport },
      },
    };

    const updatedLastMessage = new Date(new Date(ABOVE_FLOOR_TIMESTAMP).getTime() + 5000).toISOString();
    const sessions = [
      makeSession({ id: "ses_above", lastMessageAt: updatedLastMessage }),
    ];
    const msg = makeMsg("msg_1", "ses_above", updatedLastMessage);

    mockReader.getSessions = vi.fn().mockResolvedValue(sessions);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    const result = await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(result.sessionsProcessed).toBe(1);
  });

  it("processes oldest session first when multiple are eligible", async () => {
    const sessions = [
      makeSession({ id: "ses_older", lastMessageAt: OLD_TIMESTAMP }),
      makeSession({ id: "ses_newer", lastMessageAt: ABOVE_FLOOR_TIMESTAMP }),
    ];
    const msg = makeMsg("msg_1", "ses_older");

    mockReader.getSessions = vi.fn().mockResolvedValue(sessions);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([msg]);

    await importClaudeCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IClaudeCodeReader,
    });

    expect(mockHuman.settings?.claudeCode?.processed_sessions?.["ses_older"]).toBeDefined();
    expect(mockHuman.settings?.claudeCode?.processed_sessions?.["ses_newer"]).toBeUndefined();
  });
});
