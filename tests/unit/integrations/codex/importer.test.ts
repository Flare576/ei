import { describe, it, expect, beforeEach, vi } from "vitest";
import { importCodexSessions } from "../../../../src/integrations/codex/importer.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, HumanEntity, Message } from "../../../../src/core/types.js";
import type { CodexSession, ICodexReader } from "../../../../src/integrations/codex/types.js";
import { isProcessRunning } from "../../../../src/integrations/process-check.js";
import {
  buildPersonaEntity,
  buildMockHuman,
  buildMockInterface,
  buildMockStateManager,
  buildExternalMessage,
  buildChatMessage,
} from "../shared/importer-test-utils.js";

vi.mock("../../../../src/integrations/process-check.js", () => ({
  isProcessRunning: vi.fn().mockResolvedValue(true),
}));

function makeSession(overrides: Partial<CodexSession> & { id: string }): CodexSession {
  return {
    title: "Test Codex Session",
    cwd: "/test/project",
    rolloutPath: "/test/rollout.jsonl",
    firstMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T01:00:00.000Z",
    messages: [
      {
        id: "evt_1",
        sessionId: overrides.id,
        role: "user",
        content: "Hello from user",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "evt_2",
        sessionId: overrides.id,
        role: "assistant",
        content: "Hello from Codex",
        timestamp: "2026-01-01T01:00:00.000Z",
      },
    ],
    ...overrides,
  };
}



describe("importCodexSessions", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<ICodexReader>;
  let mockHuman: HumanEntity;
  let codexPersona: ReturnType<typeof buildPersonaEntity> | null;
  let messageStore: Map<string, Message[]>;

  beforeEach(() => {
    vi.mocked(isProcessRunning).mockResolvedValue(true);
    codexPersona = null;
    messageStore = new Map();

    mockHuman = buildMockHuman();
    mockInterface = buildMockInterface() as Partial<Ei_Interface>;
    mockStateManager = buildMockStateManager(
      (name) => (name === "Codex" && codexPersona) ? codexPersona : null,
      (id) => (codexPersona?.id === id) ? codexPersona : null,
      (entity) => {
        const id = entity.id ?? crypto.randomUUID();
        codexPersona = buildPersonaEntity(id, entity.display_name);
        return id;
      },
      (id) => {
        if (codexPersona?.id === id) { codexPersona = { ...codexPersona, is_archived: true }; return true; }
        return false;
      },
      messageStore,
      () => mockHuman,
      (h) => { mockHuman = h; }
    );

    mockReader = {
      getSessions: vi.fn().mockResolvedValue([]),
      getMessageById: vi.fn().mockResolvedValue(null),
      isAvailable: vi.fn().mockResolvedValue(true),
    };
  });

  it("returns empty result when no sessions found", async () => {
    const result = await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(result.sessionsProcessed).toBe(0);
    expect(result.messagesImported).toBe(0);
  });

  it("skips sessions too fresh while Codex is running", async () => {
    const freshSession = makeSession({
      id: "thread-fresh",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(result.sessionsProcessed).toBe(0);
  });

  it("imports fresh session when Codex is not running", async () => {
    vi.mocked(isProcessRunning).mockResolvedValue(false);

    const freshSession = makeSession({
      id: "thread-fresh",
      lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([freshSession]);

    const result = await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(result.sessionsProcessed).toBe(1);
  });

  it("imports messages and maps roles", async () => {
    const session = makeSession({ id: "thread-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.messagesImported).toBe(2);

    const stored = messageStore.get(codexPersona!.id) ?? [];
    expect(stored[0].role).toBe("human");
    expect(stored[1].role).toBe("system");
  });

  it("creates and archives Codex persona if missing", async () => {
    const session = makeSession({ id: "thread-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Codex" })
    );
    expect(mockInterface.onPersonaAdded).toHaveBeenCalled();
  });

  it("removes only external messages on re-import", async () => {
     codexPersona = buildPersonaEntity("codex-id", "Codex");
     messageStore.set("codex-id", [buildExternalMessage("ext-msg"), buildChatMessage("chat-msg")]);

    const session = makeSession({ id: "thread-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    const stored = messageStore.get("codex-id") ?? [];
    expect(stored.some((m) => m.id === "ext-msg")).toBe(false);
    expect(stored.some((m) => m.id === "chat-msg")).toBe(true);
  });

  it("pre-marks messages before cutoff as fully extracted", async () => {
    mockHuman.settings = {
      codex: {
        processed_sessions: { "thread-abc": "2026-01-01T00:30:00.000Z" },
      },
    };
    codexPersona = buildPersonaEntity("codex-id", "Codex");

    const session = makeSession({
      id: "thread-abc",
      lastMessageAt: "2026-01-01T02:00:00.000Z",
      messages: [
        {
          id: "evt_1",
          sessionId: "thread-abc",
          role: "assistant",
          content: "Old response",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "evt_2",
          sessionId: "thread-abc",
          role: "assistant",
          content: "New response",
          timestamp: "2026-01-01T01:00:00.000Z",
        },
      ],
    });

    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    const stored = messageStore.get("codex-id") ?? [];
    const oldMsg = stored.find((m) => m.id.endsWith(":evt_1"));
    const newMsg = stored.find((m) => m.id.endsWith(":evt_2"));

    expect(oldMsg).toMatchObject({ f: true, t: true, p: true, e: true });
    expect(newMsg?.f).toBeFalsy();
  });

  it("queues extraction scans with codex source", async () => {
    const session = makeSession({ id: "thread-abc" });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    const result = await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(result.extractionScansQueued).toBe(4);
    const enqueued = vi.mocked(mockStateManager.queue_enqueue).mock.calls;
    expect(enqueued.length).toBeGreaterThan(0);
    const firstData = enqueued[0][0].data as Record<string, unknown>;
    expect(firstData.sources as string[]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^codex:[^:]+:thread-abc$/)])
    );
  });

  it("marks session in processed_sessions and advances extraction_point", async () => {
    const session = makeSession({
      id: "thread-abc",
      lastMessageAt: "2026-01-15T12:00:00.000Z",
    });
    mockReader.getSessions = vi.fn().mockResolvedValue([session]);

    await importCodexSessions({
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as ICodexReader,
    });

    expect(mockHuman.settings?.codex?.processed_sessions?.["thread-abc"]).toBeDefined();
    expect(mockHuman.settings?.codex?.extraction_point).toBe("2026-01-15T12:00:00.000Z");
  });
});
