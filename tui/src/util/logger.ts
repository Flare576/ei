/** File-based logger for TUI debugging. Usage: tail -f $EI_DATA_PATH/tui.log */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function getDataPath(): string {
  if (Bun.env.EI_DATA_PATH) return Bun.env.EI_DATA_PATH;
  const xdgData = Bun.env.XDG_DATA_HOME || join(Bun.env.HOME || "~", ".local", "share");
  return join(xdgData, "ei");
}

function getLogPath(): string {
  return join(getDataPath(), "tui.log");
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (Bun.env.EI_LOG_LEVEL as LogLevel) || "debug";

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

export function clearLog(): void {
  try {
    const logPath = getLogPath();
    const dataDir = logPath.substring(0, logPath.lastIndexOf("/"));
    mkdirSync(dataDir, { recursive: true });
    const header = `--- TUI Started at ${new Date().toISOString()} ---\n`;
    Bun.write(logPath, header);
  } catch {}
}

export default logger;
