export async function getRecentSessionMessages(
  sessionId: string | undefined,
  hookSource: string | undefined,
  transcriptPath: string | undefined
): Promise<string[]> {
  if (transcriptPath) {
    try {
      const text = await Bun.file(transcriptPath).text();

      const { parseCodexRolloutMessages } = await import(
        /* @vite-ignore */ "./integrations/codex/reader.js"
      );
      const codexMessages = parseCodexRolloutMessages(text, sessionId ?? "transcript");
      if (codexMessages.length > 0) {
        return codexMessages.slice(-5).map((m) => `${m.role}: ${m.content}`);
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

      return messages.slice(-5).map((m) => m.content);
    } catch {
      return [];
    }
  }

  if (!sessionId || !hookSource) return [];

  try {
    if (hookSource === "opencode-plugin") {
      const { createOpenCodeReader } = await import(
        /* @vite-ignore */ "./integrations/opencode/reader-factory.js"
      );
      const reader = await createOpenCodeReader();
      const messages = await reader.getMessagesForSession(sessionId);
      return messages.slice(-5).map((m) => `${m.role}: ${m.content}`);
    }

    if (hookSource === "cursor") {
      const { CursorReader } = await import(
        /* @vite-ignore */ "./integrations/cursor/reader.js"
      );
      const reader = new CursorReader();
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return session.messages.slice(-5).map((m) => `${m.type === 1 ? "user" : "assistant"}: ${m.text}`);
      }
    }

    if (hookSource === "codex") {
      const { CodexReader } = await import(
        /* @vite-ignore */ "./integrations/codex/reader.js"
      );
      const reader = new CodexReader();
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return session.messages.slice(-5).map((m) => `${m.role}: ${m.content}`);
      }
    }
  } catch {
    return [];
  }

  return [];
}
