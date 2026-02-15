import type { OverlayRenderer } from "../context/overlay";

export interface Command {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute: (args: string[], context: CommandContext) => Promise<void>;
}

export interface CommandContext {
  showOverlay: (renderer: OverlayRenderer) => void;
  hideOverlay: () => void;
  showNotification: (msg: string, level: "error" | "warn" | "info") => void;
  exitApp: () => void;
  stopProcessor: () => Promise<void>;
}

const commands = new Map<string, Command>();
const commandsByName = new Map<string, Command>();

/**
 * Parse command line input, respecting quoted strings
 */
export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Register a command by name and all aliases
 */
export function registerCommand(cmd: Command): void {
  commands.set(cmd.name, cmd);
  commandsByName.set(cmd.name, cmd);

  for (const alias of cmd.aliases) {
    commands.set(alias, cmd);
  }
}

/**
 * Parse and execute a command
 * Returns true if input was a command (even if unknown), false otherwise
 */
export async function parseAndExecute(
  input: string,
  ctx: CommandContext
): Promise<boolean> {
  if (!input.startsWith("/")) {
    return false;
  }

  const commandInput = input.slice(1);
  const tokens = parseCommandLine(commandInput);
  
  if (tokens.length === 0) {
    return true;
  }

  let commandName = tokens[0];
  let hasForce = false;
  
  if (commandName.endsWith("!")) {
    hasForce = true;
    commandName = commandName.slice(0, -1);
  }

  const command = commands.get(commandName);
  
  if (!command) {
    ctx.showNotification(`Unknown command: /${commandName}`, "error");
    return true;
  }

  const args = tokens.slice(1);
  
  if (hasForce && !args.includes("--force")) {
    args.unshift("--force");
  }

  try {
    await command.execute(args, ctx);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    ctx.showNotification(`Command failed: ${errorMsg}`, "error");
  }

  return true;
}

/**
 * Get all registered commands (no duplicates from aliases)
 */
export function getAllCommands(): Command[] {
  return Array.from(commandsByName.values());
}
