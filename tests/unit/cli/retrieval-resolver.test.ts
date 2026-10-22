// Direct resolver-shape proof for resolveExternalMessage's ResolvedMessage
// contract. Distinct from fetch-message.test.ts's Oracle 6, which mocks the
// resolver entirely and only proves forwarding — per Beta's coverage audit
// (.sisyphus/reviews/fetch-message-oracle-6-coverage.md), this file is the
// suite that actually exercises resolveExternalMessage's branches.
//
// Mocking boundary: getMachineId and the five non-OMP external reader modules
// are mocked with literal, deterministic fixtures (a developer's local
// transcript stores or machine id must never decide whether these rows
// run). The two Ei-internal origins (ei-direct/ei-room) are NOT mocked —
// they go through the real loadLatestState() against a scratch
// EI_DATA_PATH/state.json, matching tests/unit/cli/retrieval.test.ts's
// established pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { basename, dirname, join } from "path";
import type * as Fs from "fs";
import type * as FsPromises from "fs/promises";
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
  qualifyOmpMessage,
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

// Observe content opens before the reader caches its lazy filesystem imports.
// Opening a FileHandle counts even when its subsequent reads use that handle;
// metadata calls (lstat/stat/realpath) remain real and uncounted.
const ompOpens = vi.hoisted(() => ({
  stream: 0,
  readFile: 0,
  open: 0,
  get count() { return this.stream + this.readFile + this.open; },
}));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const createReadStream = ((...args: Parameters<typeof actual.createReadStream>) => {
    ompOpens.stream++;
    return actual.createReadStream(...args);
  }) as typeof actual.createReadStream;
  return { ...actual, createReadStream, default: { ...actual, createReadStream } };
});
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const readFile = ((...args: Parameters<typeof actual.readFile>) => {
    ompOpens.readFile++;
    return actual.readFile(...args);
  }) as typeof actual.readFile;
  const open = ((...args: Parameters<typeof actual.open>) => {
    ompOpens.open++;
    return actual.open(...args);
  }) as typeof actual.open;
  return { ...actual, readFile, open, default: { ...actual, readFile, open } };
});

// Preserve Zod's namespace export under Vitest's bare-specifier interop.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, z: (actual.z ?? actual.default ?? actual) as Record<string, unknown> };
});

import { resolveExternalMessage, resolveOpenCodeMessage, type ResolvedMessage, type ResolverRefusal } from "../../../src/cli/retrieval.js";
import { createFetchMessageExecutor } from "../../../src/core/tools/builtin/fetch-message.js";
import { createMcpServer } from "../../../src/cli/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fsp from "fs/promises";
import { StateManager } from "../../../src/core/state-manager.js";
import { importOmpSessions } from "../../../src/integrations/omp/importer.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { ompMessage, ompMainSession, ompSubAgent, ompTranscriptText, writeOmpTree } from "../integrations/shared/omp-transcript-fixtures.js";

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

/** Asserts a resolve succeeded and narrows away missing messages, refusals and cross-machine errors. */
function expectResolved(result: ResolvedMessage | ResolverRefusal | { error: string } | null): ResolvedMessage {
  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("error");
  expect(result).not.toHaveProperty("refused");
  if (!result || "error" in result || "refused" in result) throw new Error("expected a resolved message");
  return result;
}

let tempDir: string | undefined;

function writeState(state: StorageState) {
  tempDir = mkdtempSync(join(tmpdir(), "ei-resolver-test-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
}

const originalEiDataPath = process.env.EI_DATA_PATH;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (originalEiDataPath === undefined) delete process.env.EI_DATA_PATH;
  else process.env.EI_DATA_PATH = originalEiDataPath;
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

  it("rejects a persona-role room message with no persona_id at all, without echoing the id into the reason (I6)", async () => {
    writeState(buildState());
    const result = await resolveExternalMessage(ROOM_MISSING_PERSONA_MSG_ID);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("no persona_id") });
    if (!result || !("reason" in result)) throw new Error("expected a refusal result");
    expect(result.reason).not.toContain(ROOM_MISSING_PERSONA_MSG_ID);
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

  it("I6/T7: a control/ANSI-bearing Slack id produces no raw control bytes and no id echo in the refusal reason", async () => {
    const evilId = "slack:\x1b[31mT0123\x1b[0m:C0456:1700000000.000100";
    const result = await resolveExternalMessage(evilId);
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("Slack") });
    if (!result || !("reason" in result)) throw new Error("expected a refusal result");
    expect(result.reason).not.toContain("\x1b[31m");
    expect(result.reason).not.toContain(evilId);
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
  it("uses the fixed Pi persona name for the assistant role", async () => {
    mockPiGetMessageById.mockResolvedValue({
      message: { id: PI_MSG_ID, sessionId: PI_SESSION_ID, role: "assistant", content: "vanilla pi", timestamp: NOW },
      before: [],
      after: [],
      session: { id: PI_SESSION_ID, title: "My Pi Session", cwd: "/tmp/proj", firstMessageAt: NOW, lastMessageAt: NOW, messages: [] },
    });

    const result = expectResolved(await resolveExternalMessage(PI_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "agent", display_name: "Pi" });
  });

  it("T8: maps user role to speaker.kind human, with no speaker.id", async () => {
    mockPiGetMessageById.mockResolvedValue({
      message: { id: PI_MSG_ID, sessionId: PI_SESSION_ID, role: "user", content: "Hi from the human", timestamp: NOW },
      before: [],
      after: [],
      session: { id: PI_SESSION_ID, title: "My Pi Session", cwd: "/tmp/proj", firstMessageAt: NOW, lastMessageAt: NOW, messages: [] },
    });

    const result = expectResolved(await resolveExternalMessage(PI_QUALIFIED_ID));
    expect(result.speaker).toEqual({ kind: "human", display_name: "Human" });
    expect("id" in result.speaker).toBe(false);
  });
});

// Tested by Beta — 2026-10-22
// --- omp ---------------------------------------------------------------
//
// Real trees under a temporary HOME, imported by the real importer through
// the real reader; the resolver then reads the same files. Nothing about OMP
// is mocked: only `fs.createReadStream` is observed (a counting passthrough)
// so a refusal can prove no transcript content was ever opened.

const OMP_IMPORT_NOW = Date.parse("2026-09-01T00:00:00.000Z");
const ompStem = (n: number) => `2026-08-01T00-00-00-000Z_00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ompIso = (minutes: number) => new Date(Date.parse("2026-08-01T00:00:00.000Z") + minutes * 60_000).toISOString();

interface OmpEnv {
  dir: string;
  sessions: string;
  data: string;
  sm: StateManager;
}

interface ImportedLine {
  message: Message;
  owner: PersonaEntity;
}

/** A fresh HOME, state directory, unrelated cwd and StateManager for one test; everything is restored and removed afterwards. */
async function withOmpEnv(run: (env: OmpEnv) => Promise<void>): Promise<void> {
  const dir = await fsp.mkdtemp(join(tmpdir(), "ei-omp-resolver-"));
  const previous = { home: process.env.HOME, data: process.env.EI_DATA_PATH, cwd: process.cwd() };
  try {
    const home = join(dir, "home");
    const data = join(dir, "state");
    const unrelated = join(dir, "cwd");
    for (const d of [home, data, unrelated]) await fsp.mkdir(d);
    process.env.HOME = home;
    process.env.EI_DATA_PATH = data;
    process.chdir(unrelated);

    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, omp: { integration: true, processed_sessions: {} } } });

    await run({ dir, sessions: join(home, ".omp", "agent", "sessions"), data, sm });
  } finally {
    process.chdir(previous.cwd);
    if (previous.home === undefined) delete process.env.HOME;
    else process.env.HOME = previous.home;
    if (previous.data === undefined) delete process.env.EI_DATA_PATH;
    else process.env.EI_DATA_PATH = previous.data;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Drives the importer until it has nothing left to do. Each block replaces its
 * persona's external messages, so what exists is captured after every call,
 * with the persona that holds it, before the queue is drained for the next one.
 */
async function importAllOmp({ sm }: OmpEnv): Promise<ImportedLine[]> {
  const byId = new Map<string, ImportedLine>();
  for (let call = 0; call < 25; call++) {
    const result = await importOmpSessions({ stateManager: sm, now: () => OMP_IMPORT_NOW });
    if (result.blocksQueued === 0 && result.treesCompleted === 0) {
      expect(sm.queue_getAllActiveItems()).toEqual([]);
      expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
      return [...byId.values()];
    }
    for (const owner of sm.persona_getAll()) {
      for (const message of sm.messages_get(owner.id)) {
        if (message.external) byId.set(message.id, { message: structuredClone(message), owner: structuredClone(owner) });
      }
    }
    for (const request of sm.queue_getAllActiveItems()) sm.queue_complete(request.id);
  }
  throw new Error("OMP import never finished");
}

/** Writes the importer's resulting state where the resolver reads it. */
async function saveOmpState({ sm, data }: OmpEnv): Promise<void> {
  await fsp.writeFile(join(data, "state.json"), JSON.stringify(sm.getStorageState()));
}

function ompIdOf(imported: ImportedLine[], content: string): string {
  const line = imported.find((i) => i.message.content === content);
  if (!line) throw new Error(`no imported message with content ${content}`);
  return line.message.id;
}

interface ExpectedSpeaker {
  kind: "human" | "agent";
  name: string;
  /** An assistant line: its name must also be the stored persona that owns the message. */
  filed?: true;
}

/** Resolves every imported message and compares it with the importer's stored content and owner. */
async function expectOmpLines(imported: ImportedLine[], expected: Record<string, ExpectedSpeaker>): Promise<void> {
  expect(imported.map((i) => i.message.content).sort()).toEqual(Object.keys(expected).sort());
  for (const { message, owner } of imported) {
    if (message.content === undefined) throw new Error("imported fixture message has no content");
    const want = expected[message.content];
    const result = expectResolved(await resolveExternalMessage(message.id));
    expect(result.content).toBe(message.content);
    expect(result.source_id).toBe(message.id);
    expect(result.speaker).toEqual({ kind: want.kind, display_name: want.name });
    expect(result.speaker.id).toBeUndefined();
    if (want.filed) expect(result.speaker).toEqual({ kind: "agent", display_name: owner.display_name });
    if (want.kind === "human") expect(message.role).toBe("human");
    if (want.name === "Parent agent") {
      expect(message.role).toBe("system");
      expect(message.speaker_name).toBe("Parent agent");
    }
  }
}

async function putFile(file: string, text: string): Promise<string> {
  await fsp.mkdir(dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
  return file;
}

const OMP_GUARDED_TEXT = ompTranscriptText(
  ompMainSession({ messages: [ompMessage("assistant", "guarded content", { id: "m1", timestamp: ompIso(1) })] })
);

/** A main session and a sub-agent transcript that both name the agent `reviewer`. */
async function writeReviewerTree(sessions: string): Promise<void> {
  await writeOmpTree(sessions, {
    projectDir: "proj-reviewer",
    stem: ompStem(3),
    main: ompMainSession({ messages: [ompMessage("assistant", "main alias reply", { id: "ma", timestamp: ompIso(1), agent: "reviewer" })] }),
    children: {
      P: ompSubAgent({ agent: "reviewer", messages: [ompMessage("assistant", "child alias reply", { id: "ca", timestamp: ompIso(2) })] }),
    },
  });
}

describe("resolveExternalMessage — omp", () => {
  it("names speakers from what the importer stored: named sub-agent, per-message main agents, and every user attribution", async () => {
    await withOmpEnv(async (env) => {
      await writeOmpTree(env.sessions, {
        projectDir: "proj-named",
        stem: ompStem(1),
        main: ompMainSession({
          messages: [
            ompMessage("user", "main question", { id: "mu", timestamp: ompIso(1) }),
            ompMessage("assistant", "planner reply", { id: "ma1", timestamp: ompIso(2), agent: "planner" }),
            ompMessage("assistant", "engineer reply", { id: "ma2", timestamp: ompIso(3), agent: "backend-engineer" }),
          ],
        }),
        children: {
          P: ompSubAgent({
            agent: "code-reviewer",
            messages: [
              ompMessage("user", "parent attributed line", { id: "cu1", timestamp: ompIso(4), attribution: "agent" }),
              ompMessage("user", "parent unattributed line", { id: "cu2", timestamp: ompIso(5) }),
              ompMessage("user", "human typed line", { id: "cu3", timestamp: ompIso(6), attribution: "user" }),
              ompMessage("assistant", "reviewer reply", { id: "ca1", timestamp: ompIso(7) }),
            ],
          }),
        },
      });

      const imported = await importAllOmp(env);
      await saveOmpState(env);

      await expectOmpLines(imported, {
        "main question": { kind: "human", name: "Human" },
        "planner reply": { kind: "agent", name: "Planner", filed: true },
        "engineer reply": { kind: "agent", name: "Backend Engineer", filed: true },
        "parent attributed line": { kind: "agent", name: "Parent agent" },
        "parent unattributed line": { kind: "agent", name: "Parent agent" },
        "human typed line": { kind: "human", name: "Human" },
        "reviewer reply": { kind: "agent", name: "Code Reviewer", filed: true },
      });
    });
  });

  it("falls back to OhMyPi for a main session and Task for a sub-agent transcript that name no agent", async () => {
    await withOmpEnv(async (env) => {
      await writeOmpTree(env.sessions, {
        projectDir: "proj-anonymous",
        stem: ompStem(2),
        main: ompMainSession({
          messages: [
            ompMessage("user", "anonymous question", { id: "mu", timestamp: ompIso(1) }),
            ompMessage("assistant", "anonymous main answer", { id: "ma", timestamp: ompIso(2) }),
          ],
        }),
        children: {
          P: ompSubAgent({
            messages: [
              ompMessage("user", "anonymous parent line", { id: "cu", timestamp: ompIso(3), attribution: "agent" }),
              ompMessage("assistant", "anonymous child answer", { id: "ca", timestamp: ompIso(4) }),
            ],
          }),
        },
      });

      const imported = await importAllOmp(env);
      await saveOmpState(env);

      await expectOmpLines(imported, {
        "anonymous question": { kind: "human", name: "Human" },
        "anonymous main answer": { kind: "agent", name: "OhMyPi", filed: true },
        "anonymous parent line": { kind: "agent", name: "Parent agent" },
        "anonymous child answer": { kind: "agent", name: "Task", filed: true },
      });
    });
  });

  it("reports an existing persona's display name when the agent is only one of its aliases, in a main session and a sub-agent transcript", async () => {
    await withOmpEnv(async (env) => {
      env.sm.persona_add({ ...makePersona("persona-my-reviewer", "My reviewer"), aliases: ["Reviewer"] });
      await writeReviewerTree(env.sessions);

      const imported = await importAllOmp(env);
      await saveOmpState(env);

      expect(imported.map((i) => i.owner.id)).toEqual(["persona-my-reviewer", "persona-my-reviewer"]);
      await expectOmpLines(imported, {
        "main alias reply": { kind: "agent", name: "My reviewer", filed: true },
        "child alias reply": { kind: "agent", name: "My reviewer", filed: true },
      });
    });
  });

  it("reports the canonical agent name when no state is saved, even though the importer filed the lines under another persona", async () => {
    await withOmpEnv(async (env) => {
      env.sm.persona_add({ ...makePersona("persona-my-reviewer", "My reviewer"), aliases: ["Reviewer"] });
      await writeReviewerTree(env.sessions);

      const imported = await importAllOmp(env);

      expect(imported.map((i) => i.owner.display_name)).toEqual(["My reviewer", "My reviewer"]);
      // Neither state.json, a backup nor corrections exist for the resolver to find.
      expect(await fsp.readdir(env.data)).toEqual([]);
      await expectOmpLines(imported, {
        "main alias reply": { kind: "agent", name: "Reviewer" },
        "child alias reply": { kind: "agent", name: "Reviewer" },
      });
    });
  });

  it("returns the message with its window, container and source id intact, and null for a message the transcript does not hold", async () => {
    await withOmpEnv(async (env) => {
      const tree = await writeOmpTree(env.sessions, {
        projectDir: "proj-window",
        stem: ompStem(4),
        main: ompMainSession({
          messages: [
            ompMessage("user", "window one", { id: "w1", timestamp: ompIso(1) }),
            ompMessage("assistant", "window two", { id: "w2", timestamp: ompIso(2) }),
            ompMessage("user", "window three", { id: "w3", timestamp: ompIso(3) }),
            ompMessage("assistant", "window four", { id: "w4", timestamp: ompIso(4) }),
          ],
        }),
      });
      const imported = await importAllOmp(env);
      await saveOmpState(env);

      const result = expectResolved(await resolveExternalMessage(ompIdOf(imported, "window two"), 1, 1));

      expect(result).toEqual({
        origin_kind: "omp",
        source_id: qualifyOmpMessage(MACHINE, tree.rootFile, "w2"),
        container: { kind: "session", id: tree.rootFile, display_name: basename(tree.rootFile) },
        speaker: { kind: "agent", display_name: "OhMyPi" },
        timestamp: ompIso(2),
        content: "window two",
        before: [expect.objectContaining({ content: "window one", source_id: qualifyOmpMessage(MACHINE, tree.rootFile, "w1"), timestamp: ompIso(1), speaker: { kind: "human", display_name: "Human" } })],
        after: [expect.objectContaining({ content: "window three", source_id: qualifyOmpMessage(MACHINE, tree.rootFile, "w3"), timestamp: ompIso(3), speaker: { kind: "human", display_name: "Human" } })],
      });
      expect(await resolveExternalMessage(qualifyOmpMessage(MACHINE, tree.rootFile, "absent"))).toBeNull();
    });
  });

  it("resolves two transcripts that share a file name and a native id to their own content and agent, and a path containing a colon", async () => {
    await withOmpEnv(async (env) => {
      for (const [n, projectDir, agent] of [[5, "proj-first", "architect"], [6, "proj:second", "debugger"]] as const) {
        await writeOmpTree(env.sessions, {
          projectDir,
          stem: ompStem(n),
          main: ompMainSession({ messages: [ompMessage("user", `root ${n}`, { id: "root", timestamp: ompIso(1) })] }),
          children: { P: ompSubAgent({ agent, messages: [ompMessage("assistant", `content from ${projectDir}`, { id: "m1", timestamp: ompIso(2) })] }) },
        });
      }
      const imported = await importAllOmp(env);
      await saveOmpState(env);

      const first = ompIdOf(imported, "content from proj-first");
      const second = ompIdOf(imported, "content from proj:second");
      expect(first).not.toBe(second);

      const firstResult = expectResolved(await resolveExternalMessage(first));
      const secondResult = expectResolved(await resolveExternalMessage(second));
      expect(firstResult.content).toBe("content from proj-first");
      expect(firstResult.speaker.display_name).toBe("Architect");
      expect(secondResult.content).toBe("content from proj:second");
      expect(secondResult.speaker.display_name).toBe("Debugger");
    });
  });

  it("refuses another machine's message with an error, never reading a transcript", async () => {
    await withOmpEnv(async (env) => {
      const file = await putFile(join(env.sessions, "proj", `${ompStem(7)}.jsonl`), OMP_GUARDED_TEXT);
      ompOpens.stream = ompOpens.readFile = ompOpens.open = 0;

      const result = await resolveExternalMessage(qualifyOmpMessage("other-machine", file, "m1"));

      expect(result).toEqual({ error: expect.stringContaining("other-machine") });
      expect(ompOpens.count).toBe(0);
    });
  });

  describe("refuses a path the sessions root does not vouch for, before any transcript content is opened", () => {
    const refusals: Array<[string, (env: OmpEnv) => Promise<string>]> = [
      ["a file outside the root", ({ dir }) => putFile(join(dir, "outside", "x.jsonl"), OMP_GUARDED_TEXT)],
      ["a sibling directory sharing the root's name as a prefix", ({ sessions }) => putFile(join(`${sessions}-evil`, "proj", "x.jsonl"), OMP_GUARDED_TEXT)],
      ["a symlinked file pointing outside the root", async ({ dir, sessions }) => {
        const target = await putFile(join(dir, "outside", "target.jsonl"), OMP_GUARDED_TEXT);
        await fsp.mkdir(join(sessions, "proj"), { recursive: true });
        const link = join(sessions, "proj", "link.jsonl");
        await fsp.symlink(target, link);
        return link;
      }],
      ["a path through a symlinked directory pointing outside the root", async ({ dir, sessions }) => {
        await putFile(join(dir, "outside", "dir", "x.jsonl"), OMP_GUARDED_TEXT);
        await fsp.mkdir(sessions, { recursive: true });
        await fsp.symlink(join(dir, "outside", "dir"), join(sessions, "linkdir"));
        return join(sessions, "linkdir", "x.jsonl");
      }],
      ["a file that is not a .jsonl transcript", ({ sessions }) => putFile(join(sessions, "proj", "notes.txt"), OMP_GUARDED_TEXT)],
      ["a .jsonl path that is not a regular file", async ({ sessions }) => {
        const folder = join(sessions, "proj", "folder.jsonl");
        await fsp.mkdir(folder, { recursive: true });
        return folder;
      }],
    ];

    it.each(refusals)("%s", async (_name, build) => {
      await withOmpEnv(async (env) => {
        const control = await putFile(join(env.sessions, "control", `${ompStem(8)}.jsonl`), OMP_GUARDED_TEXT);
        const refused = await build(env);

        // Saved-state reads cannot prove that the transcript stream observer is live.
        ompOpens.stream = ompOpens.readFile = ompOpens.open = 0;
        const ok = expectResolved(await resolveExternalMessage(qualifyOmpMessage(MACHINE, control, "m1")));
        expect(ok.content).toBe("guarded content");
        expect(ompOpens.stream).toBeGreaterThan(0);

        // The path gate refuses before loading state, so every content API stays idle.
        ompOpens.stream = ompOpens.readFile = ompOpens.open = 0;
        expect(await resolveExternalMessage(qualifyOmpMessage(MACHINE, refused, "m1"))).toBeNull();
        expect(ompOpens.count).toBe(0);
      });
    });
  });

  it("resolves a transcript through a symlinked sessions root, and still refuses a symlink that leaves it", async () => {
    await withOmpEnv(async (env) => {
      const real = join(env.dir, "real-sessions");
      await fsp.mkdir(dirname(env.sessions), { recursive: true });
      await fsp.mkdir(real);
      await fsp.symlink(real, env.sessions);
      await writeOmpTree(real, {
        projectDir: "proj-linked",
        stem: ompStem(9),
        main: ompMainSession({ messages: [ompMessage("user", "through the link", { id: "m1", timestamp: ompIso(1) })] }),
      });
      const imported = await importAllOmp(env);
      await saveOmpState(env);
      expect(imported).toHaveLength(1);

      ompOpens.stream = ompOpens.readFile = ompOpens.open = 0;
      const ok = expectResolved(await resolveExternalMessage(imported[0].message.id));
      expect(ok.content).toBe("through the link");
      expect(ok.speaker).toEqual({ kind: "human", display_name: "Human" });
      expect(ompOpens.stream).toBeGreaterThan(0);

      const outside = await putFile(join(env.dir, "outside", "target.jsonl"), OMP_GUARDED_TEXT);
      await fsp.symlink(outside, join(real, "proj-linked", "escape.jsonl"));
      ompOpens.stream = ompOpens.readFile = ompOpens.open = 0;
      expect(await resolveExternalMessage(qualifyOmpMessage(MACHINE, join(env.sessions, "proj-linked", "escape.jsonl"), "m1"))).toBeNull();
      expect(ompOpens.count).toBe(0);
    });
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
      expect(text).not.toContain(refusedId); // I6: never echo the caller's own id into MCP response text
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
      expect(text).not.toContain(ROOM_MISSING_PERSONA_MSG_ID); // I6: never echo the caller's own id into MCP response text
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
    expect(result).toEqual({ refused: true, reason: expect.stringContaining("no persona_id") });
    expect(result.reason).not.toContain(ROOM_MISSING_PERSONA_MSG_ID); // I6: never echo the caller's own id into the reason
    expect(canaryGetRoomList).not.toHaveBeenCalled();
  });

  it("I6/T7: a control/ANSI-bearing Slack id produces no raw control bytes in MCP response text or the builtin executor's result, while both still return a distinguishable Slack refusal", async () => {
    const evilId = "slack:\x1b[31mT0123\x1b[0m:C0456:1700000000.000100";
    writeState(makeLocallyStoredCopyState(evilId));

    const executor = createFetchMessageExecutor(() => [], () => [], () => [], () => [], () => null, resolveExternalMessage);
    const builtinResult = JSON.parse(await executor.execute({ id: evilId }));
    expect(builtinResult).toEqual({ refused: true, reason: expect.stringContaining("Slack import") });
    expect(builtinResult.reason).not.toContain("\x1b[31m");
    expect(builtinResult.reason).not.toContain(evilId);

    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: evilId } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Slack import");
      expect(text).not.toContain("\x1b[31m");
      expect(text).not.toContain(evilId);
    } finally {
      await client.close();
    }
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
      // I6 remaining gap (final review, round 2): mcp.ts's own unknown-id
      // text used to echo the raw id (`Message not found: ${id}`); now a
      // fixed, id-free string, matching the sibling browser executor.
      expect(text).toBe("Message not found");
    } finally {
      await client.close();
    }
  });

  it("T11: a control/ANSI-bearing unknown message id produces clean, control-byte-free MCP error text", async () => {
    const evilId = "unknown-id-\x1b[2JK";

    writeState(emptyState());
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: evilId } });
      const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe("Message not found");
      expect(text).not.toContain("\x1b[2J");
      expect(text).not.toContain(evilId);
    } finally {
      await client.close();
    }
  });

  it("T11: a control/ANSI-bearing cross-machine message id produces the exact fixed, id-free MCP error text — never the caller-derived machine string, sanitized or not", async () => {
    // getMachineId() is mocked to return MACHINE ("test-machine") at the top of this
    // file; any other machine segment trips retrieval.ts's cross-machine `{error}`
    // branch, unmocked/real, before any reader module is ever touched.
    const evilMachineC0 = "\x1b[31mEVIL-HOST\x1b[0m";
    const evilIdC0 = qualifyOpenCodeMessage(evilMachineC0, "sess1", "msg1");
    // C1 control bytes (0x80-0x9F) are a distinct range from the C0/ESC bytes
    // above -- a fix that only strips 0x00-0x1F/0x7F would still leak here.
    const evilMachineC1 = "\x9b31mEVIL-HOST\x9c";
    const evilIdC1 = qualifyOpenCodeMessage(evilMachineC1, "sess2", "msg2");
    const derivedLiteral = "EVIL-HOST";
    const fixedMessage = "Message is from a different machine and is not available here.";

    writeState(emptyState());
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      for (const evilId of [evilIdC0, evilIdC1]) {
        const toolResult = await client.callTool({ name: "ei_fetch_message", arguments: { id: evilId } });
        const text = (toolResult.content as Array<{ type: string; text: string }>)[0].text;
        // Exact fixed contract, not a substring: a future refactor that
        // changes the wording but still contains "machine" must fail here.
        expect(text).toBe(fixedMessage);
        expect(text).not.toContain("\x1b[31m");
        expect(text).not.toContain("\x9b");
        expect(text).not.toContain(evilMachineC0);
        expect(text).not.toContain(evilMachineC1);
        expect(text).not.toContain(evilId);
        // Proves the fix never forwards the caller-derived machine value at
        // all -- not merely that it strips control bytes from it. A refactor
        // that sanitizes control bytes but still interpolates the (now
        // partially-clean) machine string, e.g. forwarding "EVIL-HOST" after
        // stripping its ANSI wrapping, would leak this literal here even
        // though it contains no control bytes itself.
        expect(text).not.toContain(derivedLiteral);
      }
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

  it("I5 (.sisyphus/reviews/quote-attestation-final-implementation.md): refuses a bare (unqualified) room message with role persona and NO persona_id at all, instead of serving a legacy envelope with a missing speaker_name", async () => {
    const bareRoomMsgId = "bare-room-msg-legacy-1";
    const state = emptyState();
    state.rooms = {
      [ROOM_ID]: makeRoom(ROOM_ID, "Test Room", [], [
        makeRoomMessage(bareRoomMsgId, { role: "persona", content: "Malformed: no persona_id at all" }),
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
      // A plain refusal reason, never a `{message,before,after,...}` envelope.
      expect(() => JSON.parse(text)).toThrow();
      expect(text).toContain("no persona_id");
      expect(text).not.toContain(bareRoomMsgId); // I6: never echo the caller's own id into MCP response text
    } finally {
      await client.close();
    }
  });
});
