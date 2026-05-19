import type {
  CodexMessage,
  CodexMessageWindow,
  CodexRolloutRecord,
  CodexSession,
  CodexThreadRow,
  ICodexReader,
} from "./types.js";

const isBrowser = typeof document !== "undefined";

let _join: typeof import("path").join;
let _basename: typeof import("path").basename;
let _readFile: typeof import("fs/promises").readFile;
let _readdir: typeof import("fs/promises").readdir;
let _stat: typeof import("fs/promises").stat;
let _nodeModulesLoaded = false;

async function ensureNodeModules(): Promise<boolean> {
  if (isBrowser) return false;
  if (_nodeModulesLoaded) return true;

  const PATH_MODULE = "path";
  const FS_MODULE = "fs/promises";

  const pathMod = await import(/* @vite-ignore */ PATH_MODULE);
  const fsMod = await import(/* @vite-ignore */ FS_MODULE);

  _join = pathMod.join;
  _basename = pathMod.basename;
  _readFile = fsMod.readFile;
  _readdir = fsMod.readdir;
  _stat = fsMod.stat;
  _nodeModulesLoaded = true;
  return true;
}

function getDefaultCodexHome(): string {
  if (!_join) return "";
  return process.env.CODEX_HOME || _join(process.env.HOME || "~", ".codex");
}

function titleFromCwd(cwd: string): string {
  if (!cwd) return "Codex Session";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function timestampFromMs(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value).toISOString();
}

function extractEventMessage(record: CodexRolloutRecord, lineIndex: number, sessionId: string): CodexMessage | null {
  if (record.type !== "event_msg") return null;

  const payload = record.payload ?? {};
  const payloadType = payload.type;
  if (payloadType !== "user_message" && payloadType !== "agent_message") return null;

  const rawMessage = payload.message;
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") return null;

  const timestamp = typeof record.timestamp === "string" && record.timestamp.trim()
    ? record.timestamp
    : new Date(0).toISOString();

  return {
    id: `evt_${lineIndex + 1}`,
    sessionId,
    role: payloadType === "user_message" ? "user" : "assistant",
    content: rawMessage.trim(),
    timestamp,
  };
}

export function parseCodexRolloutMessages(text: string, sessionId: string): CodexMessage[] {
  const messages: CodexMessage[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    let record: CodexRolloutRecord;
    try {
      record = JSON.parse(trimmed) as CodexRolloutRecord;
    } catch {
      continue;
    }

    const message = extractEventMessage(record, i, sessionId);
    if (message) messages.push(message);
  }

  return messages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export class CodexReader implements ICodexReader {
  private readonly codexHome?: string;

  constructor(codexHome?: string) {
    this.codexHome = codexHome;
  }

  async isAvailable(): Promise<boolean> {
    if (!(await ensureNodeModules())) return false;
    const dbPath = await this.findStateDbPath();
    if (!dbPath) return false;

    try {
      return (await _stat(dbPath)).isFile();
    } catch {
      return false;
    }
  }

  async getSessions(): Promise<CodexSession[]> {
    if (!(await ensureNodeModules())) return [];

    const dbPath = await this.findStateDbPath();
    if (!dbPath) return [];

    let db: import("bun:sqlite").Database;
    try {
      const { Database } = await import(/* @vite-ignore */ "bun:sqlite");
      db = new Database(dbPath, { readonly: true });
    } catch (err) {
      console.warn("[CodexReader] failed to open state DB:", err);
      return [];
    }

    let rows: CodexThreadRow[];
    try {
      rows = db.query("SELECT * FROM threads WHERE rollout_path IS NOT NULL AND rollout_path != ''").all() as CodexThreadRow[];
    } catch (err) {
      console.warn("[CodexReader] failed to read threads table:", err);
      db.close();
      return [];
    }

    db.close();

    const sessions: CodexSession[] = [];
    for (const row of rows) {
      if (!row.id || !row.rollout_path) continue;
      const session = await this.sessionFromThreadRow(row);
      if (session) sessions.push(session);
    }

    return sessions.sort(
      (a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
  }

  async getMessageById(
    sessionId: string,
    messageId: string,
    before = 0,
    after = 0
  ): Promise<CodexMessageWindow | null> {
    const sessions = await this.getSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;

    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;

    return {
      message: session.messages[idx],
      before: session.messages.slice(Math.max(0, idx - before), idx),
      after: session.messages.slice(idx + 1, idx + 1 + after),
      session,
    };
  }

  private async findStateDbPath(): Promise<string | null> {
    const base = this.codexHome ?? getDefaultCodexHome();
    let entries: string[];
    try {
      entries = await _readdir(base);
    } catch {
      return null;
    }

    const stateDbs = entries
      .map((name) => {
        const match = name.match(/^state_(\d+)\.sqlite$/);
        return match ? { name, version: Number(match[1]) } : null;
      })
      .filter((entry): entry is { name: string; version: number } => entry !== null)
      .sort((a, b) => b.version - a.version);

    if (stateDbs.length > 0) return _join(base, stateDbs[0].name);
    if (entries.includes("state.sqlite")) return _join(base, "state.sqlite");
    return null;
  }

  private async sessionFromThreadRow(row: CodexThreadRow): Promise<CodexSession | null> {
    const rolloutPath = row.rollout_path;
    if (!rolloutPath) return null;

    const messages = await this.readMessages(row.id, rolloutPath);
    if (messages.length === 0) return null;

    const first = messages[0];
    const last = messages[messages.length - 1];
    const title = row.title?.trim()
      || row.first_user_message?.trim()
      || titleFromCwd(row.cwd ?? "");

    return {
      id: row.id,
      title,
      cwd: row.cwd ?? "",
      source: row.source ?? undefined,
      threadSource: row.thread_source ?? undefined,
      agentNickname: row.agent_nickname ?? undefined,
      agentRole: row.agent_role ?? undefined,
      agentPath: row.agent_path ?? undefined,
      rolloutPath,
      firstMessageAt: first.timestamp || timestampFromMs(row.created_at_ms) || timestampFromMs(row.created_at) || new Date(0).toISOString(),
      lastMessageAt: last.timestamp || timestampFromMs(row.updated_at_ms) || timestampFromMs(row.updated_at) || new Date(0).toISOString(),
      messages,
    };
  }

  private async readMessages(sessionId: string, rolloutPath: string): Promise<CodexMessage[]> {
    let text: string;
    try {
      text = await _readFile(rolloutPath, "utf-8");
    } catch (err) {
      console.warn(`[CodexReader] skipping missing rollout ${_basename(rolloutPath)}:`, err);
      return [];
    }

    return parseCodexRolloutMessages(text, sessionId);
  }
}
