import type {
  ICursorReader,
  CursorSession,
  CursorMessage,
  CursorComposerMeta,
  CursorBubbleRaw,
  CursorBubbleHeader,
} from "./types.js";

const isBrowser = typeof document !== "undefined";

let _join: typeof import("path").join;
let _readFile: typeof import("fs/promises").readFile;
let _readdir: typeof import("fs/promises").readdir;
let _nodeModulesLoaded = false;

async function ensureNodeModules(): Promise<boolean> {
  if (isBrowser) return false;
  if (_nodeModulesLoaded) return true;

  const PATH_MODULE = "path";
  const FS_MODULE = "fs/promises";

  const pathMod = await import(/* @vite-ignore */ PATH_MODULE);
  const fsMod = await import(/* @vite-ignore */ FS_MODULE);

  _join = pathMod.join;
  _readFile = fsMod.readFile;
  _readdir = fsMod.readdir;
  _nodeModulesLoaded = true;
  return true;
}

function getPlatformBasePath(): string {
  if (!_join) return "";
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const platform = process.platform;

  if (platform === "darwin") {
    return _join(home, "Library", "Application Support", "Cursor", "User");
  }
  if (platform === "win32") {
    return _join(process.env.APPDATA || home, "Cursor", "User");
  }
  return _join(home, ".config", "Cursor", "User");
}

function titleFromPath(workspacePath: string): string {
  if (!workspacePath) return "Unknown";
  const parts = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? workspacePath;
}

export class CursorReader implements ICursorReader {
  private readonly basePath?: string;

  constructor(basePath?: string) {
    this.basePath = basePath;
  }

  async isAvailable(): Promise<boolean> {
    if (!(await ensureNodeModules())) return false;
    const base = this.basePath ?? getPlatformBasePath();
    const globalDb = _join(base, "globalStorage", "state.vscdb");
    try {
      await _readFile(globalDb);
      return true;
    } catch {
      return false;
    }
  }

  async getSessions(): Promise<CursorSession[]> {
    if (!(await ensureNodeModules())) return [];

    const base = this.basePath ?? getPlatformBasePath();
    const globalDbPath = _join(base, "globalStorage", "state.vscdb");
    const workspaceStoragePath = _join(base, "workspaceStorage");

    let globalDb: import("bun:sqlite").Database;
    try {
      const { Database } = await import(/* @vite-ignore */ "bun:sqlite");
      globalDb = new Database(globalDbPath, { readonly: true });
    } catch (err) {
      console.warn("[CursorReader] failed to open global DB:", err);
      return [];
    }

    const hashToFolder = await this.buildHashToFolderMap(workspaceStoragePath);
    const sessions: CursorSession[] = [];

    for (const [hash, workspacePath] of hashToFolder.entries()) {
      const workspaceDbPath = _join(workspaceStoragePath, hash, "state.vscdb");
      let workspaceDb: import("bun:sqlite").Database | null = null;

      try {
        const { Database } = await import(/* @vite-ignore */ "bun:sqlite");
        workspaceDb = new Database(workspaceDbPath, { readonly: true });

        const row = workspaceDb
          .query(`SELECT value FROM ItemTable WHERE key = 'composer.composerData'`)
          .get() as { value: string } | null;

        if (!row) continue;

        const composerData = JSON.parse(row.value) as { allComposers?: CursorComposerMeta[] };
        const allComposers: CursorComposerMeta[] = composerData.allComposers ?? [];

        for (const meta of allComposers) {
          if (meta.lastUpdatedAt == null) continue;
          if (meta.isDraft === true) continue;

          const composerId = meta.composerId;

          const headerRow = globalDb
            .query(`SELECT value FROM cursorDiskKV WHERE key = ?`)
            .get(`composerData:${composerId}`) as { value: string } | null;

          if (!headerRow) continue;

          const composerGlobal = JSON.parse(headerRow.value) as {
            fullConversationHeadersOnly?: CursorBubbleHeader[];
          };
          const headers: CursorBubbleHeader[] = composerGlobal.fullConversationHeadersOnly ?? [];
          if (headers.length === 0) continue;

          const messages: CursorMessage[] = [];

          for (const header of headers) {
            const bubbleKey = `bubbleId:${composerId}:${header.bubbleId}`;
            const bubbleRow = globalDb
              .query(`SELECT value FROM cursorDiskKV WHERE key = ?`)
              .get(bubbleKey) as { value: string } | null;

            if (!bubbleRow) continue;

            const bubble = JSON.parse(bubbleRow.value) as CursorBubbleRaw;
            if (!bubble.text || bubble.text.trim() === "") continue;

            messages.push({
              id: bubble.bubbleId,
              type: bubble.type,
              text: bubble.text,
              timestamp: bubble.createdAt,
            });
          }

          if (messages.length === 0) continue;

          messages.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          const lastMsg = messages[messages.length - 1];
          const sessionName = meta.name?.trim()
            ? meta.name.trim()
            : `${meta.unifiedMode ?? "chat"} — ${titleFromPath(workspacePath)}`;

          sessions.push({
            id: composerId,
            name: sessionName,
            workspacePath,
            unifiedMode: meta.unifiedMode ?? "chat",
            createdAt: new Date(meta.createdAt).toISOString(),
            lastMessageAt: lastMsg.timestamp,
            messages,
          });
        }
      } catch (err) {
        console.warn(`[CursorReader] skipping workspace ${hash.slice(0, 8)}:`, err);
      } finally {
        workspaceDb?.close();
      }
    }

    globalDb.close();

    return sessions.sort(
      (a, b) => new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
  }

  private async buildHashToFolderMap(workspaceStoragePath: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    let hashes: string[];
    try {
      hashes = await _readdir(workspaceStoragePath);
    } catch {
      return map;
    }

    for (const hash of hashes) {
      if (hash.startsWith(".")) continue;
      const wsJsonPath = _join(workspaceStoragePath, hash, "workspace.json");
      try {
        const text = await _readFile(wsJsonPath, "utf-8");
        const wsData = JSON.parse(text) as { folder?: string };
        if (wsData.folder) {
          const folderPath = wsData.folder.replace(/^file:\/\//, "");
          map.set(hash, folderPath);
        }
      } catch {
      }
    }

    return map;
  }
}
