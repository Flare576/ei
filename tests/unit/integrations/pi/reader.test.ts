import { describe, expect, it } from "vitest";
import { PiReader } from "../../../../src/integrations/pi/reader.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

function makeEntry(overrides: Record<string, unknown>): string {
  return JSON.stringify(overrides);
}

function makeUserEntry(id: string, parentId: string, timestamp: string, content: string): string {
  return makeEntry({
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content },
  });
}

function makeAssistantEntry(
  id: string,
  parentId: string,
  timestamp: string,
  contentBlocks: Array<{ type: string; text?: string; thinking?: string }>
): string {
  return makeEntry({
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "assistant", content: contentBlocks },
  });
}

async function writeSession(dir: string, cwdDir: string, filename: string, lines: string[]): Promise<string> {
  const cwdPath = path.join(dir, cwdDir);
  await fs.mkdir(cwdPath, { recursive: true });
  const filePath = path.join(cwdPath, filename);
  await fs.writeFile(filePath, lines.join("\n") + "\n");
  return filePath;
}

describe("PiReader", () => {
  it("returns empty when sessions root does not exist", async () => {
    const reader = new PiReader(["/nonexistent/path"]);
    const sessions = await reader.getSessions();
    expect(sessions).toEqual([]);
  });

  it("reports unavailable when no sessions roots exist", async () => {
    const reader = new PiReader(["/nonexistent/path"]);
    expect(await reader.isAvailable()).toBe(false);
  });

  it("reports available when at least one root exists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const reader = new PiReader([tmp]);
      expect(await reader.isAvailable()).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty when sessions root is empty", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const reader = new PiReader([tmp]);
      expect(await reader.getSessions()).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("parses a session with user and assistant messages", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--Users--flare576--Projects--Personal--ei--", filename, [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Hello Pi"),
        makeAssistantEntry("aa000002", "aa000001", "2026-05-20T14:57:15.000Z", [
          { type: "text", text: "Hello back" },
        ]),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(uuid);
      expect(sessions[0].title).toBe("ei");
      expect(sessions[0].cwd).toBe("/Users/flare576/Projects/Personal/ei/");
      expect(sessions[0].messages).toHaveLength(2);
      expect(sessions[0].messages[0].role).toBe("user");
      expect(sessions[0].messages[0].content).toBe("Hello Pi");
      expect(sessions[0].messages[1].role).toBe("assistant");
      expect(sessions[0].messages[1].content).toBe("Hello back");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips toolResult and custom message types", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--Users--flare576--", filename, [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Start"),
        makeEntry({
          type: "message",
          id: "aa000002",
          parentId: "aa000001",
          timestamp: "2026-05-20T14:57:11.000Z",
          message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "file contents" }] },
        }),
        makeEntry({
          type: "message",
          id: "aa000003",
          parentId: "aa000002",
          timestamp: "2026-05-20T14:57:12.000Z",
          message: { role: "custom", customType: "ei-context", content: "injected context", display: false },
        }),
        makeAssistantEntry("aa000004", "aa000003", "2026-05-20T14:57:13.000Z", [
          { type: "text", text: "Done" },
        ]),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      expect(sessions[0].messages).toHaveLength(2);
      expect(sessions[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("strips thinking blocks from assistant messages", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--tmp--", filename, [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Think hard"),
        makeAssistantEntry("aa000002", "aa000001", "2026-05-20T14:57:15.000Z", [
          { type: "thinking", thinking: "Let me reason about this..." },
          { type: "text", text: "My answer" },
        ]),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      const assistant = sessions[0].messages.find((m) => m.role === "assistant");
      expect(assistant?.content).toBe("My answer");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips non-message entry types (model-change, compaction, etc.)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--tmp--", filename, [
        JSON.stringify({ type: "model-change", id: "mc1", model: "claude-sonnet-4-6" }),
        JSON.stringify({ type: "thinking-level", id: "tl1", level: "medium" }),
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Hi"),
        JSON.stringify({ type: "compaction", id: "cp1", summary: "earlier context" }),
        makeAssistantEntry("aa000002", "aa000001", "2026-05-20T14:57:15.000Z", [
          { type: "text", text: "Hey" },
        ]),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      expect(sessions[0].messages).toHaveLength(2);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips sessions where filename has no underscore (bad format)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      await writeSession(tmp, "--tmp--", "no-uuid-here.jsonl", [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Hi"),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();
      expect(sessions).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("skips sessions with no valid messages", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--tmp--", filename, [
        JSON.stringify({ type: "model-change", id: "mc1" }),
        "not json at all",
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();
      expect(sessions).toHaveLength(0);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("sorts sessions oldest-first across multiple cwd dirs", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuidA = "aaaaaaaa-0000-0000-0000-000000000001";
      const uuidB = "bbbbbbbb-0000-0000-0000-000000000002";
      await writeSession(tmp, "--proj-a--", `2026-05-20T10-00-00-000Z_${uuidA}.jsonl`, [
        makeUserEntry("aa000001", "root", "2026-05-20T10:00:00.000Z", "Session A"),
      ]);
      await writeSession(tmp, "--proj-b--", `2026-05-19T10-00-00-000Z_${uuidB}.jsonl`, [
        makeUserEntry("bb000001", "root", "2026-05-19T10:00:00.000Z", "Session B"),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(uuidB);
      expect(sessions[1].id).toBe(uuidA);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("decodes cwd from double-dash encoded directory name", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--Users--flare576--Projects--Personal--ei--", filename, [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "Hi"),
      ]);

      const reader = new PiReader([tmp]);
      const sessions = await reader.getSessions();

      expect(sessions[0].cwd).toBe("/Users/flare576/Projects/Personal/ei/");
      expect(sessions[0].title).toBe("ei");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("reads from both pi and omp roots when both provided", async () => {
    const tmpPi = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    const tmpOmp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-test-"));
    try {
      const uuidPi = "aaaaaaaa-0000-0000-0000-000000000001";
      const uuidOmp = "bbbbbbbb-0000-0000-0000-000000000002";
      await writeSession(tmpPi, "--proj--", `2026-05-19T10-00-00-000Z_${uuidPi}.jsonl`, [
        makeUserEntry("aa000001", "root", "2026-05-19T10:00:00.000Z", "Pi session"),
      ]);
      await writeSession(tmpOmp, "--proj--", `2026-05-20T10-00-00-000Z_${uuidOmp}.jsonl`, [
        makeUserEntry("bb000001", "root", "2026-05-20T10:00:00.000Z", "OMP session"),
      ]);

      const reader = new PiReader([tmpPi, tmpOmp]);
      const sessions = await reader.getSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.id)).toContain(uuidPi);
      expect(sessions.map((s) => s.id)).toContain(uuidOmp);
    } finally {
      await fs.rm(tmpPi, { recursive: true, force: true });
      await fs.rm(tmpOmp, { recursive: true, force: true });
    }
  });

  it("getMessageById returns the message with context window", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-test-"));
    try {
      const uuid = "019e45e3-e2e5-7174-8165-da221c147ebb";
      const filename = `2026-05-20T14-57-03-205Z_${uuid}.jsonl`;
      await writeSession(tmp, "--tmp--", filename, [
        makeUserEntry("aa000001", "root", "2026-05-20T14:57:10.000Z", "First"),
        makeUserEntry("aa000002", "aa000001", "2026-05-20T14:57:11.000Z", "Second"),
        makeUserEntry("aa000003", "aa000002", "2026-05-20T14:57:12.000Z", "Third"),
      ]);

      const reader = new PiReader([tmp]);
      const win = await reader.getMessageById(uuid, `${uuid}/aa000002`, 1, 1);

      expect(win).not.toBeNull();
      expect(win!.message.content).toBe("Second");
      expect(win!.before).toHaveLength(1);
      expect(win!.before[0].content).toBe("First");
      expect(win!.after).toHaveLength(1);
      expect(win!.after[0].content).toBe("Third");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("getMessageById returns null for unknown session", async () => {
    const reader = new PiReader(["/nonexistent"]);
    const result = await reader.getMessageById("no-such-session", "no-such-msg");
    expect(result).toBeNull();
  });
});
