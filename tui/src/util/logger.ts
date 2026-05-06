/** File-based logger for TUI debugging. Usage: tail -f $EI_DATA_PATH/tui.log */

import { appendFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { resolveDataPath } from "./resolve-data-path.js";

const MAX_ROLLED_LOGS = 10;

function getLogPath(): string {
  return join(resolveDataPath(), "tui.log");
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (Bun.env.EI_LOG_LEVEL as LogLevel) || "warn";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  let line = `[${timestamp}] ${levelStr} ${message}`;
  
  if (data !== undefined) {
    try {
      line += ` ${JSON.stringify(data)}`;
    } catch {
      line += ` [unstringifiable: ${typeof data}]`;
    }
  }
  
  return line + "\n";
}

function writeLogSync(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  const line = formatMessage(level, message, data);
  try {
    appendFileSync(getLogPath(), line);
  } catch {}
}

export const logger = {
  debug: (message: string, data?: unknown) => writeLogSync("debug", message, data),
  info: (message: string, data?: unknown) => writeLogSync("info", message, data),
  warn: (message: string, data?: unknown) => writeLogSync("warn", message, data),
  error: (message: string, data?: unknown) => writeLogSync("error", message, data),
};

export function rotateLog(): void {
  try {
    const logPath = getLogPath();
    const dataDir = logPath.substring(0, logPath.lastIndexOf("/"));
    mkdirSync(dataDir, { recursive: true });

    if (existsSync(logPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      renameSync(logPath, join(dataDir, `tui-${ts}.log`));
    }

    const rolled = readdirSync(dataDir)
      .filter(f => /^tui-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/.test(f))
      .sort();
    for (const old of rolled.slice(0, Math.max(0, rolled.length - MAX_ROLLED_LOGS))) {
      unlinkSync(join(dataDir, old));
    }

    const header = `--- TUI Started at ${new Date().toISOString()} ---\n`;
    Bun.write(logPath, header);
  } catch {}
}

/** @deprecated Use rotateLog() instead */
export function clearLog(): void {
  rotateLog();
}

export function interceptConsole(): void {
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const originalDebug = console.debug.bind(console);
  const originalInfo = console.info.bind(console);

  const formatArgs = (args: unknown[]): string => {
    return args.map(arg => 
      typeof arg === "string" ? arg : JSON.stringify(arg)
    ).join(" ");
  };

  console.log = (...args: unknown[]) => {
    writeLogSync("info", `[console.log] ${formatArgs(args)}`);
    originalLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    writeLogSync("warn", `[console.warn] ${formatArgs(args)}`);
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    writeLogSync("error", `[console.error] ${formatArgs(args)}`);
    originalError(...args);
  };
  console.debug = (...args: unknown[]) => {
    writeLogSync("debug", `[console.debug] ${formatArgs(args)}`);
    originalDebug(...args);
  };
  console.info = (...args: unknown[]) => {
    writeLogSync("info", `[console.info] ${formatArgs(args)}`);
    originalInfo(...args);
  };
}

export default logger;
