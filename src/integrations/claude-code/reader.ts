import type {
  IClaudeCodeReader,
  ClaudeCodeSession,
  ClaudeCodeMessage,
  ClaudeCodeRecord,
  ClaudeCodeUserRecord,
  ClaudeCodeAssistantRecord,
} from "./types.js";

// OpenTUI polyfills window but not document — check document for real browser
const isBrowser = typeof document !== "undefined";

let _join: typeof import("path").join;
let _readdir: typeof import("fs/promises").readdir;
let _readFile: typeof import("fs/promises").readFile;
let _nodeModulesLoaded = false;

async function ensureNodeModules(): Promise<boolean> {
  if (isBrowser) return false;
  if (_nodeModulesLoaded) return true;

  const PATH_MODULE = "path";
  const FS_MODULE = "fs/promises";

  const pathMod = await import(/* @vite-ignore */ PATH_MODULE);
  const fsMod = await import(/* @vite-ignore */ FS_MODULE);

  _join = pathMod.join;
  _readdir = fsMod.readdir;
  _readFile = fsMod.readFile;
  _nodeModulesLoaded = true;
  return true;
}

function getDefaultProjectsPath(): string {
  if (!_join) return "";
  return _join(process.env.HOME || "~", ".claude", "projects");
}

/**
 * Derives a human-readable session title from the cwd.
 * "/Users/flare576/Projects/Personal/ei" → "ei"
 */
function titleFromCwd(cwd: string): string {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Extracts plain text from an assistant content block array.
 * Skips: thinking blocks, tool_use blocks, anything that isn't a text block.
 */
function extractAssistantText(content: ClaudeCodeAssistantRecord["message"]["content"]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

export class ClaudeCodeReader implements IClaudeCodeReader {
  private readonly projectsPath?: string;

  constructor(projectsPath?: string) {
    this.projectsPath = projectsPath;
  }

  async getSessions(): Promise<ClaudeCodeSession[]> {
    if (!(await ensureNodeModules())) return [];

    const projectsDir = this.projectsPath ?? getDefaultProjectsPath();
    const sessions: ClaudeCodeSession[] = [];

    let projectDirs: string[];
    try {
      projectDirs = await _readdir(projectsDir);
    } catch {
      return [];
    }

    for (const projectDirName of projectDirs) {
      if (projectDirName.startsWith(".")) continue;

      const projectPath = _join(projectsDir, projectDirName);
      let sessionFiles: string[];
      try {
        sessionFiles = await _readdir(projectPath);
      } catch {
        continue;
      }

      for (const fileName of sessionFiles) {
        if (!fileName.endsWith(".jsonl")) continue;

        // Skip agent sidechain sessions (named "agent-<hash>.jsonl")
        if (fileName.startsWith("agent-")) continue;

        const sessionId = fileName.replace(/\.jsonl$/, "");
        const filePath = _join(projectPath, fileName);

        const session = await this.parseSessionMeta(sessionId, filePath);
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions.sort(
      (a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
  }

  async getMessagesForSession(sessionId: string): Promise<ClaudeCodeMessage[]> {
    if (!(await ensureNodeModules())) return [];

    const projectsDir = this.projectsPath ?? getDefaultProjectsPath();
    const messages: ClaudeCodeMessage[] = [];

    // Find the file — it could be under any project dir
    let projectDirs: string[];
    try {
      projectDirs = await _readdir(projectsDir);
    } catch {
      return [];
    }

    let filePath: string | null = null;
    for (const projectDirName of projectDirs) {
      if (projectDirName.startsWith(".")) continue;
      const candidate = _join(projectsDir, projectDirName, `${sessionId}.jsonl`);
      try {
        await _readFile(candidate, "utf-8"); // throws if not found
        filePath = candidate;
        break;
      } catch {
        // not in this project dir
      }
    }

    if (!filePath) return [];

    const records = await this.readJsonl(filePath);

    for (const record of records) {
      if (record.type === "user") {
        const r = record as ClaudeCodeUserRecord;
        const content = typeof r.message?.content === "string" ? r.message.content : "";
        if (!content.trim()) continue;

        messages.push({
          id: r.uuid,
          sessionId: r.sessionId,
          role: "user",
          content,
          timestamp: r.timestamp,
        });
      } else if (record.type === "assistant") {
        const r = record as ClaudeCodeAssistantRecord;
        const content = extractAssistantText(r.message?.content ?? []);
        if (!content) continue;

        messages.push({
          id: r.uuid,
          sessionId: r.sessionId,
          role: "assistant",
          content,
          timestamp: r.timestamp,
        });
      }
      // Skip: file-history-snapshot, system, summary, progress, tool_use, tool_result
    }

    return messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async parseSessionMeta(
    sessionId: string,
    filePath: string
  ): Promise<ClaudeCodeSession | null> {
    const records = await this.readJsonl(filePath);

    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let cwd = "";

    for (const record of records) {
      if (record.type !== "user" && record.type !== "assistant") continue;

      const ts = record.timestamp;
      if (!ts) continue;

      if (!firstTimestamp || ts < firstTimestamp) firstTimestamp = ts;
      if (!lastTimestamp || ts > lastTimestamp) lastTimestamp = ts;

      if (!cwd && (record as ClaudeCodeUserRecord | ClaudeCodeAssistantRecord).cwd) {
        cwd = (record as ClaudeCodeUserRecord | ClaudeCodeAssistantRecord).cwd!;
      }
    }

    if (!firstTimestamp || !lastTimestamp) return null;

    return {
      id: sessionId,
      cwd,
      title: titleFromCwd(cwd),
      firstMessageAt: firstTimestamp,
      lastMessageAt: lastTimestamp,
    };
  }

  private async readJsonl(filePath: string): Promise<ClaudeCodeRecord[]> {
    let text: string;
    try {
      text = await _readFile(filePath, "utf-8");
    } catch {
      return [];
    }

    const records: ClaudeCodeRecord[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as ClaudeCodeRecord);
      } catch {
        // skip malformed lines
      }
    }
    return records;
  }
}
