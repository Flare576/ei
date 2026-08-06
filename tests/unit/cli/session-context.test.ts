// Coverage for getRecentSessionMessages — 01c
// (.sisyphus/plans/tickets/01c-session-context-imports.md).
//
// Two failure modes are being defended here, not one: the four dynamic
// import specifiers pointed at a nonexistent directory (src/cli/integrations/
// instead of src/integrations/), and both catch blocks discarded every
// failure as a bare []. Fixing only the paths without attribution would
// still let a reader-load failure masquerade as "no messages" forever.
//
// Mocking boundary: the three hook-source reader modules are mocked at
// their real specifiers, following tests/unit/cli/retrieval-resolver.test.ts's
// convention (hoisted `mock`-prefixed vi.fn() handles + vi.mock factories).
// codex/reader.js needs both parseCodexRolloutMessages and CodexReader
// mocked from the same vi.mock call (per plan constraint 6) since the
// transcript-path branch and the codex hookSource branch both import from
// it. getRecentSessionMessages itself — the function under test — is never
// mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CodexMessage, CodexSession } from "../../../src/integrations/codex/types.js";
import type { CursorSession } from "../../../src/integrations/cursor/types.js";
import type { OpenCodeMessage } from "../../../src/integrations/opencode/types.js";

const mockCreateOpenCodeReader = vi.fn();
vi.mock("../../../src/integrations/opencode/reader-factory.js", () => ({
  createOpenCodeReader: mockCreateOpenCodeReader,
}));

const mockCursorGetSessions = vi.fn();
vi.mock("../../../src/integrations/cursor/reader.js", () => ({
  CursorReader: vi.fn().mockImplementation(() => ({
    getSessions: mockCursorGetSessions,
  })),
}));

const mockCodexGetSessions = vi.fn();
const mockParseCodexRolloutMessages = vi.fn();
vi.mock("../../../src/integrations/codex/reader.js", () => ({
  CodexReader: vi.fn().mockImplementation(() => ({
    getSessions: mockCodexGetSessions,
  })),
  parseCodexRolloutMessages: mockParseCodexRolloutMessages,
}));

import { getRecentSessionMessages } from "../../../src/cli/session-context.js";

// session-context.ts is written against the Bun runtime (Bun.file), but this
// suite runs under plain Node (repo tooling notes: `node` on this machine
// resolves to a Bun shim that can't run vitest — real Node has no `Bun`
// global at all). This polyfill backs Bun.file with a real fs read so the
// transcript-path branch is exercised end-to-end, mirroring
// tests/unit/core/corrections.test.ts's established convention.
let tempDir: string | undefined;
let originalBun: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  originalBun = Reflect.get(globalThis, "Bun");
  Reflect.set(globalThis, "Bun", {
    file: (path: string) => ({
      text: async () => readFileSync(path, "utf-8"),
    }),
  });
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (originalBun === undefined) {
    Reflect.deleteProperty(globalThis, "Bun");
  } else {
    Reflect.set(globalThis, "Bun", originalBun);
  }
});

function writeTranscript(content: string): string {
  tempDir = mkdtempSync(join(tmpdir(), "ei-session-context-test-"));
  const path = join(tempDir, "transcript.jsonl");
  writeFileSync(path, content);
  return path;
}

function makeCodexSession(overrides: Partial<CodexSession> = {}): CodexSession {
  return {
    id: "codex-sess-1",
    title: "Codex Session",
    cwd: "/repo",
    rolloutPath: "/tmp/rollout.jsonl",
    firstMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:05:00.000Z",
    messages: [],
    ...overrides,
  };
}

function makeCursorSession(overrides: Partial<CursorSession> = {}): CursorSession {
  return {
    id: "cursor-sess-1",
    name: "Cursor Session",
    workspacePath: "/repo",
    unifiedMode: "chat",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:05:00.000Z",
    messages: [],
    ...overrides,
  };
}

describe("getRecentSessionMessages — happy path per hook source", () => {
  it("opencode-plugin: returns exact formatted messages from the real specifier", async () => {
    const messages: OpenCodeMessage[] = [
      { id: "msg_1", sessionId: "ses_1", role: "user", agent: "build", content: "hello", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "msg_2", sessionId: "ses_1", role: "assistant", agent: "build", content: "hi there", timestamp: "2026-01-01T00:00:01.000Z" },
    ];
    mockCreateOpenCodeReader.mockResolvedValue({
      getMessagesForSession: vi.fn().mockResolvedValue(messages),
    });

    const result = await getRecentSessionMessages("ses_1", "opencode-plugin", undefined);

    expect(result.failure).toBeNull();
    expect(result.messages).toEqual(["user: hello", "assistant: hi there"]);
    expect(mockCreateOpenCodeReader).toHaveBeenCalledTimes(1);
  });

  it("cursor: returns exact formatted messages from the real specifier", async () => {
    const session = makeCursorSession({
      id: "cursor-sess-1",
      messages: [
        { id: "b1", type: 1, text: "what's up", timestamp: "2026-01-01T00:00:00.000Z" },
        { id: "b2", type: 2, text: "not much", timestamp: "2026-01-01T00:00:01.000Z" },
      ],
    });
    mockCursorGetSessions.mockResolvedValue([session]);

    const result = await getRecentSessionMessages("cursor-sess-1", "cursor", undefined);

    expect(result.failure).toBeNull();
    expect(result.messages).toEqual(["user: what's up", "assistant: not much"]);
    expect(mockCursorGetSessions).toHaveBeenCalledTimes(1);
  });

  it("codex: returns exact formatted messages from the real specifier", async () => {
    const session = makeCodexSession({
      id: "codex-sess-1",
      messages: [
        { id: "evt_1", sessionId: "codex-sess-1", role: "user", content: "ping", timestamp: "2026-01-01T00:00:00.000Z" },
        { id: "evt_2", sessionId: "codex-sess-1", role: "assistant", content: "pong", timestamp: "2026-01-01T00:00:01.000Z" },
      ],
    });
    mockCodexGetSessions.mockResolvedValue([session]);

    const result = await getRecentSessionMessages("codex-sess-1", "codex", undefined);

    expect(result.failure).toBeNull();
    expect(result.messages).toEqual(["user: ping", "assistant: pong"]);
    expect(mockCodexGetSessions).toHaveBeenCalledTimes(1);
  });
});

describe("getRecentSessionMessages — failure classes, each distinguishable", () => {
  it("case 1 — transcriptPath points at a nonexistent file: transcript-unreadable, not a reader cause", async () => {
    const result = await getRecentSessionMessages(undefined, undefined, "/nonexistent/does-not-exist.jsonl");

    expect(result.messages).toEqual([]);
    expect(result.failure?.kind).toBe("transcript-unreadable");
    expect(result.failure?.hookSource).toBeUndefined();
  });

  it("case 1b — a transcriptPath containing control/ANSI bytes is sanitised in the failure message but stays identifiable (I1)", async () => {
    const evilPath = "/tmp/\x1b[31mforged\x07-session/does-not-exist.jsonl";

    const result = await getRecentSessionMessages(undefined, undefined, evilPath);

    expect(result.failure?.kind).toBe("transcript-unreadable");
    // No C0/C1 control or ESC bytes reach the diagnostic (I1,
    // .sisyphus/reviews/ticket-01-stint-implementation.md) — this would let
    // a caller-controlled --transcript path forge terminal output on the
    // stderr sink cli.ts writes this message to verbatim.
    expect(result.failure?.message).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    // The path stays identifiable: an operator reading stderr later still
    // needs to know which transcript failed, so bytes are stripped, not the
    // path itself.
    expect(result.failure?.message).toContain("forged");
    expect(result.failure?.message).toContain("does-not-exist.jsonl");
  });

  it("case 2 — a reader mock rejects on import: reader-unavailable, not the transcript", async () => {
    mockCursorGetSessions.mockResolvedValue([]); // must not be reached
    const { CursorReader } = await import("../../../src/integrations/cursor/reader.js");
    vi.mocked(CursorReader).mockImplementationOnce(() => {
      throw new Error("boom: cursor reader construction failed");
    });

    const result = await getRecentSessionMessages("sess-x", "cursor", undefined);

    expect(result.messages).toEqual([]);
    expect(result.failure?.kind).toBe("reader-unavailable");
    expect(result.failure?.hookSource).toBe("cursor");
    expect(mockCursorGetSessions).not.toHaveBeenCalled();
  });

  it("case 3 — a reader mock imports fine but getSessions() rejects: reader-retrieval-failed, distinct from case 2", async () => {
    mockCodexGetSessions.mockRejectedValue(new Error("boom: sqlite query failed"));

    const result = await getRecentSessionMessages("sess-x", "codex", undefined);

    expect(result.messages).toEqual([]);
    expect(result.failure?.kind).toBe("reader-retrieval-failed");
    expect(result.failure?.hookSource).toBe("codex");
  });

  it("case 3b — opencode getMessagesForSession() rejects: reader-retrieval-failed, not reader-unavailable", async () => {
    mockCreateOpenCodeReader.mockResolvedValue({
      getMessagesForSession: vi.fn().mockRejectedValue(new Error("boom: message read failed")),
    });

    const result = await getRecentSessionMessages("sess-x", "opencode-plugin", undefined);

    expect(result.messages).toEqual([]);
    expect(result.failure?.kind).toBe("reader-retrieval-failed");
    expect(result.failure?.hookSource).toBe("opencode-plugin");
  });

  it("case 4 — a transcript whose sole line is the JSON literal `null`: record-unprocessable", async () => {
    mockParseCodexRolloutMessages.mockImplementation(() => {
      // Mirrors the real parseCodexRolloutMessages: `record.type` throws
      // when JSON.parse("null") yields a non-object record.
      throw new TypeError("null is not an object (evaluating 'record.type')");
    });
    const path = writeTranscript("null\n");

    const result = await getRecentSessionMessages(undefined, undefined, path);

    expect(result.messages).toEqual([]);
    expect(result.failure?.kind).toBe("record-unprocessable");
  });

  it("case 5 — a reader mock resolving with zero messages: a true empty session, no failure reported", async () => {
    mockCodexGetSessions.mockResolvedValue([]);

    const result = await getRecentSessionMessages("sess-x", "codex", undefined);

    expect(result.messages).toEqual([]);
    expect(result.failure).toBeNull();
  });

  it("all five cases produce mutually distinguishable failure kinds (or none)", async () => {
    const transcriptUnreadable = await getRecentSessionMessages(undefined, undefined, "/nonexistent/x.jsonl");

    const { CursorReader } = await import("../../../src/integrations/cursor/reader.js");
    vi.mocked(CursorReader).mockImplementationOnce(() => {
      throw new Error("import-time failure");
    });
    const readerUnavailable = await getRecentSessionMessages("s", "cursor", undefined);

    mockCodexGetSessions.mockRejectedValueOnce(new Error("retrieval failure"));
    const retrievalFailed = await getRecentSessionMessages("s", "codex", undefined);

    mockParseCodexRolloutMessages.mockImplementationOnce(() => {
      throw new TypeError("null is not an object (evaluating 'record.type')");
    });
    const recordUnprocessable = await getRecentSessionMessages(undefined, undefined, writeTranscript("null\n"));

    mockCodexGetSessions.mockResolvedValueOnce([]);
    const trueEmpty = await getRecentSessionMessages("s", "codex", undefined);

    const kinds = [
      transcriptUnreadable.failure?.kind,
      readerUnavailable.failure?.kind,
      retrievalFailed.failure?.kind,
      recordUnprocessable.failure?.kind,
      trueEmpty.failure,
    ];
    expect(new Set(kinds.slice(0, 4)).size).toBe(4); // 1-4 are pairwise distinct
    expect(trueEmpty.failure).toBeNull(); // case 5 reports no failure at all
    expect(kinds.every((_, i) => i === 4 || kinds[i] !== null)).toBe(true);
  });
});
