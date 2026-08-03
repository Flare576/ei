/**
 * Real, unmocked ClaudeCodeReader.getMessagesForSession() against a real
 * temporary projects tree -- proves C1's traversal guard actually closes a
 * real filesystem escape (not just a mocked one), and that a normal,
 * legitimate session lookup is completely unaffected.
 *
 * See C1 in .sisyphus/reviews/wave-2-quote-attestation.md: the reader
 * builds `path.join(projectsDir, projectDirName, `${sessionId}.jsonl`)`
 * from a caller-controlled session segment with no traversal guard.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import { ClaudeCodeReader } from "../../../../src/integrations/claude-code/reader.js";

const NOW = "2026-01-01T00:00:00.000Z";

function userRecord(uuid: string, sessionId: string, content: string): string {
  return JSON.stringify({ type: "user", uuid, sessionId, cwd: "/repo", timestamp: NOW, message: { role: "user", content } });
}

function assistantRecord(uuid: string, sessionId: string, text: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    sessionId,
    cwd: "/repo",
    timestamp: NOW,
    message: { model: "claude", role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("ClaudeCodeReader.getMessagesForSession", () => {
  let projectsDir: string;
  let outsideDir: string;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "ei-claude-projects-"));
    outsideDir = mkdtempSync(join(tmpdir(), "ei-claude-outside-"));
  });

  afterEach(() => {
    rmSync(projectsDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it("resolves a normal, legitimate session lookup unaffected", async () => {
    const sessionId = "0acef1d4-fe05-44f8-a285-5d69bebbbf8c";
    const projectDir = join(projectsDir, "-Users-flare576-Projects-ei");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, `${sessionId}.jsonl`),
      [userRecord("u1", sessionId, "hello there"), assistantRecord("a1", sessionId, "hi back")].join("\n") + "\n"
    );

    const reader = new ClaudeCodeReader(projectsDir);
    const messages = await reader.getMessagesForSession(sessionId);

    expect(messages).toEqual([
      { id: "u1", sessionId, role: "user", content: "hello there", timestamp: NOW },
      { id: "a1", sessionId, role: "assistant", content: "hi back", timestamp: NOW },
    ]);
  });

  it.each([
    ["a forward-slash segment", "../secret"],
    ["a backslash segment", "..\\secret"],
    ["a bare .. segment", ".."],
    ["a segment with an embedded backslash mid-string", "foo\\bar"],
  ])("rejects %s before it ever reaches path.join, returning no messages", async (_label, unsafeSegment) => {
    const reader = new ClaudeCodeReader(projectsDir);
    const messages = await reader.getMessagesForSession(unsafeSegment);
    expect(messages).toEqual([]);
  });

  it("rejects a traversal segment that would otherwise escape the projects tree and read a real file outside it", async () => {
    // A real, readable transcript OUTSIDE projectsDir entirely -- if the
    // traversal guard were absent, path.join's own normalization would
    // happily walk out of "some-project" and out of projectsDir itself to
    // reach it.
    const projectDir = join(projectsDir, "some-project");
    mkdirSync(projectDir, { recursive: true });
    const secretFile = join(outsideDir, "reachable-only-by-traversal.jsonl");
    writeFileSync(secretFile, userRecord("leaked", "leaked-session", "should never be readable") + "\n");

    // Exact relative path from the project dir the reader will try, to the
    // real secret file -- computed rather than hardcoded so this doesn't
    // depend on the OS tmpdir's actual nesting depth.
    const escapeSegment = join(relative(projectDir, outsideDir), "reachable-only-by-traversal");
    expect(escapeSegment).toContain("/"); // sanity: this really is a multi-segment traversal path

    const reader = new ClaudeCodeReader(projectsDir);
    const messages = await reader.getMessagesForSession(escapeSegment);

    expect(messages).toEqual([]);
  });

  it("still returns [] for a session id that legitimately doesn't exist (unaffected baseline)", async () => {
    const projectDir = join(projectsDir, "some-project");
    mkdirSync(projectDir, { recursive: true });

    const reader = new ClaudeCodeReader(projectsDir);
    const messages = await reader.getMessagesForSession("11111111-1111-4111-8111-111111111111");

    expect(messages).toEqual([]);
  });
});
