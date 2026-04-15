import { describe, it, expect, beforeEach, vi } from "vitest";
import { importCursorSessions } from "../../../../src/integrations/cursor/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, HumanEntity, Message, ContextStatus } from "../../../../src/core/types.js";
import type { ICursorReader, CursorSession } from "../../../../src/integrations/cursor/types.js";
import { isProcessRunning } from "../../../../src/integrations/process-check.js";

vi.mock("../../../../src/integrations/process-check.js", () => ({
  isProcessRunning: vi.fn().mockResolvedValue(true),
}));

function makeSession(overrides: Partial<CursorSession> & { id: string }): CursorSession {
  return {
    name: "Test Session",
    workspacePath: "/test/project",
    unifiedMode: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T01:00:00.000Z",
    messages: [
      {
        id: "bubble-1",
        type: 1,
        text: "Hello from user",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "bubble-2",
        type: 2,
        text: "Hello from assistant",
        timestamp: "2026-01-01T01:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function buildPersonaEntity(id: string, displayName: string, archived = false) {
  return {
    id,
    display_name: displayName,
    entity: "system" as const,
    aliases: [],
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: archived,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
    last_activity: "2026-01-01T00:00:00.000Z",
  };
}

describe("importCursorSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<ICursorReader>;
  let mockHuman: HumanEntity;
  let cursorPersona: ReturnType<typeof buildPersonaEntity> | null;
  let messageStore: Map<string, Message[]>;

  beforeEach(() => {
    cursorPersona = null;
    messageStore = new Map();

    mockHuman = {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: "2026-01-01T00:00:00.000Z",
      last_activity: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager = {
      getHuman: vi.fn(() => mockHuman),
      setHuman: vi.fn((h: HumanEntity) => { mockHuman = h; }),
      persona_getById: vi.fn((id: string) => {
        if (cursorPersona?.id === id) return cursorPersona;
        return null;
      }),
      persona_getByName: vi.fn((name: string) => {
        if (name === "Cursor" && cursorPersona) return cursorPersona;
        return null;
      }),
      persona_add: vi.fn((entity: { id?: string; display_name: string }) => {
        const id = entity.id ?? crypto.randomUUID();
        cursorPersona = buildPersonaEntity(id, entity.display_name);
        return id;
      }),
      persona_update: vi.fn(),
      persona_archive: vi.fn((id: string): boolean => {
        if (cursorPersona?.id === id) {
          cursorPersona = { ...cursorPersona, is_archived: true };
          return true;
        }
        return false;
      }),
      messages_get: vi.fn((personaId: string) => messageStore.get(personaId) ?? []),
      messages_append: vi.fn((personaId: string, msg: Message) => {
        const existing = messageStore.get(personaId) ?? [];
        existing.push(msg);
        messageStore.set(personaId, existing);
      }),
      messages_remove: vi.fn((personaId: string, ids: string[]) => {
        const existing = messageStore.get(personaId) ?? [];
        const idSet = new Set(ids);
        const removed = existing.filter((m) => idSet.has(m.id));
        messageStore.set(personaId, existing.filter((m) => !idSet.has(m.id)));
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
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  });

  it("returns empty result when no sessions found", async () => {
    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.messagesImported).toBe(0);
  });

  it("skips sessions too fresh (< 20 min old)", async () => {
    vi.mocked(isProcessRunning).mockResolvedValue(true);

    const freshSession = makeSession({
      id: "session-fresh",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(0);
  });

  it("imports fresh session when tool is not running", async () => {
    vi.mocked(isProcessRunning).mockResolvedValue(false);

    const freshSession = makeSession({
      id: "session-fresh",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(1);
  });

  it("imports a session with messages", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.messagesImported).toBe(2);
  });

  it("maps type 1 to human role and type 2 to system role", async () => {
    const session = makeSession({ id: "session-roles" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    const stored = messageStore.get(cursorPersona!.id) ?? [];
    expect(stored[0].role).toBe("human");
    expect(stored[1].role).toBe("system");
  });

  it("creates Cursor persona if not existing", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Cursor" })
    );
    expect(mockInterface.onPersonaAdded).toHaveBeenCalled();
  });

  it("does not create duplicate Cursor persona", async () => {
    cursorPersona = buildPersonaEntity("cursor-id", "Cursor");

    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockStateManager.persona_add).not.toHaveBeenCalled();
  });

  it("archives persona on import", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockStateManager.persona_archive).toHaveBeenCalledWith(cursorPersona!.id);
  });

  it("removes only external messages on re-import, preserves non-external chat history", async () => {
    cursorPersona = buildPersonaEntity("cursor-id", "Cursor");
    messageStore.set("cursor-id", [
      {
        id: "ext-msg",
        role: "human",
        verbal_response: "external session import",
        timestamp: "2025-01-01T00:00:00.000Z",
        read: true,
        context_status: "default" as ContextStatus,
        external: true,
      },
      {
        id: "chat-msg",
        role: "human",
        verbal_response: "regular chat message",
        timestamp: "2025-01-01T00:01:00.000Z",
        read: true,
        context_status: "default" as ContextStatus,
      },
    ]);

    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockStateManager.messages_remove).toHaveBeenCalledWith(
      "cursor-id",
      expect.arrayContaining(["ext-msg"])
    );
    const stored = messageStore.get("cursor-id") ?? [];
    expect(stored.some((m) => m.id === "ext-msg")).toBe(false);
    expect(stored.some((m) => m.id === "chat-msg")).toBe(true);
  });

  it("pre-marks messages before cutoff as fully extracted", async () => {
    const cutoff = "2026-01-01T00:30:00.000Z";
    mockHuman.settings = {
      cursor: {
        processed_sessions: { "session-abc": cutoff },
      },
    };

    cursorPersona = buildPersonaEntity("cursor-id", "Cursor");

    const session = makeSession({
      id: "session-abc",
      lastMessageAt: "2026-01-01T02:00:00.000Z",
      messages: [
        {
          id: "msg-old",
          type: 2,
          text: "Old response",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "msg-new",
          type: 2,
          text: "New response",
          timestamp: "2026-01-01T01:00:00.000Z",
        },
      ],
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    const stored = messageStore.get("cursor-id") ?? [];
    const oldMsg = stored.find((m) => m.id === "msg-old");
    const newMsg = stored.find((m) => m.id === "msg-new");

    expect(oldMsg).toMatchObject({ f: true, t: true, p: true, e: true });
    expect(newMsg?.f).toBeFalsy();
  });

  it("queues extraction scans for new messages", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.extractionScansQueued).toBe(4);
    expect(mockStateManager.queue_enqueue).toHaveBeenCalled();
  });

  it("queues no extraction when all messages are pre-marked", async () => {
    const cutoff = "2026-01-01T02:00:00.000Z";
    mockHuman.settings = {
      cursor: {
        processed_sessions: { "session-abc": cutoff },
      },
    };

    cursorPersona = buildPersonaEntity("cursor-id", "Cursor");

    const session = makeSession({
      id: "session-abc",
      lastMessageAt: "2026-01-01T03:00:00.000Z",
      messages: [
        {
          id: "msg-only",
          type: 2,
          text: "Old response",
          timestamp: "2026-01-01T01:00:00.000Z",
        },
      ],
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.extractionScansQueued).toBe(0);
    expect(mockStateManager.queue_enqueue).not.toHaveBeenCalled();
  });

  it("marks session in processed_sessions after import", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockHuman.settings?.cursor?.processed_sessions?.["session-abc"]).toBeDefined();
  });

  it("advances extraction_point after import", async () => {
    const session = makeSession({
      id: "session-abc",
      lastMessageAt: "2026-01-15T12:00:00.000Z",
    });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockHuman.settings?.cursor?.extraction_point).toBe("2026-01-15T12:00:00.000Z");
  });

  it("skips already-processed sessions (no updates since last import)", async () => {
    const processedAt = new Date(Date.now() - 1000).toISOString();
    mockHuman.settings = {
      cursor: {
        extraction_point: new Date(Date.now() - 100).toISOString(),
        processed_sessions: { "session-done": processedAt },
      },
    };

    const sessions = [
      makeSession({ id: "session-done", lastMessageAt: new Date(Date.now() - 2000).toISOString() }),
      makeSession({ id: "session-next" }),
    ];

    mockReader.getSessions = vi.fn().mockResolvedValue(sessions);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(mockHuman.settings?.cursor?.processed_sessions?.["session-next"]).toBeDefined();
  });

  it("isArchived sessions ARE imported normally", async () => {
    const archivedSession = makeSession({
      id: "session-archived",
      name: "Archived Session",
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([archivedSession]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.messagesImported).toBe(2);
  });

  it("passes sources with session id in ExtractionContext", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    const enqueued = mockStateManager.queue_enqueue.mock.calls;
    expect(enqueued.length).toBeGreaterThan(0);
    const firstData = enqueued[0][0].data as Record<string, unknown>;
    expect(firstData.sources).toEqual(["cursor:session-abc"]);
  });

  it("fires onMessageAdded after import", async () => {
    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
    });

    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(cursorPersona!.id);
  });

  it("aborts early when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const session = makeSession({ id: "session-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCursorSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICursorReader,
      signal: controller.signal,
    });

    expect(result.sessionsProcessed).toBe(0);
  });
});
