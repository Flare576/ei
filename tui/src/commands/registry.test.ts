import { test, expect, describe, beforeEach, mock } from "bun:test";
import { parseCommandLine, registerCommand, parseAndExecute, getAllCommands, type Command, type CommandContext } from "./registry";

describe("parseCommandLine", () => {
  test("parses simple command", () => {
    expect(parseCommandLine("quit")).toEqual(["quit"]);
  });

  test("parses command with arguments", () => {
    expect(parseCommandLine("persona switch Ei")).toEqual(["persona", "switch", "Ei"]);
  });

  test("parses quoted arguments with spaces", () => {
    expect(parseCommandLine('message "hello world"')).toEqual(["message", "hello world"]);
  });

  test("parses single-quoted arguments", () => {
    expect(parseCommandLine("message 'hello world'")).toEqual(["message", "hello world"]);
  });

  test("handles empty input", () => {
    expect(parseCommandLine("")).toEqual([]);
  });

  test("handles multiple spaces between args", () => {
    expect(parseCommandLine("cmd   arg1    arg2")).toEqual(["cmd", "arg1", "arg2"]);
  });

  test("handles mixed quoted and unquoted", () => {
    expect(parseCommandLine('cmd arg1 "arg 2" arg3')).toEqual(["cmd", "arg1", "arg 2", "arg3"]);
  });
});

describe("registerCommand and getAllCommands", () => {
  test("registers command by name", () => {
    const testCmd: Command = {
      name: "testcmd",
      aliases: [],
      description: "Test command",
      usage: "/testcmd",
      execute: async () => {},
    };
    
    registerCommand(testCmd);
    const commands = getAllCommands();
    expect(commands.some(c => c.name === "testcmd")).toBe(true);
  });

  test("getAllCommands returns no duplicates from aliases", () => {
    const cmdWithAlias: Command = {
      name: "aliased",
      aliases: ["a", "al"],
      description: "Command with aliases",
      usage: "/aliased or /a or /al",
      execute: async () => {},
    };
    
    registerCommand(cmdWithAlias);
    const commands = getAllCommands();
    const aliasedCommands = commands.filter(c => c.name === "aliased");
    expect(aliasedCommands.length).toBe(1);
  });
});

describe("parseAndExecute", () => {
  const mockContext: CommandContext = {
    showOverlay: mock(() => {}),
    hideOverlay: mock(() => {}),
    showNotification: mock(() => {}),
    exitApp: mock(() => {}),
    stopProcessor: mock(async () => {}),
    ei: {
      personas: () => [],
      activePersona: () => null,
      messages: () => [],
      queueStatus: () => ({ state: "idle" as const, pending_count: 0 }),
      notification: () => null,
      selectPersona: () => {},
      sendMessage: async () => {},
      refreshPersonas: async () => {},
      refreshMessages: async () => {},
      abortCurrentOperation: async () => {},
      resumeQueue: async () => {},
      stopProcessor: async () => {},
      showNotification: () => {},
      createPersona: async () => {},
      archivePersona: async () => {},
      unarchivePersona: async () => {},
    },
  };

  beforeEach(() => {
    (mockContext.showNotification as ReturnType<typeof mock>).mockReset();
    (mockContext.exitApp as ReturnType<typeof mock>).mockReset();
  });

  test("returns false for non-command input", async () => {
    const result = await parseAndExecute("hello world", mockContext);
    expect(result).toBe(false);
  });

  test("returns true for command input", async () => {
    const result = await parseAndExecute("/help", mockContext);
    expect(result).toBe(true);
  });

  test("shows error for unknown command", async () => {
    await parseAndExecute("/unknownxyz", mockContext);
    expect(mockContext.showNotification).toHaveBeenCalledWith(
      "Unknown command: /unknownxyz",
      "error"
    );
  });

  test("handles force suffix (!)", async () => {
    const forceCmd: Command = {
      name: "forceable",
      aliases: [],
      description: "Forceable command",
      usage: "/forceable",
      execute: mock(async (args) => {
        expect(args).toContain("--force");
      }),
    };
    
    registerCommand(forceCmd);
    await parseAndExecute("/forceable!", mockContext);
    expect(forceCmd.execute).toHaveBeenCalled();
  });

  test("returns true for empty command (just /)", async () => {
    const result = await parseAndExecute("/", mockContext);
    expect(result).toBe(true);
  });
});
