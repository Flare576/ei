import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Topic, Message, ContextStatus, PersonaEntity } from "../../core/types.js";
import type { IClaudeCodeReader, ClaudeCodeSession, ClaudeCodeMessage } from "./types.js";
import {
  CLAUDE_CODE_PERSONA_NAME,
  CLAUDE_CODE_TOPIC_GROUPS,
  MIN_SESSION_AGE_MS,
} from "./types.js";
import { ClaudeCodeReader } from "./reader.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";

// =============================================================================
// Export Types
// =============================================================================

export interface ClaudeCodeImportResult {
  sessionsProcessed: number;
  topicsCreated: number;
  topicsUpdated: number;
  messagesImported: number;
  personaCreated: boolean;
  extractionScansQueued: number;
}

export interface ClaudeCodeImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IClaudeCodeReader;
}

// =============================================================================
// Utility Functions
// =============================================================================

const TWELVE_HOURS_MS = 43_200_000;
const CLAUDE_CODE_GROUP = "Claude Code";

function convertToEiMessage(msg: ClaudeCodeMessage): Message {
  return {
    id: msg.id,
    role: msg.role === "user" ? "human" : "system",
    verbal_response: msg.content,
    timestamp: msg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
  };
}

function convertToPreMarkedEiMessage(msg: ClaudeCodeMessage): Message {
  return {
    ...convertToEiMessage(msg),
    f: true,
    r: true,
    p: true,
    o: true,
  };
}

/**
 * Ensure the single "Claude Code" persona exists.
 * All sessions share one persona — it's a coding assistant, not a multi-agent system.
 */
function ensureClaudeCodePersona(
  stateManager: StateManager,
  eiInterface?: Ei_Interface
): PersonaEntity {
  const existing = stateManager.persona_getByName(CLAUDE_CODE_PERSONA_NAME);
  if (existing) return existing;

  const now = new Date().toISOString();
  const persona: PersonaEntity = {
    id: crypto.randomUUID(),
    display_name: CLAUDE_CODE_PERSONA_NAME,
    entity: "system",
    aliases: ["claude-code", "claude code"],
    short_description: "Claude Code — Anthropic's AI coding assistant",
    long_description:
      "Claude Code is an agentic coding assistant that helps with coding tasks, debugging, architecture decisions, and more.",
    group_primary: CLAUDE_CODE_GROUP,
    groups_visible: [CLAUDE_CODE_GROUP],
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    heartbeat_delay_ms: TWELVE_HOURS_MS,
    last_heartbeat: now,
    last_updated: now,
    last_activity: now,
  };

  stateManager.persona_add(persona);
  eiInterface?.onPersonaAdded?.();
  return persona;
}

// =============================================================================
// Topic Management
// =============================================================================

function ensureSessionTopic(
  session: ClaudeCodeSession,
  stateManager: StateManager
): "created" | "updated" | "unchanged" {
  const human = stateManager.getHuman();
  const existingTopic = human.topics.find((t) => t.id === session.id);

  if (existingTopic) {
    if (existingTopic.name !== session.title) {
      const updatedTopic: Topic = {
        ...existingTopic,
        name: session.title,
        last_updated: new Date().toISOString(),
      };
      stateManager.human_topic_upsert(updatedTopic);
      return "updated";
    }
    return "unchanged";
  }

  const newTopic: Topic = {
    id: session.id,
    name: session.title,
    description: `Claude Code session in ${session.cwd}`,
    sentiment: 0,
    exposure_current: 0.5,
    exposure_desired: 0.3,
    persona_groups: CLAUDE_CODE_TOPIC_GROUPS,
    learned_by: CLAUDE_CODE_PERSONA_NAME,
    last_updated: new Date().toISOString(),
  };

  stateManager.human_topic_upsert(newTopic);
  return "created";
}

// =============================================================================
// State Helpers
// =============================================================================

function updateProcessedState(
  stateManager: StateManager,
  session: ClaudeCodeSession
): void {
  const human = stateManager.getHuman();
  const processedSessions = {
    ...(human.settings?.claudeCode?.processed_sessions ?? {}),
    [session.id]: new Date().toISOString(),
  };

  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      claudeCode: {
        ...human.settings?.claudeCode,
        processed_sessions: processedSessions,
      },
    },
  });
}

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import one Claude Code session per call.
 *
 * Flow:
 * 1. Ensure topics exist for all sessions (cheap, always runs).
 * 2. Find the next unprocessed session (20+ minutes old).
 * 3. Ensure the "Claude Code" persona exists.
 * 4. Archive the persona and clear its messages, then write all messages
 *    for the session — pre-marking already-imported messages [p,r,o,f]=true,
 *    leaving new messages unmarked for extraction.
 * 5. Queue extraction for unmarked messages.
 * 6. Mark session processed.
 */
export async function importClaudeCodeSessions(
  options: ClaudeCodeImporterOptions
): Promise<ClaudeCodeImportResult> {
  const { stateManager, interface: eiInterface } = options;
  const reader = options.reader ?? new ClaudeCodeReader();

  const result: ClaudeCodeImportResult = {
    sessionsProcessed: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    messagesImported: 0,
    personaCreated: false,
    extractionScansQueued: 0,
  };

  // ─── Step 1: Ensure topics exist for ALL sessions ─────────────────────
  const allSessions = await reader.getSessions();

  for (const session of allSessions) {
    const topicResult = ensureSessionTopic(session, stateManager);
    if (topicResult === "created") result.topicsCreated++;
    else if (topicResult === "updated") result.topicsUpdated++;
  }

  if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
    eiInterface?.onHumanUpdated?.();
  }

  // ─── Step 2: Find next unprocessed session ────────────────────────────
  const human = stateManager.getHuman();
  const processedSessions = human.settings?.claudeCode?.processed_sessions ?? {};
  const now = Date.now();

  let targetSession: ClaudeCodeSession | null = null;

  // allSessions is already sorted oldest-first
  for (const session of allSessions) {
    const lastImported = processedSessions[session.id];
    const sessionLastMs = new Date(session.lastMessageAt).getTime();
    const ageMs = now - sessionLastMs;

    if (ageMs < MIN_SESSION_AGE_MS) continue; // too fresh

    if (!lastImported) {
      targetSession = session;
      break;
    }

    // Re-import if session has been updated since last import
    if (sessionLastMs > new Date(lastImported).getTime()) {
      targetSession = session;
      break;
    }
  }

  if (!targetSession) {
    console.log("[ClaudeCode] All sessions processed, nothing new to import");
    return result;
  }

  console.log(
    `[ClaudeCode] Processing session: "${targetSession.title}" ` +
      `(last message: ${targetSession.lastMessageAt})`
  );

  // ─── Step 3: Pull messages ────────────────────────────────────────────
  const messages = await reader.getMessagesForSession(targetSession.id);

  if (messages.length === 0) {
    updateProcessedState(stateManager, targetSession);
    return result;
  }

  // ─── Step 4: Ensure persona, archive, clear, write messages ──────────
  const persona = ensureClaudeCodePersona(stateManager, eiInterface);
  result.personaCreated = !stateManager.persona_getByName(CLAUDE_CODE_PERSONA_NAME);

  if (!persona.is_archived) {
    stateManager.persona_archive(persona.id);
  }

  const existingMsgs = stateManager.messages_get(persona.id);
  if (existingMsgs.length > 0) {
    stateManager.messages_remove(persona.id, existingMsgs.map((m) => m.id));
  }

  const cutoffIso = processedSessions[targetSession.id] ?? null;
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
  const toAnalyze: Message[] = [];

  for (const msg of messages) {
    const msgMs = new Date(msg.timestamp).getTime();
    const isOld = cutoffMs !== null && msgMs < cutoffMs;
    const eiMsg = isOld ? convertToPreMarkedEiMessage(msg) : convertToEiMessage(msg);
    stateManager.messages_append(persona.id, eiMsg);
    result.messagesImported++;
    if (!isOld) toAnalyze.push(eiMsg);
  }

  stateManager.messages_sort(persona.id);
  stateManager.persona_update(persona.id, {
    last_activity: new Date().toISOString(),
  });
  eiInterface?.onMessageAdded?.(persona.id);

  // ─── Step 5: Queue extraction for new messages ────────────────────────
  if (toAnalyze.length > 0) {
    const allInState = stateManager.messages_get(persona.id);
    const analyzeIds = new Set(toAnalyze.map((m) => m.id));
    const analyzeStartIndex = allInState.findIndex((m) => analyzeIds.has(m.id));
    const contextMsgs = analyzeStartIndex > 0 ? allInState.slice(0, analyzeStartIndex) : [];

    const context: ExtractionContext = {
      personaId: persona.id,
      personaDisplayName: persona.display_name,
      messages_context: contextMsgs,
      messages_analyze: toAnalyze,
    };

    queueAllScans(context, stateManager);
    result.extractionScansQueued += 4;
  }

  result.sessionsProcessed = 1;

  // ─── Step 6: Mark processed ───────────────────────────────────────────
  updateProcessedState(stateManager, targetSession);

  console.log(
    `[ClaudeCode] Session complete: ${result.messagesImported} messages imported, ` +
      `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}
