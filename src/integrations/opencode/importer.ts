import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message, ContextStatus } from "../../core/types.js";
import type { IOpenCodeReader, OpenCodeSession, OpenCodeMessage } from "./types.js";
import { UTILITY_AGENTS, AGENT_TO_AGENT_PREFIXES } from "./types.js";
import { createOpenCodeReader } from "./reader-factory.js";
import { ensureAgentPersona, resolveCanonicalAgent } from "../../core/personas/opencode-agent.js";
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

// =============================================================================
// Constants
// =============================================================================


// =============================================================================
// Export Types
// =============================================================================

export interface ImportResult {
  sessionsProcessed: number;
  messagesImported: number;
  personasCreated: string[];
  extractionScansQueued: number;
}

export interface OpenCodeImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IOpenCodeReader;
  signal?: AbortSignal;
}

// =============================================================================
// Utility Functions
// =============================================================================

function isAgentToAgentMessage(content: string): boolean {
  const trimmed = content.trimStart();
  return AGENT_TO_AGENT_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

function convertToEiMessage(ocMsg: OpenCodeMessage): Message {
  return {
    id: ocMsg.id,
    role: ocMsg.role === "user" ? "human" : "system",
    content: ocMsg.content,
    timestamp: ocMsg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

function convertToPreMarkedEiMessage(ocMsg: OpenCodeMessage): Message {
  return {
    ...convertToEiMessage(ocMsg),
    f: true,
    t: true,
    p: true,
    e: true,
  };
}

function filterRelevantMessages(messages: OpenCodeMessage[]): OpenCodeMessage[] {
  return messages.filter(msg => {
    if (UTILITY_AGENTS.includes(msg.agent as typeof UTILITY_AGENTS[number])) return false;
    if (isAgentToAgentMessage(msg.content)) return false;
    return true;
  });
}

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import one OpenCode session per call.
 *
 * Flow:
 * 1. Find the next unprocessed or updated session (oldest-first).
 * 2. Write all messages for that session to their persona(s) — archived,
 *    messages cleared first. Messages before last_imported are pre-marked
 *    [p,r,o,f]=true; newer messages are unmarked and queued for extraction.
 * 3. Advance extraction_point to session.time.updated.
 *
 * NOTE: extraction_point is a progress indicator for user visibility only.
 * It does NOT gate which sessions are imported. processed_sessions (per-session
 * timestamps) is the sole source of truth for "have we seen this session and
 * is it up to date." Sessions absent from processed_sessions are always
 * candidates regardless of their timestamp vs extraction_point.
 *
 * The processor gate (queue_length() === 0) ensures we never pile onto a
 * backed-up queue.
 *
 * Session titles are intentionally NOT seeded as topics. The extraction
 * pipeline generates richer, embedding-backed topics organically.
 */
export async function importOpenCodeSessions(
  options: OpenCodeImporterOptions
): Promise<ImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? await createOpenCodeReader();

  const result: ImportResult = {
    sessionsProcessed: 0,
    messagesImported: 0,
    personasCreated: [],
    extractionScansQueued: 0,
  };

  // ─── Step 1: Find next unprocessed session ──────────────────────────
  const allSessions = await reader.getSessionsUpdatedSince(new Date(0));
  if (signal?.aborted) return result;
  const primarySessions = allSessions.filter(s => !s.parentId);

  const human = stateManager.getHuman();
  const processedSessions = human.settings?.opencode?.processed_sessions ?? {};

  // Sessions sorted oldest-first; find first unprocessed or updated-since-last-import
  const sortedSessions = [...primarySessions].sort(
    (a, b) => a.time.updated - b.time.updated
  );
  let targetSession: OpenCodeSession | null = null;
  const MIN_SESSION_AGE_MS = 20 * 60 * 1000; // 20 minutes
  const now = Date.now();
  const toolRunning = await isProcessRunning("opencode");

  for (const session of sortedSessions) {
    const lastImported = processedSessions[session.id];
    if (!lastImported) {
      const ageMs = now - session.time.updated;
      if (ageMs >= MIN_SESSION_AGE_MS || !toolRunning) {
        targetSession = session;
        break;
      }
    }
    if (session.time.updated > new Date(lastImported).getTime()) {
      const ageMs = now - session.time.updated;
      if (ageMs >= MIN_SESSION_AGE_MS || !toolRunning) {
        targetSession = session;
        break;
      }
    }
  }

  if (!targetSession) {
    // Nothing new to process — bump last_sync and return
    console.log(`[OpenCode] All sessions processed, nothing new since extraction_point`);
    return result;
  }

  console.log(
    `[OpenCode] Processing session: "${targetSession.title}" ` +
    `(updated: ${new Date(targetSession.time.updated).toISOString()})`
  );

  // ─── Step 3: Pull and filter messages ────────────────────────────────
  const allMsgs = await reader.getMessagesForSession(targetSession.id);
  const relevant = filterRelevantMessages(allMsgs);

  if (relevant.length === 0) {
    // Empty session — mark processed and advance
    result.sessionsProcessed = 1;
    updateExtractionState(stateManager, targetSession);
    return result;
  }

  // ─── Step 4: Resolve agents → personas, group by persona ID ────────
  // Resolve aliases up front so 'sisyphus' and 'Sisyphus (Ultraworker)'
  // land in the same bucket instead of clobbering each other.
  const byPersonaId = new Map<string, { persona: NonNullable<ReturnType<typeof stateManager.persona_getByName>>; msgs: OpenCodeMessage[]; isNew: boolean; agentName: string }>();
  for (const msg of relevant) {
    let persona = stateManager.persona_getByName(msg.agent);
    let isNew = false;
    if (!persona) {
      persona = await ensureAgentPersona(msg.agent, {
        stateManager,
        interface: eiInterface,
        reader,
      });
      result.personasCreated.push(msg.agent);
      isNew = true;
    }
    const bucket = byPersonaId.get(persona.id);
    if (bucket) {
      bucket.msgs.push(msg);
    } else {
      byPersonaId.set(persona.id, { persona, msgs: [msg], isNew, agentName: msg.agent });
    }
  }

  const cutoffIso = processedSessions[targetSession.id] ?? null;
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;
  let anyPersonaHasChanges = false;

  for (const [, { persona, msgs: agentMsgs, isNew, agentName }] of byPersonaId) {
    if (isNew) {
      // Brand-new persona: archive it (coding-session store, not a live chat persona)
      stateManager.persona_archive(persona.id);
    } else if (persona.is_archived) {
      // Existing archived persona: refresh identity fields, then remove only external messages
      const agentInfo = await reader.getAgentInfo(persona.display_name);
      const { aliases } = resolveCanonicalAgent(agentName);
      stateManager.persona_update(persona.id, {
        short_description: agentInfo?.description ?? persona.short_description,
        aliases,
      });
      const existingMsgs = stateManager.messages_get(persona.id);
      const externalIds = existingMsgs.filter(m => m.external === true).map(m => m.id);
      if (externalIds.length > 0) {
        stateManager.messages_remove(persona.id, externalIds);
      }
    } else {
      // Existing live (non-archived) persona: only remove external messages, leave chat history intact
      const existingMsgs = stateManager.messages_get(persona.id);
      const externalIds = existingMsgs.filter(m => m.external === true).map(m => m.id);
      if (externalIds.length > 0) {
        stateManager.messages_remove(persona.id, externalIds);
      }
    }

    // Write messages — pre-mark old ones, leave new ones unmarked for extraction
    const toAnalyze: Message[] = [];
    for (const ocMsg of agentMsgs) {
      const msgMs = new Date(ocMsg.timestamp).getTime();
      const isOld = cutoffMs !== null && msgMs < cutoffMs;
      const eiMsg = isOld ? convertToPreMarkedEiMessage(ocMsg) : convertToEiMessage(ocMsg);
      stateManager.messages_append(persona.id, eiMsg);
      result.messagesImported++;
      if (!isOld) toAnalyze.push(eiMsg);
    }

    stateManager.messages_sort(persona.id);
    eiInterface?.onMessageAdded?.(persona.id);

    // ─── Step 5: Queue extraction for unmarked messages ────────────────
    if (toAnalyze.length > 0) {
      const allInState = stateManager.messages_get(persona.id);
      const analyzeIds = new Set(toAnalyze.map(m => m.id));
      const analyzeStartIndex = allInState.findIndex(m => analyzeIds.has(m.id));
      const contextMsgs = analyzeStartIndex > 0 ? allInState.slice(0, analyzeStartIndex) : [];

      const context: ExtractionContext = {
        personaId: persona.id,
        channelDisplayName: persona.display_name,
        messages_context: contextMsgs,
        messages_analyze: toAnalyze,
        sources: [`opencode:${getMachineId()}:${targetSession.id}`],
      };

      if (!signal?.aborted) {
        anyPersonaHasChanges = true;
        const openCodeSettings = stateManager.getHuman().settings?.opencode;
        queueAllScans(context, stateManager, {
          extraction_model: openCodeSettings?.extraction_model,
          external_filter: "only",
        });
        result.extractionScansQueued += 4;
      }
    }
  }

  result.sessionsProcessed = 1;

  // ─── Step 6: Queue rewrite checks if any persona had new messages ─────
  if (anyPersonaHasChanges && !signal?.aborted) {
    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
  }

  // ─── Step 7: Advance extraction state ────────────────────────────────
  updateExtractionState(stateManager, targetSession);

  console.log(
    `[OpenCode] Session complete: ${result.messagesImported} messages imported, ` +
    `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}


// =============================================================================
// State Helpers
// =============================================================================

function updateExtractionState(
  stateManager: StateManager,
  session: OpenCodeSession
): void {
  const human = stateManager.getHuman();
  const newPoint = new Date(session.time.updated).toISOString();
  const processedSessions = {
    ...(human.settings?.opencode?.processed_sessions ?? {}),
    [session.id]: new Date().toISOString(),
  };

  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      opencode: {
        ...human.settings?.opencode,
        extraction_point: newPoint,
        processed_sessions: processedSessions,
      },
    },
  });
}
