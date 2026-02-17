import { describe, it, expect, beforeEach, vi } from "vitest";
import { importOpenCodeSessions } from "../../../../src/integrations/opencode/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, HumanEntity, Topic } from "../../../../src/core/types.js";
import type { OpenCodeReader } from "../../../../src/integrations/opencode/reader.js";
import type { OpenCodeSession, OpenCodeMessage } from "../../../../src/integrations/opencode/types.js";

describe("importOpenCodeSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<OpenCodeReader>;
  let mockHuman: HumanEntity;
  let createdPersonas: Map<string, { id: string; display_name: string }>;

  beforeEach(() => {
    createdPersonas = new Map();
    
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
      getHuman: vi.fn().mockReturnValue(mockHuman),
      setHuman: vi.fn((h: HumanEntity) => Object.assign(mockHuman, h)),
      persona_getById: vi.fn((id: string) => {
        for (const [name, data] of createdPersonas.entries()) {
          if (data.id === id) {
            return {
              id,
              display_name: name,
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
        }
        return null;
      }),
      persona_getByName: vi.fn((name: string) => {
        const data = createdPersonas.get(name);
        if (!data) return null;
        return {
          id: data.id,
          display_name: name,
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
      }),
      persona_getAll: vi.fn().mockReturnValue([]),
      persona_add: vi.fn((entity) => {
        const id = entity.id || crypto.randomUUID();
        createdPersonas.set(entity.display_name, { id, display_name: entity.display_name });
        return id;
      }),
      persona_update: vi.fn(),
      messages_get: vi.fn().mockReturnValue([]),
      messages_append: vi.fn(),
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
      getMessagesForSession: vi.fn().mockResolvedValue([]),
      getFirstAgent: vi.fn().mockResolvedValue("build"),
      getAgentInfo: vi.fn().mockResolvedValue({ name: "build", description: "Main agent" }),
    };
  });

  it("returns empty result when no sessions found", async () => {
    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.topicsCreated).toBe(0);
    expect(result.messagesImported).toBe(0);
    expect(result.personasCreated).toEqual([]);
  });

  it("creates topic for new session", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
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

    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "New Title",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
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

    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Same Title",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.topicsUpdated).toBe(0);
    expect(result.topicsCreated).toBe(0);
  });

  it("creates persona for new agent", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const message: OpenCodeMessage = {
      id: "msg_test1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "sisyphus",
      content: "Hello from Sisyphus",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.personasCreated).toContain("sisyphus");
    expect(mockStateManager.persona_add).toHaveBeenCalled();
  });

  it("does not create duplicate persona", async () => {
    const existingPersona = {
      entity: "system" as const,
      aliases: ["sisyphus"],
      is_static: true,
      is_paused: false,
      is_archived: false,
      traits: [],
      topics: [],
      last_updated: "2026-01-01T00:00:00.000Z",
      last_activity: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager.persona_getByName = vi.fn().mockImplementation((name: string) =>
      name === "sisyphus" ? existingPersona : null
    );

    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const message: OpenCodeMessage = {
      id: "msg_test1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "sisyphus",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.personasCreated).not.toContain("sisyphus");
  });

  it("imports messages to correct persona", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test/project",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_user1",
        sessionId: "ses_test123",
        role: "user",
        agent: "build",
        content: "User message",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "msg_assist1",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "Assistant response",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.messagesImported).toBe(2);
    expect(mockStateManager.messages_append).toHaveBeenCalledTimes(2);
    
    // Get the persona ID that was created for "build"
    const buildPersona = createdPersonas.get("build");
    expect(buildPersona).toBeDefined();
    
    expect(mockStateManager.messages_append).toHaveBeenCalledWith(
      buildPersona!.id,
      expect.objectContaining({
        id: "msg_user1",
        role: "human",
        content: "User message",
      })
    );
    expect(mockStateManager.messages_append).toHaveBeenCalledWith(
      buildPersona!.id,
      expect.objectContaining({
        id: "msg_assist1",
        role: "system",
        content: "Assistant response",
      })
    );
  });

  it("maps user role to human and assistant to system", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_1",
        sessionId: "ses_test123",
        role: "user",
        agent: "build",
        content: "From user",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "From assistant",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    const calls = (mockStateManager.messages_append as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].role).toBe("human");
    expect(calls[1][1].role).toBe("system");
  });

  it("marks imported messages as read", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Test",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    expect(mockStateManager.messages_append).toHaveBeenCalledWith(
      buildPersona!.id,
      expect.objectContaining({
        read: true,
      })
    );
  });

  it("updates persona last_activity after import", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const message: OpenCodeMessage = {
      id: "msg_1",
      sessionId: "ses_test123",
      role: "assistant",
      agent: "build",
      content: "Test",
      timestamp: "2026-01-01T00:00:00.000Z",
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue([message]);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
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
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    const messages: OpenCodeMessage[] = [
      {
        id: "msg_1",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "build",
        content: "From build",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "msg_2",
        sessionId: "ses_test123",
        role: "assistant",
        agent: "sisyphus",
        content: "From sisyphus",
        timestamp: "2026-01-01T00:01:00.000Z",
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getMessagesForSession = vi.fn().mockResolvedValue(messages);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    const buildPersona = createdPersonas.get("build");
    const sisyphusPersona = createdPersonas.get("sisyphus");
    
    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(buildPersona!.id);
    expect(mockInterface.onMessageAdded).toHaveBeenCalledWith(sisyphusPersona!.id);
  });

  it("processes multiple sessions", async () => {
    const sessions: OpenCodeSession[] = [
      {
        id: "ses_1",
        title: "Session 1",
        directory: "/test",
        projectId: "proj123",
        time: { created: 1000, updated: 2000 },
      },
      {
        id: "ses_2",
        title: "Session 2",
        directory: "/test",
        projectId: "proj123",
        time: { created: 3000, updated: 4000 },
      },
    ];

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue(sessions);

    const result = await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.sessionsProcessed).toBe(2);
    expect(result.topicsCreated).toBe(2);
  });

  it("uses first agent as learned_by for topic", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getFirstAgent = vi.fn().mockResolvedValue("sisyphus");

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        learned_by: "sisyphus",
      })
    );
  });

  it("defaults learned_by to build when no first agent", async () => {
    const session: OpenCodeSession = {
      id: "ses_test123",
      title: "Test Session",
      directory: "/test",
      projectId: "proj123",
      time: { created: 1000, updated: 2000 },
    };

    mockReader.getSessionsUpdatedSince = vi.fn().mockResolvedValue([session]);
    mockReader.getFirstAgent = vi.fn().mockResolvedValue(null);

    await importOpenCodeSessions(new Date(0), {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(mockStateManager.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        learned_by: "build",
      })
    );
  });
});
