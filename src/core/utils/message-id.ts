/**
 * Fully-qualified message ID format:
 *   ei:${uuid}
 *   opencode:${machine}:${session}:${nativeId}
 *   claudecode:${machine}:${session}:${nativeId}
 *   cursor:${machine}:${session}:${nativeId}
 *   codex:${machine}:${session}:${nativeId}
 *   import:document:${slug}:${uuid}
 *   slack:${workspace}:${channel}:${ts}
 */

export type MessageIdIntegration =
  | "ei"
  | "opencode"
  | "claudecode"
  | "cursor"
  | "codex"
  | "pi"
  | "import"
  | "slack"
  | "unknown"

export interface ParsedMessageId {
  integration: MessageIdIntegration
  machine?: string
  session?: string
  nativeId: string
  raw: string
}

export function parseMessageId(id: string): ParsedMessageId {
  if (!id || typeof id !== "string") {
    const raw = String(id ?? "")
    return { integration: "unknown", nativeId: raw, raw }
  }

  const parts = id.split(":")

  if (parts[0] === "ei" && parts.length === 2) {
    return { integration: "ei", nativeId: parts[1], raw: id }
  }

  if (parts[0] === "opencode" && parts.length >= 4) {
    return {
      integration: "opencode",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "claudecode" && parts.length >= 4) {
    return {
      integration: "claudecode",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "cursor" && parts.length >= 4) {
    return {
      integration: "cursor",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "codex" && parts.length >= 4) {
    return {
      integration: "codex",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "pi" && parts.length >= 4) {
    return {
      integration: "pi",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "import" && parts[1] === "document" && parts.length >= 4) {
    return {
      integration: "import",
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  if (parts[0] === "slack" && parts.length >= 4) {
    return {
      integration: "slack",
      machine: parts[1],
      session: parts[2],
      nativeId: parts.slice(3).join(":"),
      raw: id,
    }
  }

  return { integration: "unknown", nativeId: id, raw: id }
}

export function isQualifiedMessageId(id: string): boolean {
  return id.includes(":")
}

export function qualifyEiMessage(uuid: string): string {
  return `ei:${uuid}`
}

export function qualifyOpenCodeMessage(machine: string, sessionId: string, nativeId: string): string {
  return `opencode:${machine}:${sessionId}:${nativeId}`
}

export function qualifyClaudeCodeMessage(machine: string, sessionId: string, nativeId: string): string {
  return `claudecode:${machine}:${sessionId}:${nativeId}`
}

export function qualifyCursorMessage(machine: string, sessionId: string, nativeId: string): string {
  return `cursor:${machine}:${sessionId}:${nativeId}`
}

export function qualifyCodexMessage(machine: string, sessionId: string, nativeId: string): string {
  return `codex:${machine}:${sessionId}:${nativeId}`
}

export function qualifyPiMessage(machine: string, sessionId: string, nativeId: string): string {
  return `pi:${machine}:${sessionId}:${nativeId}`
}

export function qualifyDocumentMessage(slug: string, uuid: string): string {
  return `import:document:${slug}:${uuid}`
}

export function qualifySlackMessage(workspaceId: string, channelId: string, ts: string): string {
  return `slack:${workspaceId}:${channelId}:${ts}`
}
