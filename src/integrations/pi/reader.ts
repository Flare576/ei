import type {
  IPiReader,
  PiSession,
  PiMessage,
  PiMessageWindow,
  PiMessageEntry,
  PiGenericEntry,
  PiContentBlock,
} from "./types.js";

const isBrowser = typeof document !== "undefined";

let _join: typeof import("path").join;
let _readdir: typeof import("fs/promises").readdir;
let _readFile: typeof import("fs/promises").readFile;
let _existsSync: typeof import("fs").existsSync;
let _nodeModulesLoaded = false;

async function ensureNodeModules(): Promise<boolean> {
  if (isBrowser) return false;
  if (_nodeModulesLoaded) return true;

  const PATH_MODULE = "path";
  const FS_MODULE = "fs/promises";
  const FS_SYNC_MODULE = "fs";

  const pathMod = await import(/* @vite-ignore */ PATH_MODULE);
  const fsMod = await import(/* @vite-ignore */ FS_MODULE);
  const fsSyncMod = await import(/* @vite-ignore */ FS_SYNC_MODULE);

  _join = pathMod.join;
  _readdir = fsMod.readdir;
  _readFile = fsMod.readFile;
  _existsSync = fsSyncMod.existsSync;
  _nodeModulesLoaded = true;
  return true;
}

/**
 * Pi encodes the cwd into the session directory name by replacing every "/"
 * with "--". The root "/" becomes an empty leading segment, so paths end up
 * looking like "--Users--flare576--Projects--Personal--ei--".
 * This reverses that encoding.
 */
function decodeCwd(dirName: string): string {
  return dirName.replace(/--/g, "/") || "/";
}

function titleFromCwd(cwd: string): string {
  if (!cwd) return "Unknown";
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/**
 * Extracts the session UUID from a Pi session filename.
 * Filename format: "2026-05-20T14-57-03-205Z_019e45e3-e2e5-7174-8165-da221c147ebb.jsonl"
 */
function uuidFromFilename(filename: string): string | null {
  const base = filename.replace(/\.jsonl$/, "");
  const underscoreIdx = base.indexOf("_");
  if (underscoreIdx === -1) return null;
  return base.slice(underscoreIdx + 1);
}

function extractAssistantText(content: PiContentBlock[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function isPiMessageEntry(entry: PiGenericEntry): entry is PiMessageEntry {
  return entry.type === "message" && typeof entry.message === "object" && entry.message !== null;
}

export class PiReader implements IPiReader {
  private readonly sessionsRoots: string[];

  constructor(sessionsRoots?: string[]) {
    this.sessionsRoots = sessionsRoots ?? [];
  }

  async isAvailable(): Promise<boolean> {
    if (!(await ensureNodeModules())) return false;
    const roots = this.sessionsRoots.length > 0 ? this.sessionsRoots : getDefaultSessionsRoots();
    return roots.some((r) => _existsSync(r));
  }

  async getSessions(): Promise<PiSession[]> {
    if (!(await ensureNodeModules())) return [];

    const roots = this.sessionsRoots.length > 0 ? this.sessionsRoots : getDefaultSessionsRoots();
    const sessions: PiSession[] = [];

    for (const root of roots) {
      if (!_existsSync(root)) continue;

      let cwdDirs: string[];
      try {
        cwdDirs = await _readdir(root);
      } catch {
        continue;
      }

      for (const cwdDir of cwdDirs) {
        if (cwdDir.startsWith(".")) continue;
        const cwdPath = _join(root, cwdDir);
        const cwd = decodeCwd(cwdDir);

        let sessionFiles: string[];
        try {
          sessionFiles = await _readdir(cwdPath);
        } catch {
          continue;
        }

        for (const filename of sessionFiles) {
          if (!filename.endsWith(".jsonl")) continue;

          const uuid = uuidFromFilename(filename);
          if (!uuid) continue;

          const filePath = _join(cwdPath, filename);
          const session = await this.parseSession(uuid, cwd, filePath);
          if (session) sessions.push(session);
        }
      }
    }

    return sessions.sort(
      (a, b) => new Date(a.firstMessageAt).getTime() - new Date(b.firstMessageAt).getTime()
    );
  }

  async getMessageById(
    sessionId: string,
    messageId: string,
    before = 0,
    after = 0
  ): Promise<PiMessageWindow | null> {
    if (!(await ensureNodeModules())) return null;

    const allSessions = await this.getSessions();
    const session = allSessions.find((s) => s.id === sessionId);
    if (!session) return null;

    const msgs = session.messages;
    const idx = msgs.findIndex((m) => m.id === messageId || m.id.endsWith(`/${messageId}`));
    if (idx === -1) return null;

    return {
      message: msgs[idx],
      before: msgs.slice(Math.max(0, idx - before), idx),
      after: msgs.slice(idx + 1, idx + 1 + after),
      session,
    };
  }

  private async parseSession(
    uuid: string,
    cwd: string,
    filePath: string
  ): Promise<PiSession | null> {
    const entries = await this.readJsonl(filePath);
    const messages: PiMessage[] = [];
    let firstTs: string | null = null;
    let lastTs: string | null = null;

    for (const entry of entries) {
      if (!isPiMessageEntry(entry)) continue;

      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;

      let content = "";
      if (role === "user") {
        content = typeof entry.message.content === "string"
          ? entry.message.content.trim()
          : extractAssistantText(entry.message.content);
      } else {
        content = extractAssistantText(entry.message.content);
      }

      if (!content) continue;

      const ts = entry.timestamp;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }

      messages.push({
        id: `${uuid}/${entry.id}`,
        sessionId: uuid,
        role,
        content,
        timestamp: ts ?? new Date(0).toISOString(),
      });
    }

    if (!firstTs || !lastTs || messages.length === 0) return null;

    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
      id: uuid,
      title: titleFromCwd(cwd),
      cwd,
      firstMessageAt: firstTs,
      lastMessageAt: lastTs,
      messages,
    };
  }

  private async readJsonl(filePath: string): Promise<PiGenericEntry[]> {
    let text: string;
    try {
      text = await _readFile(filePath, "utf-8");
    } catch {
      return [];
    }

    const entries: PiGenericEntry[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as PiGenericEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  }
}

function getDefaultSessionsRoots(): string[] {
  const home = process.env.HOME ?? "~";
  return [
    _join(home, ".pi", "agent", "sessions"),
    _join(home, ".omp", "agent", "sessions"),
  ];
}
