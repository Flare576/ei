import { Database } from "bun:sqlite";
import type {
  IOpenCodeReader,
  OpenCodeSession,
  OpenCodeMessage,
  OpenCodeAgent,
} from "./types.js";
import { BUILTIN_AGENTS } from "./types.js";

export class SqliteReader implements IOpenCodeReader {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
  }

  async getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]> {
    const sinceMs = since.getTime();
    const rows = this.db
      .query(
        `
      SELECT id, title, directory, project_id, parent_id, time_created, time_updated
      FROM session
      WHERE time_updated > ?1 AND parent_id IS NULL
      ORDER BY time_updated DESC
    `
      )
      .all(sinceMs) as Array<{
      id: string;
      title: string;
      directory: string;
      project_id: string;
      parent_id: string | null;
      time_created: number;
      time_updated: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      directory: row.directory,
      projectId: row.project_id,
      parentId: row.parent_id ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }));
  }

  async getMessagesForSession(
    sessionId: string,
    since?: Date
  ): Promise<OpenCodeMessage[]> {
    const sinceMs = since?.getTime() ?? 0;

    const messages = this.db
      .query(
        `
      SELECT id, session_id, time_created, data
      FROM message
      WHERE session_id = ?1 AND time_created > ?2
      ORDER BY time_created ASC
    `
      )
      .all(sessionId, sinceMs) as Array<{
      id: string;
      session_id: string;
      time_created: number;
      data: string;
    }>;

    const result: OpenCodeMessage[] = [];

    for (const msg of messages) {
      const msgData = JSON.parse(msg.data) as { role: "user" | "assistant"; agent?: string };
      const content = this.getMessageContent(msg.id);
      if (!content) continue;

      result.push({
        id: msg.id,
        sessionId: msg.session_id,
        role: msgData.role,
        agent: (msgData.agent || "build").toLowerCase(),
        content,
        timestamp: new Date(msg.time_created).toISOString(),
      });
    }

    return result;
  }

  private getMessageContent(messageId: string): string | null {
    const parts = this.db
      .query(
        `
      SELECT data, time_created FROM part 
      WHERE message_id = ?1 
      ORDER BY time_created ASC
    `
      )
      .all(messageId) as Array<{ data: string; time_created: number }>;

    const textParts: string[] = [];

    for (const part of parts) {
      const partData = JSON.parse(part.data) as {
        type: string;
        synthetic?: boolean;
        text?: string;
      };
      if (partData.type !== "text") continue;
      if (partData.synthetic === true) continue;
      if (!partData.text) continue;
      textParts.push(partData.text);
    }

    return textParts.length > 0 ? textParts.join("\n\n") : null;
  }

  async getAgentInfo(agentName: string): Promise<OpenCodeAgent | null> {
    const normalized = agentName.toLowerCase();
    if (BUILTIN_AGENTS[normalized]) {
      return BUILTIN_AGENTS[normalized];
    }
    return { name: agentName, description: "OpenCode coding agent" };
  }

  async getAllUniqueAgents(sessionId: string): Promise<string[]> {
    const messages = await this.getMessagesForSession(sessionId);
    return [...new Set(messages.map((m) => m.agent))];
  }

  async getFirstAgent(sessionId: string): Promise<string | null> {
    const row = this.db
      .query(
        `
      SELECT data FROM message 
      WHERE session_id = ?1 
      ORDER BY time_created ASC 
      LIMIT 1
    `
      )
      .get(sessionId) as { data: string } | null;

    if (!row) return null;
    const msgData = JSON.parse(row.data) as { agent?: string };
    return (msgData.agent || "build").toLowerCase();
  }

  close(): void {
    this.db.close();
  }
}
