import type { CodexMessage } from "../integrations/codex/types.js";
import type { ICodexReader } from "../integrations/codex/types.js";
import type { ICursorReader } from "../integrations/cursor/types.js";
import type { IOpenCodeReader } from "../integrations/opencode/types.js";
import { sanitizeMessageIdForLog } from "../core/utils/message-refusal.js";

export type SessionContextFailureKind =
  | "transcript-unreadable"
  | "reader-unavailable"
  | "reader-retrieval-failed"
  | "record-unprocessable";

export interface SessionContextFailure {
  kind: SessionContextFailureKind;
  hookSource?: string;
  message: string;
}

export interface SessionContextResult {
  messages: string[];
  failure: SessionContextFailure | null;
}

export async function getRecentSessionMessages(
  sessionId: string | undefined,
  hookSource: string | undefined,
  transcriptPath: string | undefined
): Promise<SessionContextResult> {
  if (transcriptPath) {
    let text: string;
    try {
      text = await Bun.file(transcriptPath).text();
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "transcript-unreadable",
          message: `Could not read transcript at ${sanitizeMessageIdForLog(transcriptPath)}: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }

    let parseCodexRolloutMessages: (text: string, sessionId: string) => CodexMessage[];
    try {
      // Dynamic import: readers touch Node-only modules (fs, bun:sqlite) that
      // must not load eagerly when this file is bundled for non-Node targets.
      ({ parseCodexRolloutMessages } = await import(
        /* @vite-ignore */ "../integrations/codex/reader.js"
      ));
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-unavailable",
          hookSource: "codex",
          message: `Could not load codex transcript parser: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }

    try {
      const codexMessages = parseCodexRolloutMessages(text, sessionId ?? "transcript");
      if (codexMessages.length > 0) {
        return {
          messages: codexMessages.slice(-5).map((m) => `${m.role}: ${m.content}`),
          failure: null,
        };
      }

      const messages: Array<{ content: string }> = [];

      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (record.type === "user") {
          const msgContent = (record.message as Record<string, unknown>)?.content;
          if (typeof msgContent === "string" && msgContent.trim()) {
            messages.push({ content: msgContent.trim() });
          }
        } else if (record.type === "assistant") {
          const msgContent = (record.message as Record<string, unknown>)?.content;
          if (Array.isArray(msgContent)) {
            const extracted = (msgContent as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string)
              .join("\n\n")
              .trim();
            if (extracted) {
              messages.push({ content: extracted });
            }
          }
        }
      }

      return { messages: messages.slice(-5).map((m) => m.content), failure: null };
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "record-unprocessable",
          message: `Could not parse transcript records at ${sanitizeMessageIdForLog(transcriptPath)}: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }
  }

  if (!sessionId || !hookSource) return { messages: [], failure: null };

  if (hookSource === "opencode-plugin") {
    let reader: IOpenCodeReader;
    try {
      // Dynamic import: readers touch Node-only modules (fs, bun:sqlite) that
      // must not load eagerly when this file is bundled for non-Node targets.
      const { createOpenCodeReader } = await import(
        /* @vite-ignore */ "../integrations/opencode/reader-factory.js"
      );
      reader = await createOpenCodeReader();
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-unavailable",
          hookSource,
          message: `Could not load opencode-plugin reader: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }

    try {
      const messages = await reader.getMessagesForSession(sessionId);
      return {
        messages: messages.slice(-5).map((m) => `${m.role}: ${m.content}`),
        failure: null,
      };
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-retrieval-failed",
          hookSource,
          message: `Could not retrieve opencode-plugin session messages: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }
  }

  if (hookSource === "cursor") {
    let reader: ICursorReader;
    try {
      // Dynamic import: readers touch Node-only modules (fs, bun:sqlite) that
      // must not load eagerly when this file is bundled for non-Node targets.
      const { CursorReader } = await import(
        /* @vite-ignore */ "../integrations/cursor/reader.js"
      );
      reader = new CursorReader();
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-unavailable",
          hookSource,
          message: `Could not load cursor reader: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }

    try {
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return {
          messages: session.messages.slice(-5).map((m) => `${m.type === 1 ? "user" : "assistant"}: ${m.text}`),
          failure: null,
        };
      }
      return { messages: [], failure: null };
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-retrieval-failed",
          hookSource,
          message: `Could not retrieve cursor session messages: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }
  }

  if (hookSource === "codex") {
    let reader: ICodexReader;
    try {
      // Dynamic import: readers touch Node-only modules (fs, bun:sqlite) that
      // must not load eagerly when this file is bundled for non-Node targets.
      const { CodexReader } = await import(
        /* @vite-ignore */ "../integrations/codex/reader.js"
      );
      reader = new CodexReader();
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-unavailable",
          hookSource,
          message: `Could not load codex reader: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }

    try {
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return {
          messages: session.messages.slice(-5).map((m) => `${m.role}: ${m.content}`),
          failure: null,
        };
      }
      return { messages: [], failure: null };
    } catch (err) {
      return {
        messages: [],
        failure: {
          kind: "reader-retrieval-failed",
          hookSource,
          message: `Could not retrieve codex session messages: ${sanitizeMessageIdForLog(err instanceof Error ? err.message : String(err))}`,
        },
      };
    }
  }

  return { messages: [], failure: null };
}
