import type {
  IOpenCodeReader,
  OpenCodeSession,
  OpenCodeSessionRaw,
  OpenCodeMessage,
  OpenCodeMessageRaw,
  OpenCodePartRaw,
  OpenCodeAgent,
} from "./types.js";
import { BUILTIN_AGENTS } from "./types.js";

// OpenTUI polyfills window but not document - check document for real browser
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

function getDefaultStoragePath(): string {
  if (!_join) return "";
  return _join(
    process.env.HOME || "~",
    ".local",
    "share",
    "opencode",
    "storage"
  );
}

export class JsonReader implements IOpenCodeReader {
  private storagePath: string | null = null;
  private readonly configuredPath?: string;

  constructor(storagePath?: string) {
    this.configuredPath = storagePath;
  }

  private async init(): Promise<boolean> {
    if (!(await ensureNodeModules())) return false;
    if (!this.storagePath) {
      this.storagePath = this.configuredPath || getDefaultStoragePath();
    }
    return true;
  }

  async getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]> {
    if (!(await this.init())) return [];
    
    const sinceMs = since.getTime();
    const sessions: OpenCodeSession[] = [];
    const sessionDir = _join(this.storagePath!, "session");

    let projectDirs: string[];
    try {
      projectDirs = await _readdir(sessionDir);
    } catch {
      return [];
    }

    for (const projectHash of projectDirs) {
      if (projectHash.startsWith(".")) continue;

      const projectPath = _join(sessionDir, projectHash);
      let sessionFiles: string[];
      try {
        sessionFiles = await _readdir(projectPath);
      } catch {
        continue;
      }

      for (const fileName of sessionFiles) {
        if (!fileName.endsWith(".json")) continue;

        const filePath = _join(projectPath, fileName);
        const raw = await this.readJsonFile<OpenCodeSessionRaw>(filePath);
        if (!raw) continue;

        if (raw.time.updated > sinceMs) {
          sessions.push({
            id: raw.id,
            title: raw.title,
            directory: raw.directory,
            projectId: raw.projectID,
            parentId: raw.parentID,
            time: {
              created: raw.time.created,
              updated: raw.time.updated,
            },
          });
        }
      }
    }

    return sessions.sort((a, b) => b.time.updated - a.time.updated);
  }

  async getMessagesForSession(
    sessionId: string,
    since?: Date
  ): Promise<OpenCodeMessage[]> {
    if (!(await this.init())) return [];
    
    const sinceMs = since?.getTime() ?? 0;
    const messages: OpenCodeMessage[] = [];
    const messageDir = _join(this.storagePath!, "message", sessionId);

    let messageFiles: string[];
    try {
      messageFiles = await _readdir(messageDir);
    } catch {
      return [];
    }

    for (const fileName of messageFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = _join(messageDir, fileName);
      const raw = await this.readJsonFile<OpenCodeMessageRaw>(filePath);
      if (!raw) continue;

      if (raw.time.created <= sinceMs) continue;

      const content = await this.getMessageContent(raw.id);
      if (!content) continue;

      messages.push({
        id: raw.id,
        sessionId: raw.sessionID,
        role: raw.role,
        agent: (raw.agent || "build").toLowerCase(),
        content,
        timestamp: new Date(raw.time.created).toISOString(),
      });
    }

    return messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async getAgentInfo(agentName: string): Promise<OpenCodeAgent | null> {
    const normalized = agentName.toLowerCase();
    if (BUILTIN_AGENTS[normalized]) {
      return BUILTIN_AGENTS[normalized];
    }
    return {
      name: agentName,
      description: "OpenCode coding agent",
    };
  }

  async getAllUniqueAgents(sessionId: string): Promise<string[]> {
    const messages = await this.getMessagesForSession(sessionId);
    const agents = new Set<string>();
    for (const msg of messages) {
      agents.add(msg.agent);
    }
    return Array.from(agents);
  }

  async getFirstAgent(sessionId: string): Promise<string | null> {
    if (!(await this.init())) return null;
    
    const messageDir = _join(this.storagePath!, "message", sessionId);

    let messageFiles: string[];
    try {
      messageFiles = await _readdir(messageDir);
    } catch {
      return null;
    }

    let earliest: { agent: string; created: number } | null = null;

    for (const fileName of messageFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = _join(messageDir, fileName);
      const raw = await this.readJsonFile<OpenCodeMessageRaw>(filePath);
      if (!raw) continue;

      if (!earliest || raw.time.created < earliest.created) {
        earliest = { agent: (raw.agent || "build").toLowerCase(), created: raw.time.created };
      }
    }

    return earliest?.agent ?? null;
  }

  private async getMessageContent(messageId: string): Promise<string | null> {
    const partDir = _join(this.storagePath!, "part", messageId);

    let partFiles: string[];
    try {
      partFiles = await _readdir(partDir);
    } catch {
      return null;
    }

    const textParts: { text: string; time?: number }[] = [];

    for (const fileName of partFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = _join(partDir, fileName);
      const raw = await this.readJsonFile<OpenCodePartRaw>(filePath);
      if (!raw) continue;

      if (raw.type !== "text") continue;
      if (raw.synthetic === true) continue;
      if (!raw.text) continue;

      textParts.push({
        text: raw.text,
        time: raw.time?.start,
      });
    }

    if (textParts.length === 0) return null;

    textParts.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    return textParts.map((p) => p.text).join("\n\n");
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const text = await _readFile(filePath, "utf-8");
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
