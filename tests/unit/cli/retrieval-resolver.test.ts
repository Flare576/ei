// Direct resolver-shape proof for resolveExternalMessage's ResolvedMessage
// contract. Distinct from fetch-message.test.ts's Oracle 6, which mocks the
// resolver entirely and only proves forwarding — per Beta's coverage audit
// (.sisyphus/reviews/fetch-message-oracle-6-coverage.md), this file is the
// suite that actually exercises resolveExternalMessage's branches.
//
// Mocking boundary: getMachineId and the 5 external reader modules are
// mocked with literal, deterministic fixtures (a developer's local
// transcript stores or machine id must never decide whether these rows
// run). The two Ei-internal origins (ei-direct/ei-room) are NOT mocked —
// they go through the real loadLatestState() against a scratch
// EI_DATA_PATH/state.json, matching tests/unit/cli/retrieval.test.ts's
// established pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { PersonaEntity } from "../../../src/core/types/entities.js";
import type { Message } from "../../../src/core/types/llm.js";
import type { RoomMessage, RoomEntity } from "../../../src/core/types/rooms.js";
import { ContextStatus, RoomMode } from "../../../src/core/types/enums.js";
import {
  qualifyEiMessage,
  qualifyOpenCodeMessage,
  qualifyClaudeCodeMessage,
  qualifyCursorMessage,
  qualifyCodexMessage,
  qualifyPiMessage,
} from "../../../src/core/utils/message-id.js";

const MACHINE = "test-machine";
const NOW = "2026-01-01T00:00:00.000Z";

vi.mock("../../../src/integrations/machine-id.js", () => ({
  getMachineId: vi.fn().mockReturnValue("test-machine"),
}));

const mockOpenCodeGetMessageById = vi.fn();
vi.mock("../../../src/integrations/opencode/reader-factory.js", () => ({
  createOpenCodeReader: vi.fn().mockResolvedValue({
    getMessageById: mockOpenCodeGetMessageById,
  }),
}));

const mockClaudeCodeGetMessagesForSession = vi.fn();
vi.mock("../../../src/integrations/claude-code/reader.js", () => ({
  ClaudeCodeReader: vi.fn().mockImplementation(() => ({
    getMessagesForSession: mockClaudeCodeGetMessagesForSession,
  })),
}));

const mockCursorGetSessions = vi.fn();
vi.mock("../../../src/integrations/cursor/reader.js", () => ({
  CursorReader: vi.fn().mockImplementation(() => ({
    getSessions: mockCursorGetSessions,
  })),
}));

const mockCodexGetMessageById = vi.fn();
vi.mock("../../../src/integrations/codex/reader.js", () => ({
  CodexReader: vi.fn().mockImplementation(() => ({
    getMessageById: mockCodexGetMessageById,
  })),
}));

const mockPiGetMessageById = vi.fn();
vi.mock("../../../src/integrations/pi/reader.js", () => ({
  PiReader: vi.fn().mockImplementation(() => ({
    getMessageById: mockPiGetMessageById,
  })),
}));

import { resolveExternalMessage, resolveOpenCodeMessage, type ResolvedMessage } from "../../../src/cli/retrieval.js";
import { createFetchMessageExecutor } from "../../../src/core/tools/builtin/fetch-message.js";
import { createMcpServer } from "../../../src/cli/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// --- shared fixture ids -----------------------------------------------

const DIRECT_PERSONA_ID = "persona-direct-1";
const DIRECT_HUMAN_MSG_ID = qualifyEiMessage("11111111-1111-1111-1111-111111111111");
const DIRECT_AGENT_MSG_ID = qualifyEiMessage("22222222-2222-2222-2222-222222222222");
const DIRECT_BEFORE_MSG_ID = qualifyEiMessage("11111111-1111-1111-1111-111111111100");

const ROOM_ID = "room-1";
const ROOM_PERSONA_ID = "persona-room-1";
const ROOM_HUMAN_MSG_ID = qualifyEiMessage("33333333-3333-3333-3333-333333333333");
const ROOM_PERSONA_MSG_ID = qualifyEiMessage("44444444-4444-4444-4444-444444444444");
const ROOM_ORPHANED_PERSONA_ID = "persona-deleted-ghost";
const ROOM_ORPHANED_MSG_ID = qualifyEiMessage("55555555-5555-5555-5555-555555555555");
const ROOM_MISSING_PERSONA_MSG_ID = qualifyEiMessage("66666666-6666-6666-6666-666666666666");

const OC_SESSION_ID = "ses_abc123";
const OC_MSG_ID = "msg_primary";
const OC_BEFORE_ID = "msg_before1";
const OC_AFTER_ID = "msg_after1";
const OC_QUALIFIED_ID = qualifyOpenCodeMessage(MACHINE, OC_SESSION_ID, OC_MSG_ID);

const CC_SESSION_ID = "0da9e1e8-187f-40f9-a66b-c7f1ebf2a72e";
const CC_MSG_ID = "cc-msg-1";
const CC_QUALIFIED_ID = qualifyClaudeCodeMessage(MACHINE, CC_SESSION_ID, CC_MSG_ID);

const CURSOR_SESSION_ID = "composer-1";
const CURSOR_MSG_ID = "bubble-1";
const CURSOR_QUALIFIED_ID = qualifyCursorMessage(MACHINE, CURSOR_SESSION_ID, CURSOR_MSG_ID);

const CODEX_SESSION_ID = "codex-session-1";
const CODEX_MSG_ID = "evt_1";
const CODEX_QUALIFIED_ID = qualifyCodexMessage(MACHINE, CODEX_SESSION_ID, CODEX_MSG_ID);

const PI_SESSION_ID = "pi-session-1";
const PI_MSG_ID = "pi-msg-1";
const PI_QUALIFIED_ID = qualifyPiMessage(MACHINE, PI_SESSION_ID, PI_MSG_ID);

// --- fixture builders ---------------------------------------------------

function makePersona(id: string, display_name: string): PersonaEntity {
  return {
    id,
    display_name,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: NOW,
  };
}

function makeDirectMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    role: "human",
    timestamp: NOW,
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
    timestamp: NOW,
    read: false,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function makeRoom(id: string, display_name: string, persona_ids: string[], messages: RoomMessage[]): RoomEntity {
  return {
    id,
    display_name,
    entity: "room",
    mode: RoomMode.FreeForAll,
    persona_ids,
    active_node_id: null,
    is_archived: false,
    created_at: NOW,
    last_updated: NOW,
    messages,
  };
}

function emptyState(): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: { entity: "human", facts: [], topics: [], people: [], quotes: [], last_updated: NOW },
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

function ocMessage(id: string, role: "user" | "assistant", agent: string, content: string) {
  return { id, sessionId: OC_SESSION_ID, role, agent, content, timestamp: NOW };
}

/** Asserts a resolve succeeded (not null, not the cross-machine error sentinel) and narrows the type for field access. */
function expectResolved(result: ResolvedMessage | { error: string } | null): ResolvedMessage {
  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("error");
  return result as ResolvedMessage;
}

let tempDir: string | undefined;

function writeState(state: StorageState) {
  tempDir = mkdtempSync(join(tmpdir(), "ei-resolver-test-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  delete process.env.EI_DATA_PATH;
});

// --- ei-direct -----------------------------------------------------------

describe("resolveExternalMessage — ei-direct", () => {
  function buildState(): StorageState {
    const state = emptyState();
    state.personas[DIRECT_PERSONA_ID] = {
      entity: makePersona(DIRECT_PERSONA_ID, "Direct Persona"),
      messages: [
        makeDirectMessage(DIRECT_BEFORE_MSG_ID, { role: "system", content: "prior agent turn", timestamp: "2025-12-31T23:59:00.000Z" }),
        makeDirectMessage(DIRECT_HUMAN_MSG_ID, { role: "human", content: "Hello from the human" }),
        makeDirectMessage(DIRECT_AGENT_MSG_ID, { role: "system", content: "Hello from the agent" }),
      ],
    };
    return state;
  }

  it("resolves a human-role message with origin_kind ei-direct and container.kind persona", async () => {
    writeState(buildState());
    const result = await resolveExternalMessage(DIRECT_HUMAN_MSG_ID);
    expect(result).toEqual({
      origin_kind: "ei-direct",
      source_id: DIRECT_HUMAN_MSG_ID,
      container: { kind: "persona", id: DIRECT_PERSONA_ID, display_name: "Direct Persona" },
      speaker: { kind: "human", display_name: "Human" },
      timestamp: NOW,
      content: "Hello from the human",
      before: [],
      after: [],
    });
  });

  it("resolves a system-role message with speaker.kind agent and speaker.id set to the persona id", async () => {
    writeState(buildState());
    const result = await resolveExternalMessage(DIRECT_AGENT_MSG_ID);
    expect(result).toEqual({
      origin_kind: "ei-direct",
      source_id: DIRECT_AGENT_MSG_ID,
      container: { kind: "persona", id: DIRECT_PERSONA_ID, display_name: "Direct Persona" },
      speaker: { kind: "agent", id: DIRECT_PERSONA_ID, display_name: "Direct Persona" },
      timestamp: NOW,
      content: "Hello from the agent",
      before: [],
      after: [],
    });
  });

  it("populates before/after window arrays for a direct message", async () => {
    writeState(buildState());
    const result = expectResolved(await resolveExternalMessage(DIRECT_HUMAN_MSG_ID, 1, 1));
    expect(result.before).toHaveLength(1);
    expect(result.before[0].source_id).toBe(DIRECT_BEFORE_MSG_ID);
    expect(result.after).toHaveLength(1);
    expect(result.after[0].source_id).toBe(DIRECT_AGENT_MSG_ID);
  });
});

// --- ei-room ---------------------------------------------------------------

describe("resolveExternalMessage — ei-room", () => {
  function buildState(): StorageState {
    const state = emptyState();
    state.personas[ROOM_PERSONA_ID] = { entity: makePersona(ROOM_PERSONA_ID, "Room Persona"), messages: [] };
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [ROOM_PERSONA_ID], [
        makeRoomMessage(ROOM_HUMAN_MSG_ID, { role: "human", content: "Hello from the human in the room" }),
        makeRoomMessage(ROOM_PERSONA_MSG_ID, { role: "persona", persona_id: ROOM_PERSONA_ID, content: "Hello from the room persona" }),
        makeRoomMessage(ROOM_ORPHANED_MSG_ID, { role: "persona", persona_id: ROOM_ORPHANED_PERSONA_ID, content: "Hello from a deleted persona" }),
        makeRoomMessage(ROOM_MISSING_PERSONA_MSG_ID, { role: "persona", content: "Malformed: no persona_id at all" }),
      ]),
    };
    return state;
  }

  it("resolves a human-role room message with origin_kind ei-room and container.kind room", async () => {
    writeState(buildState());
    const result = await resolveExternalMessage(ROOM_HUMAN_MSG_ID);
    expect(result).toEqual({
      origin_kind: "ei-room",
      source_id: ROOM_HUMAN_MSG_ID,
      container: { kind: "room", id: ROOM_ID, display_name: "Test Room" },
      speaker: { kind: "human", display_name: "Human" },
      timestamp: NOW,
      content: "Hello from the human in the room",
      before: [],
      after: [],
    });
  });

  it("resolves a healthy persona-role room message using the live persona display name", async () => {
    writeState(buildState());
    const result = expectResolved(await resolveExternalMessage(ROOM_PERSONA_MSG_ID));
    expect(result.speaker).toEqual({ kind: "agent", id: ROOM_PERSONA_ID, display_name: "Room Persona" });
    expect(result.container).toEqual({ kind: "room", id: ROOM_ID, display_name: "Test Room" });
  });

  it("resolves an orphaned persona_id with the Participant fallback, retaining the dangling id", async () => {
    writeState(buildState());
    const result = expectResolved(await resolveExternalMessage(ROOM_ORPHANED_MSG_ID));
    expect(result.speaker).toEqual({ kind: "agent", id: ROOM_ORPHANED_PERSONA_ID, display_name: "Participant" });
  });

  it("rejects a persona-role room message with no persona_id at all", async () => {
    writeState(buildState());
    const result = await resolveExternalMessage(ROOM_MISSING_PERSONA_MSG_ID);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining(ROOM_MISSING_PERSONA_MSG_ID) });
  });

  it("populates before/after window arrays for a room message, dropping malformed window entries rather than fabricating or failing", async () => {
    writeState(buildState());
    // window (before=1,after=2) spans the human message, the orphaned-persona message, and the
    // missing-persona_id message. The malformed one must be silently dropped, not fatal.
    const result = expectResolved(await resolveExternalMessage(ROOM_PERSONA_MSG_ID, 1, 2));
    expect(result.before.map((m) => m.source_id)).toEqual([ROOM_HUMAN_MSG_ID]);
    expect(result.after.map((m) => m.source_id)).toEqual([ROOM_ORPHANED_MSG_ID]);
  });
});

// --- explicit rejection (no coercion) ---------------------------------------

describe("resolveExternalMessage — explicit rejection", () => {
  it("refuses a Slack-qualified id with a discriminable refusal, not null", async () => {
    const id = "slack:T0123:C0456:1700000000.000100";
    const result = await resolveExternalMessage(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("Slack") });
  });

  it("refuses an imported-document id with a discriminable refusal, not null", async () => {
    const id = `import:document:my-doc-slug:${crypto.randomUUID()}`;
    const result = await resolveExternalMessage(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("document") });
  });

  it("refuses a generated-document id with a discriminable refusal, not null", async () => {
    const id = `generate:document:my-doc-slug:${crypto.randomUUID()}`;
    const result = await resolveExternalMessage(id);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("document") });
  });
});

// --- opencode ----------------------------------------------------------------

describe("resolveExternalMessage — opencode", () => {
  it("resolves an explicit opencode message, mapping user to human", async () => {
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(OC_MSG_ID, "user", "build", "Hello from human"),
      before: [],
      after: [],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    });

    const result = await resolveExternalMessage(OC_QUALIFIED_ID);

    expect(result).toEqual({
      origin_kind: "opencode",
      source_id: OC_QUALIFIED_ID,
      container: { kind: "session", id: OC_SESSION_ID, display_name: "My OpenCode Session" },
      speaker: { kind: "human", display_name: "Human" },
      timestamp: NOW,
      content: "Hello from human",
      before: [],
      after: [],
    });
    expect(mockOpenCodeGetMessageById).toHaveBeenCalledWith(OC_MSG_ID, 0, 0);
  });

  it("maps assistant role to speaker.kind agent, using the per-message agent slug as both id and display_name", async () => {
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(OC_MSG_ID, "assistant", "build", "Hello from agent"),
      before: [],
      after: [],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    });

    const result = expectResolved(await resolveExternalMessage(OC_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "agent", id: "build", display_name: "build" });
  });

  it("rejects with an error sentinel when the qualified machine does not match this machine", async () => {
    const foreignId = qualifyOpenCodeMessage("other-machine", OC_SESSION_ID, OC_MSG_ID);
    const result = await resolveExternalMessage(foreignId);
    expect(result).toEqual({ error: expect.stringContaining("other-machine") });
    expect(mockOpenCodeGetMessageById).not.toHaveBeenCalled();
  });

  it("resolves a bare legacy msg_xxx id as opencode, reconstructing a canonical qualified source_id", async () => {
    const bareId = "msg_legacy123";
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(bareId, "user", "build", "legacy message"),
      before: [],
      after: [],
      session: { id: OC_SESSION_ID, title: "Legacy Session", directory: "/tmp/proj" },
    });

    const result = expectResolved(await resolveExternalMessage(bareId));
    expect(result.origin_kind).toBe("opencode");
    expect(result.source_id).toBe(qualifyOpenCodeMessage(MACHINE, OC_SESSION_ID, bareId));
    expect(mockOpenCodeGetMessageById).toHaveBeenCalledWith(bareId, 0, 0);
  });

  it("populates before/after window arrays with a nonzero request", async () => {
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(OC_MSG_ID, "user", "build", "primary"),
      before: [ocMessage(OC_BEFORE_ID, "assistant", "build", "before turn")],
      after: [ocMessage(OC_AFTER_ID, "user", "build", "after turn")],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    });

    const result = expectResolved(await resolveExternalMessage(OC_QUALIFIED_ID, 1, 1));
    expect(result.before).toEqual([
      {
        origin_kind: "opencode",
        source_id: qualifyOpenCodeMessage(MACHINE, OC_SESSION_ID, OC_BEFORE_ID),
        container: { kind: "session", id: OC_SESSION_ID, display_name: "My OpenCode Session" },
        speaker: { kind: "agent", id: "build", display_name: "build" },
        timestamp: NOW,
        content: "before turn",
        before: [],
        after: [],
      },
    ]);
    expect(result.after).toHaveLength(1);
    expect(result.after[0].content).toBe("after turn");
    expect(mockOpenCodeGetMessageById).toHaveBeenCalledWith(OC_MSG_ID, 1, 1);
  });
});

// --- claudecode ----------------------------------------------------------------

describe("resolveExternalMessage — claudecode", () => {
  it("resolves a claudecode message, using the fixed Claude Code persona name for the assistant role", async () => {
    mockClaudeCodeGetMessagesForSession.mockResolvedValue([
      { id: CC_MSG_ID, sessionId: CC_SESSION_ID, role: "assistant", content: "Hi from Claude Code", timestamp: NOW },
    ]);

    const result = await resolveExternalMessage(CC_QUALIFIED_ID);

    expect(result).toEqual({
      origin_kind: "claudecode",
      source_id: CC_QUALIFIED_ID,
      container: { kind: "session", id: CC_SESSION_ID, display_name: CC_SESSION_ID },
      speaker: { kind: "agent", display_name: "Claude Code" },
      timestamp: NOW,
      content: "Hi from Claude Code",
      before: [],
      after: [],
    });
    expect(mockClaudeCodeGetMessagesForSession).toHaveBeenCalledWith(CC_SESSION_ID);
  });

  it("maps user role to human with no stable speaker.id", async () => {
    mockClaudeCodeGetMessagesForSession.mockResolvedValue([
      { id: CC_MSG_ID, sessionId: CC_SESSION_ID, role: "user", content: "Hi from the human", timestamp: NOW },
    ]);
    const result = expectResolved(await resolveExternalMessage(CC_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "human", display_name: "Human" });
  });
});

// --- claudecode session identity verification (C1) -----------------------
//
// A traversal-bearing or otherwise crafted session segment must never let
// a foreign-session record be accepted as this session's provenance --
// see C1 in .sisyphus/reviews/wave-2-quote-attestation.md. The reader's
// own traversal guard (tests/unit/integrations/claude-code/reader.test.ts)
// closes the filesystem-escape primitive directly; this proves the
// resolver's independent sessionId-match check refuses even a record the
// (mocked) reader itself hands back under the right id but the wrong
// session -- defense in depth, not a duplicate of the reader-level test.

describe("resolveExternalMessage — claudecode session identity verification (C1)", () => {
  it("refuses a returned record whose own sessionId differs from the requested session", async () => {
    mockClaudeCodeGetMessagesForSession.mockResolvedValue([
      { id: CC_MSG_ID, sessionId: "some-other-session-entirely", role: "user", content: "forged provenance", timestamp: NOW },
    ]);
    const result = await resolveExternalMessage(CC_QUALIFIED_ID);
    expect(result).toBeNull();
    expect(mockClaudeCodeGetMessagesForSession).toHaveBeenCalledWith(CC_SESSION_ID);
  });

  it("still resolves normally when the record's own sessionId genuinely matches (no regression)", async () => {
    mockClaudeCodeGetMessagesForSession.mockResolvedValue([
      { id: CC_MSG_ID, sessionId: CC_SESSION_ID, role: "user", content: "legitimate content", timestamp: NOW },
    ]);
    const result = expectResolved(await resolveExternalMessage(CC_QUALIFIED_ID));
    expect(result.content).toBe("legitimate content");
  });
});

// --- cursor ----------------------------------------------------------------

describe("resolveExternalMessage — cursor", () => {
  function mockSession(type: 1 | 2, text: string) {
    mockCursorGetSessions.mockResolvedValue([
      {
        id: CURSOR_SESSION_ID,
        name: "My Cursor Session",
        workspacePath: "/tmp/proj",
        unifiedMode: "agent",
        createdAt: NOW,
        lastMessageAt: NOW,
        messages: [{ id: CURSOR_MSG_ID, type, text, timestamp: NOW }],
      },
    ]);
  }

  it("resolves a cursor message, mapping type 2 to assistant/agent with the fixed Cursor persona name", async () => {
    mockSession(2, "Hi from Cursor");
    const result = await resolveExternalMessage(CURSOR_QUALIFIED_ID);

    expect(result).toEqual({
      origin_kind: "cursor",
      source_id: CURSOR_QUALIFIED_ID,
      container: { kind: "session", id: CURSOR_SESSION_ID, display_name: "My Cursor Session" },
      speaker: { kind: "agent", display_name: "Cursor" },
      timestamp: NOW,
      content: "Hi from Cursor",
      before: [],
      after: [],
    });
  });

  it("maps cursor type 1 to human", async () => {
    mockSession(1, "Hi from human");
    const result = expectResolved(await resolveExternalMessage(CURSOR_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "human", display_name: "Human" });
  });
});

// --- codex ----------------------------------------------------------------

describe("resolveExternalMessage — codex", () => {
  it("resolves a codex message with the fixed Codex persona name for the assistant role", async () => {
    mockCodexGetMessageById.mockResolvedValue({
      message: { id: CODEX_MSG_ID, sessionId: CODEX_SESSION_ID, role: "assistant", content: "Hi from Codex", timestamp: NOW },
      before: [],
      after: [],
      session: {
        id: CODEX_SESSION_ID,
        title: "My Codex Session",
        cwd: "/tmp/proj",
        rolloutPath: "/tmp/rollout.jsonl",
        firstMessageAt: NOW,
        lastMessageAt: NOW,
        messages: [],
      },
    });

    const result = await resolveExternalMessage(CODEX_QUALIFIED_ID);

    expect(result).toEqual({
      origin_kind: "codex",
      source_id: CODEX_QUALIFIED_ID,
      container: { kind: "session", id: CODEX_SESSION_ID, display_name: "My Codex Session" },
      speaker: { kind: "agent", display_name: "Codex" },
      timestamp: NOW,
      content: "Hi from Codex",
      before: [],
      after: [],
    });
    expect(mockCodexGetMessageById).toHaveBeenCalledWith(CODEX_SESSION_ID, CODEX_MSG_ID, 0, 0);
  });

  it("T8: maps user role to speaker.kind human, with no speaker.id", async () => {
    mockCodexGetMessageById.mockResolvedValue({
      message: { id: CODEX_MSG_ID, sessionId: CODEX_SESSION_ID, role: "user", content: "Hi from the human", timestamp: NOW },
      before: [],
      after: [],
      session: {
        id: CODEX_SESSION_ID,
        title: "My Codex Session",
        cwd: "/tmp/proj",
        rolloutPath: "/tmp/rollout.jsonl",
        firstMessageAt: NOW,
        lastMessageAt: NOW,
        messages: [],
      },
    });

    const result = expectResolved(await resolveExternalMessage(CODEX_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "human", display_name: "Human" });
    expect("id" in result.speaker).toBe(false);
  });
});

// --- pi ----------------------------------------------------------------

describe("resolveExternalMessage — pi", () => {
  it("resolves a pi message with a per-message agent, using it for both speaker.id and display_name", async () => {
    mockPiGetMessageById.mockResolvedValue({
      message: { id: PI_MSG_ID, sessionId: PI_SESSION_ID, role: "assistant", content: "Hi from reviewer agent", timestamp: NOW, agent: "reviewer" },
      before: [],
      after: [],
      session: { id: PI_SESSION_ID, title: "My Pi Session", cwd: "/tmp/proj", firstMessageAt: NOW, lastMessageAt: NOW, messages: [] },
    });

    const result = await resolveExternalMessage(PI_QUALIFIED_ID);

    expect(result).toEqual({
      origin_kind: "pi",
      source_id: PI_QUALIFIED_ID,
      container: { kind: "session", id: PI_SESSION_ID, display_name: "My Pi Session" },
      speaker: { kind: "agent", id: "reviewer", display_name: "reviewer" },
      timestamp: NOW,
      content: "Hi from reviewer agent",
      before: [],
      after: [],
    });
  });

  it("falls back to the fixed Pi persona name when no per-message agent is present", async () => {
    mockPiGetMessageById.mockResolvedValue({
      message: { id: PI_MSG_ID, sessionId: PI_SESSION_ID, role: "assistant", content: "vanilla pi", timestamp: NOW },
      before: [],
      after: [],
      session: { id: PI_SESSION_ID, title: "My Pi Session", cwd: "/tmp/proj", firstMessageAt: NOW, lastMessageAt: NOW, messages: [] },
    });

    const result = expectResolved(await resolveExternalMessage(PI_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "agent", display_name: "Pi" });
  });

  it("T8: maps user role to speaker.kind human, with no speaker.id, even when a per-message agent is present", async () => {
    mockPiGetMessageById.mockResolvedValue({
      message: { id: PI_MSG_ID, sessionId: PI_SESSION_ID, role: "user", content: "Hi from the human", timestamp: NOW, agent: "reviewer" },
      before: [],
      after: [],
      session: { id: PI_SESSION_ID, title: "My Pi Session", cwd: "/tmp/proj", firstMessageAt: NOW, lastMessageAt: NOW, messages: [] },
    });

    const result = expectResolved(await resolveExternalMessage(PI_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "human", display_name: "Human" });
    expect("id" in result.speaker).toBe(false);
  });
});

// --- direct vs room distinguishability (closes B11) -------------------------

describe("resolveExternalMessage — direct vs room distinguishability (closes B11)", () => {
  it("produces different container.kind for a direct-human and a room-human message from the same speaker", async () => {
    const state = emptyState();
    state.personas[DIRECT_PERSONA_ID] = {
      entity: makePersona(DIRECT_PERSONA_ID, "Direct Persona"),
      messages: [makeDirectMessage(DIRECT_HUMAN_MSG_ID, { role: "human", content: "same human, direct" })],
    };
    state.personas[ROOM_PERSONA_ID] = { entity: makePersona(ROOM_PERSONA_ID, "Room Persona"), messages: [] };
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [ROOM_PERSONA_ID], [
        makeRoomMessage(ROOM_HUMAN_MSG_ID, { role: "human", content: "same human, in a room" }),
      ]),
    };
    writeState(state);

    const directResult = expectResolved(await resolveExternalMessage(DIRECT_HUMAN_MSG_ID));
    const roomResult = expectResolved(await resolveExternalMessage(ROOM_HUMAN_MSG_ID));

    expect(directResult.speaker.kind).toBe("human");
    expect(roomResult.speaker.kind).toBe("human");
    expect(directResult.container.kind).toBe("persona");
    expect(roomResult.container.kind).toBe("room");
  });
});

// --- context window survives through consumers ------------------------------

describe("context window survives the resolver rebuild — MCP and builtin executor", () => {
  function mockOpenCodeWindow() {
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(OC_MSG_ID, "user", "build", "primary"),
      before: [ocMessage(OC_BEFORE_ID, "assistant", "build", "before turn")],
      after: [ocMessage(OC_AFTER_ID, "user", "build", "after turn")],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    });
  }

  it("populates before/after through the builtin fetch_message executor", async () => {
    mockOpenCodeWindow();
    const executor = createFetchMessageExecutor(
      () => [],
      () => [],
      () => [],
      () => [],
      () => null,
      resolveExternalMessage
    );
    const result = JSON.parse(await executor.execute({ id: OC_QUALIFIED_ID, before: 1, after: 1 }));

    expect(result.before).toHaveLength(1);
    expect(result.before[0].content).toBe("before turn");
    expect(result.after).toHaveLength(1);
    expect(result.after[0].content).toBe("after turn");
  });

  it("populates before/after through the MCP ei_fetch_message tool", async () => {
    mockOpenCodeWindow();
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: OC_QUALIFIED_ID, before: 1, after: 1 } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.before).toHaveLength(1);
      expect(parsed.before[0].content).toBe("before turn");
      expect(parsed.after).toHaveLength(1);
      expect(parsed.after[0].content).toBe("after turn");
    } finally {
      await client.close();
    }
  });

  it("T9: MCP forwards before/after counts to the external reader, not merely serializing a prebuilt window", async () => {
    // Unlike mockOpenCodeWindow() above (a fixed window regardless of input), this mock's
    // returned before/after arrays are a function of the requested counts — proving MCP
    // actually forwards `before`/`after` into the reader call rather than a fixture that
    // returns the same window no matter what was asked for.
    mockOpenCodeGetMessageById.mockImplementation(async (nativeId: string, before: number, after: number) => ({
      message: ocMessage(nativeId, "user", "build", "primary"),
      before: before >= 1 ? [ocMessage(OC_BEFORE_ID, "assistant", "build", "before turn")] : [],
      after: after >= 1 ? [ocMessage(OC_AFTER_ID, "user", "build", "after turn")] : [],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    }));

    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const withWindow = await client.callTool({ name: "ei_fetch_message", arguments: { id: OC_QUALIFIED_ID, before: 1, after: 1 } });
      const withWindowParsed = JSON.parse((withWindow.content as Array<{ type: string; text: string }>)[0].text);
      expect(mockOpenCodeGetMessageById).toHaveBeenCalledWith(OC_MSG_ID, 1, 1);
      expect(withWindowParsed.before).toHaveLength(1);
      expect(withWindowParsed.after).toHaveLength(1);

      const noWindow = await client.callTool({ name: "ei_fetch_message", arguments: { id: OC_QUALIFIED_ID, before: 0, after: 0 } });
      const noWindowParsed = JSON.parse((noWindow.content as Array<{ type: string; text: string }>)[0].text);
      expect(mockOpenCodeGetMessageById).toHaveBeenCalledWith(OC_MSG_ID, 0, 0);
      expect(noWindowParsed.before).toHaveLength(0);
      expect(noWindowParsed.after).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});

// --- deprecated alias regression --------------------------------------------

describe("resolveOpenCodeMessage (deprecated alias)", () => {
  it("still delegates to resolveExternalMessage with the same arguments and result", async () => {
    mockOpenCodeGetMessageById.mockResolvedValue({
      message: ocMessage(OC_MSG_ID, "user", "build", "via deprecated alias"),
      before: [],
      after: [],
      session: { id: OC_SESSION_ID, title: "My OpenCode Session", directory: "/tmp/proj" },
    });

    const viaAlias = await resolveOpenCodeMessage(OC_QUALIFIED_ID, 0, 0);
    expect(viaAlias).toEqual({
      origin_kind: "opencode",
      source_id: OC_QUALIFIED_ID,
      container: { kind: "session", id: OC_SESSION_ID, display_name: "My OpenCode Session" },
      speaker: { kind: "human", display_name: "Human" },
      timestamp: NOW,
      content: "via deprecated alias",
      before: [],
      after: [],
    });
  });
});

// --- stale session segment (I4: session-scoped lookup, not cross-session canonicalization) ---
//
// Corrected decision (decisions.md, T2a): only OpenCode's reader resolves a message by native id
// independent of session, so only OpenCode can recover from a stale/wrong caller-supplied session
// segment. Claude Code/Cursor/Codex/Pi's reader APIs are session-scoped lookups; when the caller's
// session segment is stale (the native id is real, but not inside THAT session), they correctly
// return null. That is intentional, existing behavior — not a gap this task must fix.

describe("resolveExternalMessage — stale session segment is null, not silently corrected (I4)", () => {
  it("Claude Code: a stale session segment returns null via session-scoped lookup", async () => {
    mockClaudeCodeGetMessagesForSession.mockResolvedValue([
      { id: "unrelated-message-in-this-session", sessionId: CC_SESSION_ID, role: "user", content: "wrong session", timestamp: NOW },
    ]);
    const result = await resolveExternalMessage(CC_QUALIFIED_ID);
    expect(result).toBeNull();
    expect(mockClaudeCodeGetMessagesForSession).toHaveBeenCalledWith(CC_SESSION_ID);
  });

  it("Cursor: a stale session segment returns null when the session id isn't found among sessions", async () => {
    mockCursorGetSessions.mockResolvedValue([
      { id: "some-other-session", name: "Other Session", messages: [{ id: CURSOR_MSG_ID, type: 1, text: "hi", timestamp: NOW }] },
    ]);
    const result = await resolveExternalMessage(CURSOR_QUALIFIED_ID);
    expect(result).toBeNull();
  });

  it("Codex: a stale session segment returns null via the reader's own session-scoped miss", async () => {
    mockCodexGetMessageById.mockResolvedValue(null);
    const result = await resolveExternalMessage(CODEX_QUALIFIED_ID);
    expect(result).toBeNull();
    expect(mockCodexGetMessageById).toHaveBeenCalledWith(CODEX_SESSION_ID, CODEX_MSG_ID, 0, 0);
  });

  it("Pi: a stale session segment returns null via the reader's own session-scoped miss", async () => {
    mockPiGetMessageById.mockResolvedValue(null);
    const result = await resolveExternalMessage(PI_QUALIFIED_ID);
    expect(result).toBeNull();
    expect(mockPiGetMessageById).toHaveBeenCalledWith(PI_SESSION_ID, PI_MSG_ID, 0, 0);
  });
});

// --- T4: resolver refusals stay refusals through MCP and the builtin tool (I3) ---

describe("MCP and builtin fetch_message preserve resolver refusals (I3)", () => {
  const SLACK_ID = "slack:T0123:C0456:1700000000.000100";
  const IMPORT_ID = `import:document:my-doc-slug:${crypto.randomUUID()}`;
  const GENERATE_ID = `generate:document:my-doc-slug:${crypto.randomUUID()}`;

  // I5 (round 2): each case below also seeds the refused id as a real,
  // locally-stored message — the exact shape a Slack import/document
  // segmentation/knowledge synthesis handler actually persists — so a
  // regression that stopped recognizing the resolver's `{refused:true}`
  // shape (e.g. narrowing the "already resolved" guard to something a
  // refusal object doesn't satisfy) would fall through to a local scan
  // that actually FINDS this message and returns a full legacy envelope,
  // not a generic "not found"/"no state" miss. Without a seeded match, the
  // previous oracle (non-empty, non-JSON text) couldn't tell "refused for
  // the right reason" apart from "fell through to a no-state miss that
  // also happens to be non-JSON" (Beta's I5 finding).
  function makeLocallyStoredCopyState(id: string): StorageState {
    const state = emptyState();
    state.personas[DIRECT_PERSONA_ID] = {
      entity: makePersona(DIRECT_PERSONA_ID, "Direct Persona"),
      messages: [makeDirectMessage(id, { role: "human", content: "a locally-stored copy of the refused-origin message" })],
    };
    return state;
  }

  function makeMalformedRoomState(): StorageState {
    const state = emptyState();
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [], [
        makeRoomMessage(ROOM_MISSING_PERSONA_MSG_ID, { role: "persona", content: "Malformed: no persona_id at all" }),
      ]),
    };
    return state;
  }

  const REFUSAL_CASES: Array<[string, string, string]> = [
    ["Slack", SLACK_ID, "Slack import"],
    ["imported document", IMPORT_ID, "imported document"],
    ["generated document", GENERATE_ID, "generated document"],
  ];

  it.each(REFUSAL_CASES)("MCP ei_fetch_message reports the %s refusal, not a legacy envelope", async (_label, refusedId, reasonSubstring) => {
    writeState(makeLocallyStoredCopyState(refusedId));
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: refusedId } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(() => JSON.parse(text)).toThrow(); // a plain refusal reason, never a `{message,before,after,...}` envelope
      expect(text).toContain(reasonSubstring); // I5: the SPECIFIC refusal reason, not merely non-JSON
      expect(text).toContain(refusedId);
    } finally {
      await client.close();
    }
  });

  it.each(REFUSAL_CASES)("builtin fetch_message executor reports the %s refusal, not a legacy envelope", async (_label, refusedId, reasonSubstring) => {
    const executor = createFetchMessageExecutor(() => [], () => [], () => [], () => [], () => null, resolveExternalMessage);
    const result = JSON.parse(await executor.execute({ id: refusedId }));
    expect(result).toEqual({ refused: true, reason: expect.stringContaining(reasonSubstring) });
  });

  it("MCP ei_fetch_message reports a malformed room message's refusal, not the Participant-fallback legacy envelope", async () => {
    writeState(makeMalformedRoomState());
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: ROOM_MISSING_PERSONA_MSG_ID } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(() => JSON.parse(text)).toThrow();
      expect(text).toContain(ROOM_MISSING_PERSONA_MSG_ID);
      expect(text).toContain("no persona_id"); // I5: the SPECIFIC refusal reason, not just a substring a generic miss could also contain
    } finally {
      await client.close();
    }
  });

  it("builtin fetch_message executor reports a malformed room message's refusal directly, without ever reaching the local room scan", async () => {
    writeState(makeMalformedRoomState());
    const canaryGetRoomList = vi.fn(() => {
      throw new Error("local room scan must not run — the resolver already classified and refused this id");
    });
    const executor = createFetchMessageExecutor(() => [], () => [], canaryGetRoomList, () => [], () => null, resolveExternalMessage);
    const result = JSON.parse(await executor.execute({ id: ROOM_MISSING_PERSONA_MSG_ID }));
    expect(result).toEqual({ refused: true, reason: expect.stringContaining(ROOM_MISSING_PERSONA_MSG_ID) });
    expect(result.reason).toContain("no persona_id"); // I5: the SPECIFIC refusal reason
    expect(canaryGetRoomList).not.toHaveBeenCalled();
  });

  it("a genuinely unknown bare legacy id is still not a refusal — both surfaces fall back and report not-found", async () => {
    const legacyId = "totally-unknown-legacy-id";

    const executorResult = JSON.parse(
      await createFetchMessageExecutor(() => [], () => [], () => [], () => [], () => null, resolveExternalMessage).execute({ id: legacyId })
    );
    expect(executorResult).toEqual({ error: "Message not found" });

    writeState(emptyState());
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: legacyId } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe(`Message not found: ${legacyId}`);
    } finally {
      await client.close();
    }
  });
});

// --- QA scenario: real CLI process, persona vs room distinguishability -----

describe("QA scenario — ei --id distinguishes persona vs room via the real ei binary", () => {
  it("differs in container.kind between a direct-human and room-human message despite identical speaker.kind", () => {
    const state = emptyState();
    state.personas[DIRECT_PERSONA_ID] = {
      entity: makePersona(DIRECT_PERSONA_ID, "Direct Persona"),
      messages: [makeDirectMessage(DIRECT_HUMAN_MSG_ID, { role: "human", content: "same human, direct" })],
    };
    state.personas[ROOM_PERSONA_ID] = { entity: makePersona(ROOM_PERSONA_ID, "Room Persona"), messages: [] };
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [ROOM_PERSONA_ID], [
        makeRoomMessage(ROOM_HUMAN_MSG_ID, { role: "human", content: "same human, in a room" }),
        makeRoomMessage(ROOM_ORPHANED_MSG_ID, { role: "persona", persona_id: ROOM_ORPHANED_PERSONA_ID, content: "orphaned persona speaking" }),
      ]),
    };

    const cliTempDir = mkdtempSync(join(tmpdir(), "ei-cli-resolver-test-"));
    writeFileSync(join(cliTempDir, "state.json"), JSON.stringify(state));

    try {
      const directRun = spawnSync("bun", ["src/cli.ts", "--id", DIRECT_HUMAN_MSG_ID], {
        cwd: process.cwd(),
        env: { ...process.env, EI_DATA_PATH: cliTempDir },
        encoding: "utf8",
      });
      const roomRun = spawnSync("bun", ["src/cli.ts", "--id", ROOM_HUMAN_MSG_ID], {
        cwd: process.cwd(),
        env: { ...process.env, EI_DATA_PATH: cliTempDir },
        encoding: "utf8",
      });

      expect(directRun.status).toBe(0);
      expect(roomRun.status).toBe(0);

      const directOutput = JSON.parse(directRun.stdout);
      const roomOutput = JSON.parse(roomRun.stdout);

      expect(directOutput.speaker.kind).toBe("human");
      expect(roomOutput.speaker.kind).toBe("human");
      expect(directOutput.container.kind).toBe("persona");
      expect(roomOutput.container.kind).toBe("room");
    } finally {
      rmSync(cliTempDir, { recursive: true, force: true });
    }
  });
});

// --- mcp.ts local room scan: Participant fallback for pre-migration bare ids ---
//
// resolveExternalMessage's own "ei" case already handles every *qualified*
// ei:<uuid> id (all real message ids are qualified at creation time via
// qualifyEiMessage), so mcp.ts's own post-resolver local room scan
// (resolveRoomPersonaName) is only reachable for a bare, unqualified id —
// on-disk state written before migrateMessageIds() has run, since CLI/MCP
// invocations read state.json directly without running the Processor's
// startup migration. That is the scenario exercised here.

describe("mcp.ts local room scan — Participant fallback for pre-migration bare ids", () => {
  it("applies the Participant fallback when a bare (unqualified) room message's persona_id is orphaned", async () => {
    const bareRoomMsgId = "bare-room-msg-1";
    const state = emptyState();
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [], [
        {
          id: bareRoomMsgId,
          parent_id: null,
          role: "persona",
          persona_id: "deleted-persona-id",
          content: "Hey",
          timestamp: NOW,
          read: false,
          context_status: ContextStatus.Default,
        },
      ]),
    };
    writeState(state);

    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: bareRoomMsgId } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.message.speaker_name).toBe("Participant");
    } finally {
      await client.close();
    }
  });
});
