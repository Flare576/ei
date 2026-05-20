import { describe, it, expect, beforeEach, vi } from "vitest";
import { importPiSessions } from "../../../../src/integrations/pi/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { ContextStatus, Ei_Interface, HumanEntity, Message } from "../../../../src/core/types.js";
import type { IPiReader, PiSession } from "../../../../src/integrations/pi/types.js";
import { isProcessRunning } from "../../../../src/integrations/process-check.js";

vi.mock("../../../../src/integrations/process-check.js", () => ({
  isProcessRunning: vi.fn().mockResolvedValue(true),
}));

function makeSession(overrides: Partial<PiSession> & { id: string }): PiSession {
  return {
    title: "Test Pi Session",
    cwd: "/test/project",
    firstMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T01:00:00.000Z",
    messages: [
      {
        id: `${overrides.id}/aa000001`,
        sessionId: overrides.id,
        role: "user",
        content: "Hello from user",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `${overrides.id}/aa000002`,
        sessionId: overrides.id,
        role: "assistant",
        content: "Hello from Pi",
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
  };
}

describe("importPiSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<IPiReader>;
  let mockHuman: HumanEntity;
  let piPersona: ReturnType<typeof buildPersonaEntity> | null;
  let messageStore: Map<string, Message[]>;

  beforeEach(() => {
    vi.mocked(isProcessRunning).mockResolvedValue(true);
    piPersona = null;
    messageStore = new Map();

    mockHuman = {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager = {
      getHuman: vi.fn(() => mockHuman),
      setHuman: vi.fn((h: HumanEntity) => { mockHuman = h; }),
      persona_getById: vi.fn((id: string) => {
        if (piPersona?.id === id) return piPersona;
        return null;
      }),
      persona_getByName: vi.fn((name: string) => {
        if (name === "Pi" && piPersona) return piPersona;
        return null;
      }),
      persona_add: vi.fn((entity: { id?: string; display_name: string }) => {
        const id = entity.id ?? crypto.randomUUID();
        piPersona = buildPersonaEntity(id, entity.display_name);
        return id;
      }),
      persona_update: vi.fn(),
      persona_archive: vi.fn((id: string): boolean => {
        if (piPersona?.id === id) {
          piPersona = { ...piPersona, is_archived: true };
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
      getMessageById: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  });

  it("returns empty result when no sessions found", async () => {
    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.messagesImported).toBe(0);
  });

  it("skips sessions too fresh while Pi is running", async () => {
    const freshSession = makeSession({
      id: "019e45e3-e2e5-7174-8165-da221c147ebb",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.sessionsProcessed).toBe(0);
  });

  it("imports fresh session when Pi is not running", async () => {
    vi.mocked(isProcessRunning).mockResolvedValue(false);

    const freshSession = makeSession({
      id: "019e45e3-e2e5-7174-8165-da221c147ebb",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.sessionsProcessed).toBe(1);
  });

  it("imports messages and maps roles correctly", async () => {
    const session = makeSession({ id: "019e45e3-e2e5-7174-8165-da221c147ebb" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.messagesImported).toBe(2);

    const stored = messageStore.get(piPersona!.id) ?? [];
    expect(stored[0].role).toBe("human");
    expect(stored[1].role).toBe("system");
  });

  it("creates and archives Pi persona if missing", async () => {
    const session = makeSession({ id: "019e45e3-e2e5-7174-8165-da221c147ebb" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Pi" })
    );
    expect(mockStateManager.persona_archive).toHaveBeenCalledWith(piPersona!.id);
    expect(mockInterface.onPersonaAdded).toHaveBeenCalled();
  });

  it("removes only external messages on re-import", async () => {
    piPersona = buildPersonaEntity("pi-id", "Pi");
    messageStore.set("pi-id", [
      {
        id: "ext-msg",
        role: "human",
        content: "external session import",
        timestamp: "2025-01-01T00:00:00.000Z",
        read: true,
        context_status: "default" as ContextStatus,
        external: true,
      },
      {
        id: "chat-msg",
        role: "human",
        content: "regular chat message",
        timestamp: "2025-01-01T00:01:00.000Z",
        read: true,
        context_status: "default" as ContextStatus,
      },
    ]);

    const session = makeSession({ id: "019e45e3-e2e5-7174-8165-da221c147ebb" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    const stored = messageStore.get("pi-id") ?? [];
    expect(stored.some((m) => m.id === "ext-msg")).toBe(false);
    expect(stored.some((m) => m.id === "chat-msg")).toBe(true);
  });

  it("pre-marks messages before cutoff as fully extracted", async () => {
    const sessionId = "019e45e3-e2e5-7174-8165-da221c147ebb";
    mockHuman.settings = {
      pi: {
        processed_sessions: { [sessionId]: "2026-01-01T00:30:00.000Z" },
      },
    };
    piPersona = buildPersonaEntity("pi-id", "Pi");

    const session = makeSession({
      id: sessionId,
      lastMessageAt: "2026-01-01T02:00:00.000Z",
      messages: [
        {
          id: `${sessionId}/aa000001`,
          sessionId,
          role: "assistant",
          content: "Old response",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          id: `${sessionId}/aa000002`,
          sessionId,
          role: "assistant",
          content: "New response",
          timestamp: "2026-01-01T01:00:00.000Z",
        },
      ],
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    const stored = messageStore.get("pi-id") ?? [];
    const oldMsg = stored.find((m) => m.id.includes("aa000001"));
    const newMsg = stored.find((m) => m.id.includes("aa000002"));

    expect(oldMsg).toMatchObject({ f: true, t: true, p: true, e: true });
    expect(newMsg?.f).toBeFalsy();
  });

  it("queues extraction scans with pi source", async () => {
    const session = makeSession({ id: "019e45e3-e2e5-7174-8165-da221c147ebb" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.extractionScansQueued).toBe(4);
    const enqueued = vi.mocked(mockStateManager.queue_enqueue).mock.calls;
    expect(enqueued.length).toBeGreaterThan(0);
    const firstData = enqueued[0][0].data as Record<string, unknown>;
    expect(firstData.sources as string[]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pi:[^:]+:019e45e3/)])
    );
  });

  it("marks session in processed_sessions and advances extraction_point", async () => {
    const session = makeSession({
      id: "019e45e3-e2e5-7174-8165-da221c147ebb",
      lastMessageAt: "2026-01-15T12:00:00.000Z",
    });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(
      mockHuman.settings?.pi?.processed_sessions?.["019e45e3-e2e5-7174-8165-da221c147ebb"]
    ).toBeDefined();
    expect(mockHuman.settings?.pi?.extraction_point).toBe("2026-01-15T12:00:00.000Z");
  });

  it("skips already-processed sessions that haven't been updated", async () => {
    const sessionId = "019e45e3-e2e5-7174-8165-da221c147ebb";
    const lastMessageAt = "2026-01-01T01:00:00.000Z";
    mockHuman.settings = {
      pi: {
        processed_sessions: { [sessionId]: new Date(Date.now()).toISOString() },
      },
    };

    const session = makeSession({ id: sessionId, lastMessageAt });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importPiSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IPiReader,
    });

    expect(result.sessionsProcessed).toBe(0);
  });
});
