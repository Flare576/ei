import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenCodeReader } from "../../../../src/integrations/opencode/reader.js";
import { BUILTIN_AGENTS } from "../../../../src/integrations/opencode/types.js";
import * as path from "path";

const mockReaddir = vi.fn();
const mockReadFile = vi.fn();

vi.mock("fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

describe("OpenCodeReader", () => {
  let reader: OpenCodeReader;
  let testStoragePath: string;

  beforeEach(() => {
    testStoragePath = "/test/storage/path";
    reader = new OpenCodeReader(testStoragePath);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getSessionsUpdatedSince", () => {
    it("returns empty array when session directory doesn't exist", async () => {
      mockReaddir.mockRejectedValue(new Error("ENOENT"));

      const sessions = await reader.getSessionsUpdatedSince(new Date(0));

      expect(sessions).toEqual([]);
    });

    it("returns sessions updated after the given date", async () => {
      const projectHash = "abc123";
      const sessionId = "ses_test123";
      const sessionData = {
        id: sessionId,
        slug: "test-slug",
        version: "1.0.0",
        projectID: projectHash,
        directory: "/test/project",
        title: "Test Session",
        time: {
          created: 1000000,
          updated: 2000000,
        },
      };

      mockReaddir
        .mockResolvedValueOnce([projectHash] as string[])
        .mockResolvedValueOnce([`${sessionId}.json`] as string[]);

      mockReadFile.mockResolvedValue(JSON.stringify(sessionData));

      const since = new Date(1500000);
      const sessions = await reader.getSessionsUpdatedSince(since);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toEqual({
        id: sessionId,
        title: "Test Session",
        directory: "/test/project",
        projectId: projectHash,
        parentId: undefined,
        time: {
          created: 1000000,
          updated: 2000000,
        },
      });
    });

    it("filters out sessions updated before the given date", async () => {
      const sessionData = {
        id: "ses_old",
        slug: "old-slug",
        version: "1.0.0",
        projectID: "proj123",
        directory: "/test/project",
        title: "Old Session",
        time: {
          created: 500000,
          updated: 1000000,
        },
      };

      mockReaddir
        .mockResolvedValueOnce(["proj123"] as string[])
        .mockResolvedValueOnce(["ses_old.json"] as string[]);

      mockReadFile.mockResolvedValue(JSON.stringify(sessionData));

      const since = new Date(1500000);
      const sessions = await reader.getSessionsUpdatedSince(since);

      expect(sessions).toHaveLength(0);
    });

    it("skips hidden directories", async () => {
      mockReaddir.mockResolvedValueOnce([".hidden", "visible"] as string[]);
      mockReaddir.mockResolvedValueOnce([] as string[]);

      await reader.getSessionsUpdatedSince(new Date(0));

      expect(mockReaddir).toHaveBeenCalledTimes(2);
      expect(mockReaddir).toHaveBeenLastCalledWith(
        path.join(testStoragePath, "session", "visible")
      );
    });

    it("sorts sessions by updated time descending (newest first)", async () => {
      const session1 = {
        id: "ses_newer",
        slug: "newer",
        version: "1.0.0",
        projectID: "proj",
        directory: "/test",
        title: "Newer",
        time: { created: 1000, updated: 3000 },
      };
      const session2 = {
        id: "ses_older",
        slug: "older",
        version: "1.0.0",
        projectID: "proj",
        directory: "/test",
        title: "Older",
        time: { created: 1000, updated: 2000 },
      };

      mockReaddir
        .mockResolvedValueOnce(["proj"] as string[])
        .mockResolvedValueOnce(["ses_newer.json", "ses_older.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(session1))
        .mockResolvedValueOnce(JSON.stringify(session2));

      const sessions = await reader.getSessionsUpdatedSince(new Date(0));

      expect(sessions[0].id).toBe("ses_newer");
      expect(sessions[1].id).toBe("ses_older");
    });
  });

  describe("getMessagesForSession", () => {
    const sessionId = "ses_test123";
    const messageId = "msg_test456";
    const partId = "prt_test789";

    it("returns empty array when message directory doesn't exist", async () => {
      mockReaddir.mockRejectedValue(new Error("ENOENT"));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toEqual([]);
    });

    it("returns messages with filtered text content", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "user",
        time: { created: 1000000 },
        agent: "build",
      };
      const partData = {
        id: partId,
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Hello world",
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce([`${partId}.json`] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(messageData))
        .mockResolvedValueOnce(JSON.stringify(partData));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        id: messageId,
        sessionId: sessionId,
        role: "user",
        agent: "build",
        content: "Hello world",
        timestamp: new Date(1000000).toISOString(),
      });
    });

    it("filters out synthetic text parts", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "assistant",
        time: { created: 1000000 },
        agent: "build",
      };
      const realPart = {
        id: "prt_real",
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Real content",
        synthetic: false,
      };
      const syntheticPart = {
        id: "prt_synthetic",
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Called the Read tool...",
        synthetic: true,
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce(["prt_real.json", "prt_synthetic.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(messageData))
        .mockResolvedValueOnce(JSON.stringify(realPart))
        .mockResolvedValueOnce(JSON.stringify(syntheticPart));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Real content");
    });

    it("filters out non-text part types", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "assistant",
        time: { created: 1000000 },
        agent: "build",
      };
      const textPart = {
        id: "prt_text",
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Text content",
      };
      const toolPart = {
        id: "prt_tool",
        sessionID: sessionId,
        messageID: messageId,
        type: "tool",
        tool: { name: "read" },
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce(["prt_text.json", "prt_tool.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(messageData))
        .mockResolvedValueOnce(JSON.stringify(textPart))
        .mockResolvedValueOnce(JSON.stringify(toolPart));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Text content");
    });

    it("concatenates multiple text parts with double newlines", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "assistant",
        time: { created: 1000000 },
        agent: "build",
      };
      const part1 = {
        id: "prt_1",
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "First part",
        time: { start: 1000, end: 1100 },
      };
      const part2 = {
        id: "prt_2",
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Second part",
        time: { start: 2000, end: 2100 },
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce(["prt_2.json", "prt_1.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(messageData))
        .mockResolvedValueOnce(JSON.stringify(part2))
        .mockResolvedValueOnce(JSON.stringify(part1));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("First part\n\nSecond part");
    });

    it("skips messages with no valid content", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "assistant",
        time: { created: 1000000 },
        agent: "build",
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce([] as string[]);

      mockReadFile.mockResolvedValueOnce(JSON.stringify(messageData));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages).toHaveLength(0);
    });

    it("filters messages by since date", async () => {
      const oldMessage = {
        id: "msg_old",
        sessionID: sessionId,
        role: "user",
        time: { created: 1000 },
        agent: "build",
      };
      const newMessage = {
        id: "msg_new",
        sessionID: sessionId,
        role: "user",
        time: { created: 3000 },
        agent: "build",
      };
      const _partOld = {
        id: "prt_old",
        sessionID: sessionId,
        messageID: "msg_old",
        type: "text",
        text: "Old",
      };
      const partNew = {
        id: "prt_new",
        sessionID: sessionId,
        messageID: "msg_new",
        type: "text",
        text: "New",
      };

      mockReaddir
        .mockResolvedValueOnce(["msg_old.json", "msg_new.json"] as string[])
        .mockResolvedValueOnce(["prt_new.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(oldMessage))
        .mockResolvedValueOnce(JSON.stringify(newMessage))
        .mockResolvedValueOnce(JSON.stringify(partNew));

      const messages = await reader.getMessagesForSession(sessionId, new Date(2000));

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe("msg_new");
    });

    it("defaults agent to 'build' when not specified", async () => {
      const messageData = {
        id: messageId,
        sessionID: sessionId,
        role: "user",
        time: { created: 1000000 },
      };
      const partData = {
        id: partId,
        sessionID: sessionId,
        messageID: messageId,
        type: "text",
        text: "Hello",
      };

      mockReaddir
        .mockResolvedValueOnce([`${messageId}.json`] as string[])
        .mockResolvedValueOnce([`${partId}.json`] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(messageData))
        .mockResolvedValueOnce(JSON.stringify(partData));

      const messages = await reader.getMessagesForSession(sessionId);

      expect(messages[0].agent).toBe("build");
    });
  });

  describe("getAgentInfo", () => {
    it("returns builtin agent info for known agents", async () => {
      const agent = await reader.getAgentInfo("build");

      expect(agent).toEqual(BUILTIN_AGENTS.build);
    });

    it("returns default info for unknown agents", async () => {
      const agent = await reader.getAgentInfo("custom-agent");

      expect(agent).toEqual({
        name: "custom-agent",
        description: "OpenCode coding agent",
      });
    });

    it("normalizes agent names to lowercase", async () => {
      const agent = await reader.getAgentInfo("BUILD");

      expect(agent).toEqual(BUILTIN_AGENTS.build);
    });
  });

  describe("getFirstAgent", () => {
    it("returns null when message directory doesn't exist", async () => {
      mockReaddir.mockRejectedValue(new Error("ENOENT"));

      const agent = await reader.getFirstAgent("ses_test");

      expect(agent).toBeNull();
    });

    it("returns agent from earliest message", async () => {
      const message1 = {
        id: "msg_1",
        sessionID: "ses_test",
        role: "user",
        time: { created: 2000 },
        agent: "sisyphus",
      };
      const message2 = {
        id: "msg_2",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: 1000 },
        agent: "build",
      };

      mockReaddir.mockResolvedValueOnce(["msg_1.json", "msg_2.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(message1))
        .mockResolvedValueOnce(JSON.stringify(message2));

      const agent = await reader.getFirstAgent("ses_test");

      expect(agent).toBe("build");
    });
  });

  describe("getAllUniqueAgents", () => {
    it("returns unique agents from session messages", async () => {
      const message1 = {
        id: "msg_1",
        sessionID: "ses_test",
        role: "user",
        time: { created: 1000 },
        agent: "build",
      };
      const message2 = {
        id: "msg_2",
        sessionID: "ses_test",
        role: "assistant",
        time: { created: 2000 },
        agent: "sisyphus",
      };
      const message3 = {
        id: "msg_3",
        sessionID: "ses_test",
        role: "user",
        time: { created: 3000 },
        agent: "build",
      };
      const part1 = { id: "prt_1", sessionID: "ses_test", messageID: "msg_1", type: "text", text: "a" };
      const part2 = { id: "prt_2", sessionID: "ses_test", messageID: "msg_2", type: "text", text: "b" };
      const part3 = { id: "prt_3", sessionID: "ses_test", messageID: "msg_3", type: "text", text: "c" };

      mockReaddir
        .mockResolvedValueOnce(["msg_1.json", "msg_2.json", "msg_3.json"] as string[])
        .mockResolvedValueOnce(["prt_1.json"] as string[])
        .mockResolvedValueOnce(["prt_2.json"] as string[])
        .mockResolvedValueOnce(["prt_3.json"] as string[]);

      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(message1))
        .mockResolvedValueOnce(JSON.stringify(part1))
        .mockResolvedValueOnce(JSON.stringify(message2))
        .mockResolvedValueOnce(JSON.stringify(part2))
        .mockResolvedValueOnce(JSON.stringify(message3))
        .mockResolvedValueOnce(JSON.stringify(part3));

      const agents = await reader.getAllUniqueAgents("ses_test");

      expect(agents).toContain("build");
      expect(agents).toContain("sisyphus");
      expect(agents).toHaveLength(2);
    });
  });

  describe("constructor and initialization", () => {
    it("stores configured path for later initialization", () => {
      const reader = new OpenCodeReader("/custom/path");
      // configuredPath is stored immediately, storagePath is set during lazy init
      expect((reader as unknown as { configuredPath: string }).configuredPath).toBe("/custom/path");
    });

    it("uses provided storage path after initialization", async () => {
      const localReader = new OpenCodeReader("/custom/path");
      mockReaddir.mockRejectedValue(new Error("ENOENT"));
      
      // Trigger initialization by calling a method
      await localReader.getSessionsUpdatedSince(new Date());
      
      expect((localReader as unknown as { storagePath: string }).storagePath).toBe("/custom/path");
    });

    it("uses EI_OPENCODE_STORAGE_PATH env var after initialization", async () => {
      const originalEnv = process.env.EI_OPENCODE_STORAGE_PATH;
      process.env.EI_OPENCODE_STORAGE_PATH = "/env/path";
      
      const localReader = new OpenCodeReader();
      mockReaddir.mockRejectedValue(new Error("ENOENT"));
      
      // Trigger initialization by calling a method
      await localReader.getSessionsUpdatedSince(new Date());
      
      expect((localReader as unknown as { storagePath: string }).storagePath).toBe("/env/path");
      
      process.env.EI_OPENCODE_STORAGE_PATH = originalEnv;
    });

    it("falls back to default path after initialization", async () => {
      const originalEnv = process.env.EI_OPENCODE_STORAGE_PATH;
      delete process.env.EI_OPENCODE_STORAGE_PATH;
      
      const localReader = new OpenCodeReader();
      mockReaddir.mockRejectedValue(new Error("ENOENT"));
      
      // Trigger initialization by calling a method
      await localReader.getSessionsUpdatedSince(new Date());
      
      expect((localReader as unknown as { storagePath: string }).storagePath).toContain(".local/share/opencode/storage");
      
      process.env.EI_OPENCODE_STORAGE_PATH = originalEnv;
    });
  });
});
