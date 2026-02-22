import { describe, it, expect, beforeEach, vi } from "vitest";
import { importOpenCodeSessions, pruneImportMessages } from "../../../../src/integrations/opencode/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, HumanEntity, Topic, Message, ContextStatus } from "../../../../src/core/types.js";
import type { IOpenCodeReader, OpenCodeSession, OpenCodeMessage } from "../../../../src/integrations/opencode/types.js";
import { AGENT_ALIASES } from "../../../../src/integrations/opencode/types.js";

function makeMessage(overrides: Partial<Message> & { id: string; timestamp: string }): Message {
  return {
    role: "human",
    content: "test",
    read: true,
    context_status: "default" as ContextStatus,
    ...overrides,
  };
}

function makeSession(overrides: Partial<OpenCodeSession> & { id: string }): OpenCodeSession {
  return {
    title: "Test Session",
    directory: "/test/project",
    projectId: "proj123",
    time: { created: 1000, updated: 2000 },
    ...overrides,
  };
}

describe("importOpenCodeSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<IOpenCodeReader>;
  let mockHuman: HumanEntity;
  let createdPersonas: Map<string, { id: string; display_name: string }>;
  let messageStore: Map<string, Message[]>;

  function buildPersonaEntity(name: string, data: { id: string; display_name: string }) {
    return {
      id: data.id,
      display_name: data.display_name,
      entity: "system" as const,
      aliases: [name],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: "2026-01-01T00:00:00.000Z",
      last_activity: "2026-01-01T00:00:00.000Z",
    };
  }

  beforeEach(() => {
    createdPersonas = new Map();
    messageStore = new Map();

    mockHuman = {
      entity: "human",
      facts: [],
      traits: [],
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
        for (const [, data] of createdPersonas.entries()) {
          if (data.id === id) return buildPersonaEntity(data.display_name, data);
        }
        return null;
      }),
      persona_getByName: vi.fn((name: string) => {
        const direct = createdPersonas.get(name);
        if (direct) return buildPersonaEntity(name, direct);

        for (const [canonical, variants] of Object.entries(AGENT_ALIASES)) {
          if (variants.includes(name)) {
            const data = createdPersonas.get(canonical);
            if (data) return buildPersonaEntity(canonical, data);
          }
        }
        return null;
      }),
      persona_getAll: vi.fn(() => {
        const result: ReturnType<typeof buildPersonaEntity>[] = [];
        for (const [name, data] of createdPersonas) {
          result.push(buildPersonaEntity(name, data));
        }
        return result;
      }),
      persona_add: vi.fn((entity: { id?: string; display_name: string }) => {
        const id = entity.id || crypto.randomUUID();
        createdPersonas.set(entity.display_name, { id, display_name: entity.display_name });
        return id;
      }),
      persona_update: vi.fn(),
      messages_get: vi.fn((personaId: string) => messageStore.get(personaId) ?? []),
      messages_append: vi.fn((personaId: string, msg: Message) => {
        const existing = messageStore.get(personaId) ?? [];
        existing.push(msg);
        messageStore.set(personaId, existing);
      }),
      messages_remove: vi.fn((personaId: string, ids: string[]): Message[] => {
        const existing = messageStore.get(personaId) ?? [];
        const idSet = new Set(ids);
        const removed = existing.filter(m => idSet.has(m.id));
        messageStore.set(personaId, existing.filter(m => !idSet.has(m.id)));
        return removed;
      }),
      messages_sort: vi.fn(),
      human_topic_upsert: vi.fn(),
      queue_enqueue: vi.fn(),
    };

    mockInterface = {
      onPersonaAdded: vi.fn(),
      onMessageAdded: vi.fn(),
      onHumanUpdated: vi.fn(),
    };

    mockReader = {
      getSessionsUpdatedSince: vi.fn().mockResolvedValue([]),
      getSessionsInRange: vi.fn().mockResolvedValue([]),
      getMessagesForSession: vi.fn().mockResolvedValue([]),
      getFirstAgent: vi.fn().mockResolvedValue("build"),
      getAgentInfo: vi.fn().mockResolvedValue({ name: "build", description: "Main agent" }),
      getAllUniqueAgents: vi.fn().mockResolvedValue([]),
    };
  });

  it("returns empty result when no sessions found", async () => {
    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.topicsCreated).toBe(0);
    expect(result.messagesImported).toBe(0);
    expect(result.personasCreated).toEqual([]);
    expect(result.messagesPruned).toBe(0);
    expect(result.archiveScansQueued).toBe(0);
  });

  it("creates topic for new session", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test Session" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.topicsCreated).toBe(1);
    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ses_test123",
        name: "Test Session",
        persona_groups: ["General", "Coding", "OpenCode"],
        learned_by: "build",
      })
    );
    expect(mockInterface.onHumanUpdated).toHaveBeenCalled();
  });

  it("updates topic when session title changes", async () => {
    const existingTopic: Topic = {
      id: "ses_test123",
      name: "Old Title",
      description: "",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.3,
      persona_groups: ["General", "Coding", "OpenCode"],
      learned_by: "build",
      last_updated: "2026-01-01T00:00:00.000Z",
    };
    mockHuman.topics = [existingTopic];

    const session = makeSession({ id: "ses_test123", title: "New Title" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.topicsUpdated).toBe(1);
    expect(result.topicsCreated).toBe(0);
    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ses_test123",
        name: "New Title",
      })
    );
  });

  it("does not update topic when title unchanged", async () => {
    const existingTopic: Topic = {
      id: "ses_test123",
      name: "Same Title",
      description: "",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.3,
      persona_groups: ["General", "Coding", "OpenCode"],
      learned_by: "build",
      last_updated: "2026-01-01T00:00:00.000Z",
    };
    mockHuman.topics = [existingTopic];

    const session = makeSession({ id: "ses_test123", title: "Same Title" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.topicsUpdated).toBe(0);
    expect(result.topicsCreated).toBe(0);
  });

  it("creates persona for new agent", async () => {
    const session = makeSession({ id: "ses_test123" });

    const message: OpenCodeMessage = {
      id: "msg_test1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello from build",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.personasCreated).toContain("build");
    expect(mockStateManager.persona_add).toHaveBeenCalled();
  });

  it("does not create duplicate persona", async () => {
    createdPersonas.set("build", { id: "persona-build", display_name: "build" });

    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_test1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.personasCreated).not.toContain("build");
  });

  it("imports messages to correct persona", async () => {
    const session = makeSession({ id: "ses_test123" });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_user1",
        sessionId: "ses_test123",
        role: "user",
        agent: "build",
        content: "User message",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_assist1",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Assistant response",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(2);

    const buildPersona = createdPersonas.get("build");
    expect(buildPersona).toBeDefined();

    const stored = messageStore.get(buildPersona!.id) ?? [];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ id: "msg_user1", role: "human", content: "User message" });
    expect(stored[1]).toMatchObject({ id: "msg_assist1", role: "system", content: "Assistant response" });
  });

  it("maps user role to human and assistant to system", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test" });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_1",
        sessionId: "ses_test123",
        role: "user",
        agent: "build",
        content: "From user",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "From assistant",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const stored = messageStore.get(buildPersona!.id) ?? [];
    expect(stored[0].role).toBe("human");
    expect(stored[1].role).toBe("system");
  });

  it("marks imported messages as read", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Test",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const stored = messageStore.get(buildPersona!.id) ?? [];
    expect(stored[0].read).toBe(true);
  });

  it("updates persona last_activity after import", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Test",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    expect(mockStateManager.persona_update).toHaveBeenCalledWith(
      buildPersona!.id,
      expect.objectContaining({
        last_activity: expect.any(String),
      })
    );
  });

  it("fires onMessageAdded for each impacted persona", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test" });

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_1",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "From build",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "sisyphus",
        content: "From sisyphus",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const sisyphusPersona = createdPersonas.get("Sisyphus");

    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(buildPersona!.id);
    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(sisyphusPersona!.id);
  });

  it("processes multiple sessions", async () => {
    const sessions: OpenCodeSession[] = [
      makeSession({ id: "ses_1", title: "Session 1" }),
      makeSession({ id: "ses_2", title: "Session 2", time: { created: 3000, updated: 4000 } }),
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(2);
    expect(result.topicsCreated).toBe(2);
  });

  it("uses first agent as learned_by for topic", async () => {
    const session = makeSession({ id: "ses_test123" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getFirstAgent = vi.fn().mockResolvedValue("sisyphus");

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        learned_by: "sisyphus",
      })
    );
  });

  it("defaults learned_by to build when no first agent", async () => {
    const session = makeSession({ id: "ses_test123" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getFirstAgent = vi.fn().mockResolvedValue(null);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        learned_by: "build",
      })
    );
  });

  it("deduplicates messages already in state", async () => {
    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_existing",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Already imported",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    createdPersonas.set("build", { id: "persona-build", display_name: "build" });
    messageStore.set("persona-build", [
      makeMessage({ id: "msg_existing", timestamp: "2026-02-01T00:00:00.000Z", role: "system", content: "Already imported" }),
    ]);

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(0);
    expect(messageStore.get("persona-build")).toHaveLength(1);
  });

  it("resolves agent aliases to canonical persona", async () => {
    const session = makeSession({ id: "ses_test123" });
    const messages: OpenCodeMessage[] = [
      {
        id: "msg_1",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "sisyphus",
        content: "From lowercase sisyphus",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "Sisyphus (Ultraworker)",
        content: "From ultraworker variant",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(createdPersonas.has("Sisyphus")).toBe(true);
    expect(result.messagesImported).toBe(2);

    const sisyphusPersona = createdPersonas.get("Sisyphus");
    const stored = messageStore.get(sisyphusPersona!.id) ?? [];
    expect(stored).toHaveLength(2);
  });

  it("filters out utility agent messages", async () => {
    const session = makeSession({ id: "ses_test123" });
    const messages: OpenCodeMessage[] = [
      {
        id: "msg_real",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Real message",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_utility",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "compaction",
        content: "Utility message",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(1);
    expect(createdPersonas.has("compaction")).toBe(false);
  });

  it("filters out agent-to-agent messages", async () => {
    const session = makeSession({ id: "ses_test123" });
    const messages: OpenCodeMessage[] = [
      {
        id: "msg_real",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Real message",
        timestamp: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "msg_a2a",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "[CONTEXT] This is agent-to-agent communication",
        timestamp: "2026-02-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(1);
  });

  it("skips child sessions (parentId set)", async () => {
    const sessions: OpenCodeSession[] = [
      makeSession({ id: "ses_parent", title: "Parent" }),
      makeSession({ id: "ses_child", title: "Child", parentId: "ses_parent" }),
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.topicsCreated).toBe(1);
    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ses_parent" })
    );
  });

  it("queues extraction scans on first import", async () => {
    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello world",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.extractionScansQueued).toBeGreaterThan(0);
    expect(mockStateManager.queue_enqueue).toHaveBeenCalled();
  });

  it("sets extraction_point on first import", async () => {
    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello world",
      timestamp: "2026-02-01T12:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockHuman.settings?.opencode?.extraction_point).toBeDefined();
  });
});

describe("pruneImportMessages", () => {
  const oldTimestamp = "2020-01-01T00:00:00.000Z";
  const recentTimestamp = new Date().toISOString();

  it("keeps all messages when under minMessages", () => {
    const merged = Array.from({ length: 10 }, (_, i) => ({
      id: `msg_${i}`,
      timestamp: oldTimestamp,
    }));

    const result = pruneImportMessages(merged, [], 200);
    expect(result).toHaveLength(10);
  });

  it("prunes old external messages when over minMessages", () => {
    const recentFiller = Array.from({ length: 200 }, (_, i) => ({
      id: `recent_${i}`,
      timestamp: recentTimestamp,
    }));

    const oldExternal = Array.from({ length: 10 }, (_, i) => ({
      id: `old_ext_${i}`,
      timestamp: oldTimestamp,
      isExternal: true as const,
      sessionId: "ses_old",
    }));

    const merged = [...recentFiller, ...oldExternal];
    const result = pruneImportMessages(merged, [], 200);

    expect(result).toHaveLength(200);
    for (const ext of oldExternal) {
      expect(result).not.toContain(ext.id);
    }
  });

  it("prunes old fully-extracted messages when over minMessages", () => {
    const fullyExtracted: Message[] = Array.from({ length: 10 }, (_, i) =>
      makeMessage({
        id: `extracted_${i}`,
        timestamp: oldTimestamp,
        f: true,
        r: true,
        p: true,
        o: true,
      })
    );

    const recentMinis = Array.from({ length: 200 }, (_, i) => ({
      id: `recent_${i}`,
      timestamp: recentTimestamp,
    }));

    const merged = [
      ...fullyExtracted.map(m => ({ id: m.id, timestamp: m.timestamp })),
      ...recentMinis,
    ];

    const result = pruneImportMessages(merged, fullyExtracted, 200);
    expect(result).toHaveLength(200);
    for (const m of fullyExtracted) {
      expect(result).not.toContain(m.id);
    }
  });

  it("keeps old messages that are not fully extracted", () => {
    const partiallyExtracted: Message[] = [
      makeMessage({ id: "partial_1", timestamp: oldTimestamp, f: true, r: true }),
    ];

    const recentMinis = Array.from({ length: 200 }, (_, i) => ({
      id: `recent_${i}`,
      timestamp: recentTimestamp,
    }));

    const merged = [
      { id: "partial_1", timestamp: oldTimestamp },
      ...recentMinis,
    ];

    const result = pruneImportMessages(merged, partiallyExtracted, 200);
    expect(result).toContain("partial_1");
  });

  it("never prunes below minMessages regardless of age", () => {
    const oldMessages = Array.from({ length: 201 }, (_, i) => ({
      id: `old_ext_${i}`,
      timestamp: oldTimestamp,
      isExternal: true as const,
      sessionId: "ses_old",
    }));

    const result = pruneImportMessages(oldMessages, [], 200);
    expect(result).toHaveLength(200);
  });
});
