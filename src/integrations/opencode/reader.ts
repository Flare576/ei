import { join } from "path";
import { readdir, readFile } from "fs/promises";
import type {
  OpenCodeSession,
  OpenCodeSessionRaw,
  OpenCodeMessage,
  OpenCodeMessageRaw,
  OpenCodePartRaw,
  OpenCodeAgent,
} from "./types.js";
import { BUILTIN_AGENTS } from "./types.js";

const DEFAULT_STORAGE_PATH = join(
  process.env.HOME || "~",
  ".local",
  "share",
  "opencode",
  "storage"
);

export class OpenCodeReader {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath =
      storagePath || process.env.EI_OPENCODE_STORAGE_PATH || DEFAULT_STORAGE_PATH;
  }

  async getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]> {
    const sinceMs = since.getTime();
    const sessions: OpenCodeSession[] = [];
    const sessionDir = join(this.storagePath, "session");

    let projectDirs: string[];
    try {
      projectDirs = await readdir(sessionDir);
    } catch {
      return [];
    }

    for (const projectHash of projectDirs) {
      if (projectHash.startsWith(".")) continue;

      const projectPath = join(sessionDir, projectHash);
      let sessionFiles: string[];
      try {
        sessionFiles = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const fileName of sessionFiles) {
        if (!fileName.endsWith(".json")) continue;

        const filePath = join(projectPath, fileName);
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
    const sinceMs = since?.getTime() ?? 0;
    const messages: OpenCodeMessage[] = [];
    const messageDir = join(this.storagePath, "message", sessionId);

    let messageFiles: string[];
    try {
      messageFiles = await readdir(messageDir);
    } catch {
      return [];
    }

    for (const fileName of messageFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = join(messageDir, fileName);
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
    const messageDir = join(this.storagePath, "message", sessionId);

    let messageFiles: string[];
    try {
      messageFiles = await readdir(messageDir);
    } catch {
      return null;
    }

    let earliest: { agent: string; created: number } | null = null;

    for (const fileName of messageFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = join(messageDir, fileName);
      const raw = await this.readJsonFile<OpenCodeMessageRaw>(filePath);
      if (!raw) continue;

      if (!earliest || raw.time.created < earliest.created) {
        earliest = { agent: (raw.agent || "build").toLowerCase(), created: raw.time.created };
      }
    }

    return earliest?.agent ?? null;
  }

  private async getMessageContent(messageId: string): Promise<string | null> {
    const partDir = join(this.storagePath, "part", messageId);

    let partFiles: string[];
    try {
      partFiles = await readdir(partDir);
    } catch {
      return null;
    }

    const textParts: { text: string; time?: number }[] = [];

    for (const fileName of partFiles) {
      if (!fileName.endsWith(".json")) continue;

      const filePath = join(partDir, fileName);
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
      const text = await readFile(filePath, "utf-8");
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
