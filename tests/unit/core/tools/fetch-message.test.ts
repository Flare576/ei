// Tested by Beta — 2026-05-20
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFetchMessageExecutor } from "../../../../src/core/tools/builtin/fetch-message.js";
import type { PersonaEntity } from "../../../../src/core/types/entities.js";
import type { Message } from "../../../../src/core/types/llm.js";
import type { RoomMessage, RoomSummary } from "../../../../src/core/types/rooms.js";
import { ContextStatus } from "../../../../src/core/types/enums.js";

function makePersona(id: string, display_name: string): PersonaEntity {
  return {
    id,
    display_name,
    entity: "system",
    aliases: [],
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: "system",
    timestamp: "2026-01-01T00:00:00.000Z",
    read: false,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function makeRoomMessage(id: string, overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id,
    parent_id: null,
    role: "human",
    timestamp: "2026-01-01T00:00:00.000Z",
    read: false,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function makeRoomSummary(id: string, display_name: string): RoomSummary {
  return {
    id,
    display_name,
    mode: "ffa" as any,
    persona_ids: [],
    active_node_id: null,
    is_archived: false,
    unread_count: 0,
  };
}

describe("createFetchMessageExecutor", () => {
  let getAllPersonas: ReturnType<typeof vi.fn>;
  let getPersonaMessages: ReturnType<typeof vi.fn>;
  let getRoomList: ReturnType<typeof vi.fn>;
  let getRoomMessages: ReturnType<typeof vi.fn>;
  let getRoomDisplayName: ReturnType<typeof vi.fn>;
  let resolveExternalMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getAllPersonas = vi.fn().mockReturnValue([]);
    getPersonaMessages = vi.fn().mockReturnValue([]);
    getRoomList = vi.fn().mockReturnValue([]);
    getRoomMessages = vi.fn().mockReturnValue([]);
    getRoomDisplayName = vi.fn().mockReturnValue(null);
    resolveExternalMessage = vi.fn().mockResolvedValue(null);
    vi.clearAllMocks();
  });

  function makeExecutor(withExternal = true) {
    return createFetchMessageExecutor(
      getAllPersonas,
      getPersonaMessages,
      getRoomList,
      getRoomMessages,
      getRoomDisplayName,
      withExternal ? resolveExternalMessage : undefined
    );
  }

  describe("Oracle 1 — missing id", () => {
    it("returns error when id is missing", async () => {
      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({}));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });

    it("returns error when id is empty string", async () => {
      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "" }));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });

    it("returns error when id is whitespace only", async () => {
      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "   " }));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });
  });

  describe("Oracle 2 — persona message found", () => {
    it("returns message with correct shape when found in persona messages", async () => {
      const persona = makePersona("p-1", "Alice");
      const msg = makeMessage("msg-1", { content: "Hello world", role: "system" });
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue([msg]);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-1" }));

      expect(result.message.id).toBe("msg-1");
      expect(result.message.role).toBe("system");
      expect(result.message.content).toBe("Hello world");
      expect(result.message.timestamp).toBe(msg.timestamp);
      expect(result.before).toEqual([]);
      expect(result.after).toEqual([]);
      expect(result.persona).toBe("Alice");
    });

    it("omits content when undefined", async () => {
      const persona = makePersona("p-1", "Alice");
      const msg = makeMessage("msg-1", { silence_reason: "User left" });
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue([msg]);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-1" }));

      expect(result.message.content).toBeUndefined();
      expect(result.message.silence_reason).toBe("User left");
    });

    it("omits silence_reason when undefined", async () => {
      const persona = makePersona("p-1", "Alice");
      const msg = makeMessage("msg-1", { content: "Hi" });
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue([msg]);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-1" }));

      expect("silence_reason" in result.message).toBe(false);
    });
  });

  describe("Oracle 3 — before/after window", () => {
    it("returns correct before/after slices", async () => {
      const persona = makePersona("p-1", "Alice");
      const msgs = [
        makeMessage("msg-0", { content: "zero" }),
        makeMessage("msg-1", { content: "one" }),
        makeMessage("msg-2", { content: "two" }),
        makeMessage("msg-3", { content: "three" }),
        makeMessage("msg-4", { content: "four" }),
      ];
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue(msgs);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-2", before: 2, after: 2 }));

      expect(result.before.map((m: any) => m.id)).toEqual(["msg-0", "msg-1"]);
      expect(result.after.map((m: any) => m.id)).toEqual(["msg-3", "msg-4"]);
    });

    it("clamps before at 0 — no negative index", async () => {
      const persona = makePersona("p-1", "Alice");
      const msgs = [
        makeMessage("msg-0", { content: "zero" }),
        makeMessage("msg-1", { content: "one" }),
      ];
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue(msgs);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-0", before: 5, after: 1 }));

      expect(result.before).toEqual([]);
      expect(result.after.map((m: any) => m.id)).toEqual(["msg-1"]);
    });

    it("clamps after at end of array", async () => {
      const persona = makePersona("p-1", "Alice");
      const msgs = [
        makeMessage("msg-0", { content: "zero" }),
        makeMessage("msg-1", { content: "one" }),
      ];
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue(msgs);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-1", before: 1, after: 10 }));

      expect(result.before.map((m: any) => m.id)).toEqual(["msg-0"]);
      expect(result.after).toEqual([]);
    });

    it("treats negative before as 0", async () => {
      const persona = makePersona("p-1", "Alice");
      const msgs = [makeMessage("msg-0"), makeMessage("msg-1")];
      getAllPersonas.mockReturnValue([persona]);
      getPersonaMessages.mockReturnValue(msgs);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "msg-1", before: -3, after: 0 }));

      expect(result.before).toEqual([]);
    });
  });

  describe("Oracle 4 — room message found with persona speaker_name", () => {
    it("includes speaker_name from persona display_name for persona role messages", async () => {
      const persona = makePersona("p-1", "Bob");
      const roomSummary = makeRoomSummary("room-1", "Test Room");
      const roomMsg = makeRoomMessage("rmsg-1", { role: "persona", persona_id: "p-1", content: "Hey" });

      getAllPersonas.mockReturnValue([persona]);
      getRoomList.mockReturnValue([roomSummary]);
      getRoomMessages.mockReturnValue([roomMsg]);
      getRoomDisplayName.mockReturnValue("Test Room");

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "rmsg-1" }));

      expect(result.message.speaker_name).toBe("Bob");
      expect(result.persona).toBe("Test Room");
    });

    it("falls back to Participant when the room message's persona_id is orphaned (persona deleted)", async () => {
      const roomSummary = makeRoomSummary("room-1", "Test Room");
      const roomMsg = makeRoomMessage("rmsg-1", { role: "persona", persona_id: "deleted-persona-id", content: "Hey" });

      getAllPersonas.mockReturnValue([]); // the persona no longer exists
      getRoomList.mockReturnValue([roomSummary]);
      getRoomMessages.mockReturnValue([roomMsg]);
      getRoomDisplayName.mockReturnValue("Test Room");

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "rmsg-1" }));

      expect(result.message.speaker_name).toBe("Participant");
    });

    it("uses getRoomDisplayName result for persona field", async () => {
      const roomSummary = makeRoomSummary("room-1", "Summary Name");
      const roomMsg = makeRoomMessage("rmsg-1", { role: "human", content: "Hi" });

      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([roomSummary]);
      getRoomMessages.mockReturnValue([roomMsg]);
      getRoomDisplayName.mockReturnValue("Display Name Override");

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "rmsg-1" }));

      expect(result.persona).toBe("Display Name Override");
    });

    it("falls back to roomSummary.display_name when getRoomDisplayName returns null", async () => {
      const roomSummary = makeRoomSummary("room-1", "Fallback Name");
      const roomMsg = makeRoomMessage("rmsg-1", { role: "human", content: "Hi" });

      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([roomSummary]);
      getRoomMessages.mockReturnValue([roomMsg]);
      getRoomDisplayName.mockReturnValue(null);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "rmsg-1" }));

      expect(result.persona).toBe("Fallback Name");
    });
  });

  describe("Oracle 5 — room message with human role has no speaker_name", () => {
    it("does not include speaker_name for human role room messages", async () => {
      const roomSummary = makeRoomSummary("room-1", "Test Room");
      const roomMsg = makeRoomMessage("rmsg-1", { role: "human", content: "Hello" });

      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([roomSummary]);
      getRoomMessages.mockReturnValue([roomMsg]);
      getRoomDisplayName.mockReturnValue("Test Room");

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "rmsg-1" }));

      expect("speaker_name" in result.message).toBe(false);
    });
  });

  describe("Oracle 6 — external resolver called when not found locally", () => {
    it("calls resolveExternalMessage when id not found locally", async () => {
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);
      const externalResult = {
        origin_kind: "opencode",
        source_id: "opencode:test-machine:ses_abc:msg_1",
        container: { kind: "session", id: "ses_abc", display_name: "Test Session" },
        speaker: { kind: "human", display_name: "Human" },
        timestamp: "2026-01-01T00:00:00.000Z",
        content: "external",
        before: [
          {
            origin_kind: "opencode",
            source_id: "opencode:test-machine:ses_abc:msg_0",
            container: { kind: "session", id: "ses_abc", display_name: "Test Session" },
            speaker: { kind: "agent", id: "build", display_name: "build" },
            timestamp: "2025-12-31T23:59:00.000Z",
            content: "prior turn",
            before: [],
            after: [],
          },
        ],
        after: [],
      };
      resolveExternalMessage.mockResolvedValue(externalResult);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "ext-1", before: 2, after: 1 }));

      expect(resolveExternalMessage).toHaveBeenCalledWith("ext-1", 2, 1);
      expect(result).toEqual(externalResult);
    });

    it("passes before/after to resolveExternalMessage", async () => {
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);
      resolveExternalMessage.mockResolvedValue({ found: true });

      const executor = makeExecutor();
      await executor.execute({ id: "some-id", before: 3, after: 5 });

      expect(resolveExternalMessage).toHaveBeenCalledWith("some-id", 3, 5);
    });

    it("returns error result from external resolver if it contains error field", async () => {
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);
      resolveExternalMessage.mockResolvedValue({ error: "External not found" });

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "ext-missing" }));

      expect(result).toEqual({ error: "External not found" });
    });
  });

  describe("Oracle 7 — not found anywhere, no external resolver", () => {
    it("returns error when message not found and no external resolver", async () => {
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);

      const executor = makeExecutor(false);
      const result = JSON.parse(await executor.execute({ id: "ghost-id" }));

      expect(result).toEqual({ error: "Message not found" });
    });

    it("returns error when external resolver returns null", async () => {
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);
      resolveExternalMessage.mockResolvedValue(null);

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: "ghost-id" }));

      expect(result).toEqual({ error: "Message not found" });
    });
  });

  describe("Oracle 8 — I6: control characters in the caller-supplied id never reach console output", () => {
    it("does not log raw control/ANSI bytes from the id when nothing resolves it, even though a sanitized identifier is still logged", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const evilId = "attest\x1b[31mRED\x1b[0mid";
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([]);
      resolveExternalMessage.mockResolvedValue(null);

      const executor = makeExecutor();
      await executor.execute({ id: evilId });

      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b[31m");
      expect(logged).not.toContain(evilId);
      expect(logged).toContain("RED"); // sanitized copy still logged, only the control bytes are stripped
      logSpy.mockRestore();
    });

    it("does not log raw control bytes when the id is refused by format (Slack/import/generated-document)", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const evilId = "slack:\x1b[31mT0123\x1b[0m:C0456:1700000000.000100";

      const executor = makeExecutor();
      const result = JSON.parse(await executor.execute({ id: evilId }));

      expect(result.refused).toBe(true);
      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b[31m");
      expect(logged).not.toContain(evilId);
      logSpy.mockRestore();
    });

    it("does not log raw control bytes when a malformed room-persona-primary message is refused", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const evilId = "room\x07bell\x1b[31mred\x1b[0mmsg-1";
      getAllPersonas.mockReturnValue([]);
      getRoomList.mockReturnValue([makeRoomSummary("room-1", "Test Room")]);
      getRoomMessages.mockReturnValue([makeRoomMessage(evilId, { role: "persona" })]);

      const executor = makeExecutor(false);
      const result = JSON.parse(await executor.execute({ id: evilId }));

      expect(result.refused).toBe(true);
      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b[31m");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(evilId);
      logSpy.mockRestore();
    });
  });
});
