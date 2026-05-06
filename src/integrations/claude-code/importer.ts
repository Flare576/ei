import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message, ContextStatus, PersonaEntity, PersonaTrait } from "../../core/types.js";
import { DEFAULT_SEED_TRAITS } from "../../core/constants/seed-traits.js";
import type { IClaudeCodeReader, ClaudeCodeSession, ClaudeCodeMessage } from "./types.js";
import {
  CLAUDE_CODE_PERSONA_NAME,
  MIN_SESSION_AGE_MS,
} from "./types.js";
import { ClaudeCodeReader } from "./reader.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import {
  queuePersonRewritePhase,
  queueTopicRewritePhase,
} from "../../core/orchestrators/ceremony.js";
import { isProcessRunning } from "../process-check.js";
import { getMachineId } from "../machine-id.js";
import { qualifyClaudeCodeMessage } from "../../core/utils/message-id.js";

// =============================================================================
// Export Types
// =============================================================================

export interface ClaudeCodeImportResult {
  sessionsProcessed: number;
  messagesImported: number;
  personaCreated: boolean;
  extractionScansQueued: number;
}

export interface ClaudeCodeImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IClaudeCodeReader;
  signal?: AbortSignal;
}

// =============================================================================
// Utility Functions
// =============================================================================

const TWELVE_HOURS_MS = 43_200_000;
const CLAUDE_CODE_GROUP = "Claude Code";

function convertToEiMessage(msg: ClaudeCodeMessage, sessionId: string): Message {
  return {
    id: qualifyClaudeCodeMessage(getMachineId(), sessionId, msg.id),
    role: msg.role === "user" ? "human" : "system",
    content: msg.content,
    timestamp: msg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

function convertToPreMarkedEiMessage(msg: ClaudeCodeMessage, sessionId: string): Message {
  return {
    ...convertToEiMessage(msg, sessionId),
    f: true,
    t: true,
    p: true,
    e: true,
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
  const seedTraits: PersonaTrait[] = DEFAULT_SEED_TRAITS.map((t) => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength,
    last_updated: now,
  }));
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
    traits: seedTraits,
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    heartbeat_delay_ms: TWELVE_HOURS_MS,
    last_heartbeat: now,
    last_updated: now,
  };

  stateManager.persona_add(persona);
  eiInterface?.onPersonaAdded?.();
  return persona;
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
        // extraction_point is a progress indicator for user visibility only —
        // it does NOT gate imports. processed_sessions is the sole source of
        // truth for which sessions have been seen and when.
        extraction_point: session.lastMessageAt,
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
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? new ClaudeCodeReader();

  const result: ClaudeCodeImportResult = {
    sessionsProcessed: 0,
    messagesImported: 0,
    personaCreated: false,
    extractionScansQueued: 0,
  };

  // ─── Step 1: Get all sessions ─────────────────────────────────────────
  const allSessions = await reader.getSessions();

  if (signal?.aborted) return result;

  // ─── Step 2: Find next unprocessed session ────────────────────────────
  const human = stateManager.getHuman();
  const settings = human.settings?.claudeCode;
  const processedSessions = settings?.processed_sessions ?? {};
  const now = Date.now();
  const toolRunning = await isProcessRunning("claude");

  let targetSession: ClaudeCodeSession | null = null;

  // allSessions is already sorted oldest-first
  for (const session of allSessions) {
    const lastImported = processedSessions[session.id];
    const sessionLastMs = new Date(session.lastMessageAt).getTime();
    const ageMs = now - sessionLastMs;

    if (ageMs < MIN_SESSION_AGE_MS && toolRunning) continue;

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

  if (signal?.aborted) return result;

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

  if (signal?.aborted) return result;

  // ─── Step 4: Ensure persona, archive if new, clear external messages ──────────
  const personaExistedBefore = stateManager.persona_getByName(CLAUDE_CODE_PERSONA_NAME) !== null;
  const persona = ensureClaudeCodePersona(stateManager, eiInterface);
  result.personaCreated = !personaExistedBefore;

  if (!personaExistedBefore) {
    stateManager.persona_archive(persona.id);
  } else {
    const existingMsgs = stateManager.messages_get(persona.id);
    const externalIds = existingMsgs.filter((m) => m.external === true).map((m) => m.id);
    if (externalIds.length > 0) {
      stateManager.messages_remove(persona.id, externalIds);
    }
  }

  const cutoffIso = processedSessions[targetSession.id] ?? null;
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
  const toAnalyze: Message[] = [];

  for (const msg of messages) {
    const msgMs = new Date(msg.timestamp).getTime();
    const isOld = cutoffMs !== null && msgMs < cutoffMs;
    const eiMsg = isOld ? convertToPreMarkedEiMessage(msg, targetSession.id) : convertToEiMessage(msg, targetSession.id);
    stateManager.messages_append(persona.id, eiMsg);
    result.messagesImported++;
    if (!isOld) toAnalyze.push(eiMsg);
  }

  stateManager.messages_sort(persona.id);
  eiInterface?.onMessageAdded?.(persona.id);

  // ─── Step 5: Queue extraction for new messages ────────────────────────
  if (toAnalyze.length > 0 && !signal?.aborted) {
    const allInState = stateManager.messages_get(persona.id);
    const analyzeIds = new Set(toAnalyze.map((m) => m.id));
    const analyzeStartIndex = allInState.findIndex((m) => analyzeIds.has(m.id));
    const contextMsgs = analyzeStartIndex > 0 ? allInState.slice(0, analyzeStartIndex) : [];

    const context: ExtractionContext = {
      personaId: persona.id,
      channelDisplayName: persona.display_name,
      messages_context: contextMsgs,
      messages_analyze: toAnalyze,
      sources: [`claudecode:${getMachineId()}:${targetSession.id}`],
    };

    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
    const ccSettings = stateManager.getHuman().settings?.claudeCode;
    queueAllScans(context, stateManager, {
      extraction_model: ccSettings?.extraction_model,
      external_filter: "only",
    });
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
