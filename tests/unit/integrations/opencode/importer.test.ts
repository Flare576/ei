import { describe, it, expect, beforeEach, vi } from "vitest";
import { importOpenCodeSessions } from "../../../../src/integrations/opencode/importer.js";
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

  function buildPersonaEntity(name: string, data: { id: string; display_name: string }, archived = false) {
    return {
      id: data.id,
      display_name: data.display_name,
      entity: "system" as const,
      aliases: [name],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: archived,
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
      persona_archive: vi.fn(),
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
    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.topicsCreated).toBe(0);
    expect(result.messagesImported).toBe(0);
    expect(result.personasCreated).toEqual([]);
  });

  it("creates topic for new session", async () => {
    const session = makeSession({ id: "ses_test123", title: "Test Session" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions({
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

    const result = await importOpenCodeSessions({
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

    const result = await importOpenCodeSessions({
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

    const result = await importOpenCodeSessions({
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

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.personasCreated).not.toContain("build");
  });

  it("archives persona on first encounter", async () => {
    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    expect(mockStateManager.persona_archive).toHaveBeenCalledWith(buildPersona!.id);
  });

  it("clears existing messages before writing new session", async () => {
    createdPersonas.set("build", { id: "persona-build", display_name: "build" });
    messageStore.set("persona-build", [
      makeMessage({ id: "old_msg", timestamp: "2026-01-01T00:00:00.000Z" }),
    ]);

    const session = makeSession({ id: "ses_new" });
    const message: OpenCodeMessage = {
      id: "msg_new",
      sessionId: "ses_new",
      role: "assistant",
      agent: "build",
      content: "New content",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockStateManager.messages_remove).toHaveBeenCalledWith(
      "persona-build",
      expect.arrayContaining(["old_msg"])
    );
    const stored = messageStore.get("persona-build") ?? [];
    expect(stored.some(m => m.id === "old_msg")).toBe(false);
    expect(stored.some(m => m.id === "msg_new")).toBe(true);
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

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(2);

    const buildPersona = createdPersonas.get("build");
    expect(buildPersona).toBeDefined();

    const stored = messageStore.get(buildPersona!.id) ?? [];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ id: "msg_user1", role: "human", verbal_response: "User message" });
    expect(stored[1]).toMatchObject({ id: "msg_assist1", role: "system", verbal_response: "Assistant response" });
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

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const stored = messageStore.get(buildPersona!.id) ?? [];
    expect(stored[0].role).toBe("human");
    expect(stored[1].role).toBe("system");
  });

  it("pre-marks messages before cutoff as fully extracted", async () => {
    const cutoff = "2026-02-01T12:00:00.000Z";
    mockHuman.settings = {
      opencode: {
        extraction_point: new Date(1000).toISOString(),
        processed_sessions: { "ses_test123": cutoff },
      },
    };

    createdPersonas.set("build", { id: "persona-build", display_name: "build" });

    const session = makeSession({ id: "ses_test123", time: { created: 500, updated: new Date("2026-02-01T15:00:00.000Z").getTime() } });
    const messages: OpenCodeMessage[] = [
      {
        id: "msg_old",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Old message",
        timestamp: "2026-02-01T10:00:00.000Z",
      },
      {
        id: "msg_new",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "New message",
        timestamp: "2026-02-01T14:00:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const stored = messageStore.get("persona-build") ?? [];
    const oldMsg = stored.find(m => m.id === "msg_old");
    const newMsg = stored.find(m => m.id === "msg_new");

    expect(oldMsg).toMatchObject({ f: true, r: true, p: true, o: true });
    expect(newMsg?.f).toBeFalsy();
    expect(newMsg?.r).toBeFalsy();
  });

  it("queues extraction only for messages after cutoff", async () => {
    const cutoff = "2026-02-01T12:00:00.000Z";
    mockHuman.settings = {
      opencode: {
        extraction_point: new Date(1000).toISOString(),
        processed_sessions: { "ses_test123": cutoff },
      },
    };

    createdPersonas.set("build", { id: "persona-build", display_name: "build" });

    const session = makeSession({ id: "ses_test123", time: { created: 500, updated: new Date("2026-02-01T15:00:00.000Z").getTime() } });
    const messages: OpenCodeMessage[] = [
      {
        id: "msg_old",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Old message",
        timestamp: "2026-02-01T10:00:00.000Z",
      },
      {
        id: "msg_new",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "New message",
        timestamp: "2026-02-01T14:00:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.extractionScansQueued).toBe(4);
    expect(mockStateManager.queue_enqueue).toHaveBeenCalled();
  });

  it("queues no extraction when all messages are pre-marked", async () => {
    const cutoff = "2026-02-02T00:00:00.000Z";
    mockHuman.settings = {
      opencode: {
        extraction_point: new Date(1000).toISOString(),
        processed_sessions: { "ses_test123": cutoff },
      },
    };

    createdPersonas.set("build", { id: "persona-build", display_name: "build" });

    const session = makeSession({ id: "ses_test123", time: { created: 500, updated: new Date("2026-02-02T06:00:00.000Z").getTime() } });
    const message: OpenCodeMessage = {
      id: "msg_old",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Old message",
      timestamp: "2026-02-01T10:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.extractionScansQueued).toBe(0);
    expect(mockStateManager.queue_enqueue).not.toHaveBeenCalled();
  });

  it("advances extraction_point after processing", async () => {
    const session = makeSession({ id: "ses_test123", time: { created: 1000, updated: 5000 } });
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

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockHuman.settings?.opencode?.extraction_point).toBe(new Date(5000).toISOString());
  });

  it("records session in processed_sessions after processing", async () => {
    const session = makeSession({ id: "ses_test123" });
    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Hello",
      timestamp: "2026-02-01T12:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockHuman.settings?.opencode?.processed_sessions?.["ses_test123"]).toBeDefined();
  });

  it("processes oldest unprocessed session first when multiple exist", async () => {
    const sessions: OpenCodeSession[] = [
      makeSession({ id: "ses_new", title: "New Session", time: { created: 3000, updated: 4000 } }),
      makeSession({ id: "ses_old", title: "Old Session", time: { created: 1000, updated: 2000 } }),
    ];

    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_old",
      role: "assistant",
      agent: "build",
      content: "Hello",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(mockHuman.settings?.opencode?.processed_sessions?.["ses_old"]).toBeDefined();
    expect(mockHuman.settings?.opencode?.processed_sessions?.["ses_new"]).toBeUndefined();
  });

  it("skips already-processed sessions", async () => {
    mockHuman.settings = {
      opencode: {
        extraction_point: new Date(2000).toISOString(),
        processed_sessions: { "ses_done": new Date().toISOString() },
      },
    };

    const sessions: OpenCodeSession[] = [
      makeSession({ id: "ses_done", title: "Done", time: { created: 1000, updated: 2000 } }),
      makeSession({ id: "ses_next", title: "Next", time: { created: 3000, updated: 4000 } }),
    ];

    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_next",
      role: "assistant",
      agent: "build",
      content: "Hello",
      timestamp: "2026-02-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(mockHuman.settings?.opencode?.processed_sessions?.["ses_next"]).toBeDefined();
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

    await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const sisyphusPersona = createdPersonas.get("Sisyphus");

    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(buildPersona!.id);
    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(sisyphusPersona!.id);
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

    await importOpenCodeSessions({
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

  it("skips child sessions (parentId set)", async () => {
    const sessions: OpenCodeSession[] = [
      makeSession({ id: "ses_parent", title: "Parent" }),
      makeSession({ id: "ses_child", title: "Child", parentId: "ses_parent" }),
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.topicsCreated).toBe(1);
    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ses_parent" })
    );
  });

  it("queues extraction scans on fresh session", async () => {
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

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.extractionScansQueued).toBeGreaterThan(0);
    expect(mockStateManager.queue_enqueue).toHaveBeenCalled();
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

    const result = await importOpenCodeSessions({
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

    const result = await importOpenCodeSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.messagesImported).toBe(1);
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

    const result = await importOpenCodeSessions({
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

  it("uses first agent as learned_by for topic", async () => {
    const session = makeSession({ id: "ses_test123" });

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getFirstAgent = vi.fn().mockResolvedValue("sisyphus");

    await importOpenCodeSessions({
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

    await importOpenCodeSessions({
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
});
