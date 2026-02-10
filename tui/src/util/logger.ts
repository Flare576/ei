/** File-based logger for TUI debugging. Usage: tail -f ~/.ei/tui.log */

import { appendFileSync, mkdirSync } from "node:fs";

const LOG_PATH = `${Bun.env.HOME}/.ei/tui.log`;

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
    appendFileSync(LOG_PATH, line);
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
    mkdirSync(`${Bun.env.HOME}/.ei`, { recursive: true });
    const header = `--- TUI Started at ${new Date().toISOString()} ---\n`;
    Bun.write(LOG_PATH, header);
  } catch {}
}

export default logger;
