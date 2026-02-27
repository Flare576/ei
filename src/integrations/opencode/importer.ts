import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Topic, Message, ContextStatus } from "../../core/types.js";
import type { IOpenCodeReader, OpenCodeSession, OpenCodeMessage } from "./types.js";
import { UTILITY_AGENTS, AGENT_TO_AGENT_PREFIXES } from "./types.js";
import { createOpenCodeReader } from "./reader-factory.js";
import { ensureAgentPersona } from "../../core/personas/opencode-agent.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";

// =============================================================================
// Constants
// =============================================================================

const OPENCODE_TOPIC_GROUPS = ["General", "Coding", "OpenCode"];

// =============================================================================
// Export Types
// =============================================================================

export interface ImportResult {
  sessionsProcessed: number;
  topicsCreated: number;
  topicsUpdated: number;
  messagesImported: number;
  personasCreated: string[];
  extractionScansQueued: number;
}

export interface OpenCodeImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IOpenCodeReader;
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
    verbal_response: ocMsg.content,
    timestamp: ocMsg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
  };
}

/** Convert OC message to Ei Message with all extraction flags pre-set. */
function convertToPreMarkedEiMessage(ocMsg: OpenCodeMessage): Message {
  return {
    ...convertToEiMessage(ocMsg),
    f: true,
    r: true,
    p: true,
    o: true,
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
 * 1. Ensure topics exist for all primary sessions (always, cheaply).
 * 2. Find the next unprocessed session after extraction_point.
 * 3. Write all messages for that session to their persona(s) — archived,
 *    messages cleared first. Messages before last_imported are pre-marked
 *    [p,r,o,f]=true; newer messages are unmarked and queued for extraction.
 * 4. Advance extraction_point to session.time.updated.
 *
 * The processor gate (queue_length() === 0) ensures we never pile onto a
 * backed-up queue.
 */
export async function importOpenCodeSessions(
  options: OpenCodeImporterOptions
): Promise<ImportResult> {
  const { stateManager, interface: eiInterface } = options;
  const reader = options.reader ?? await createOpenCodeReader();

  const result: ImportResult = {
    sessionsProcessed: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    messagesImported: 0,
    personasCreated: [],
    extractionScansQueued: 0,
  };

  // ─── Step 1: Ensure topics exist for ALL primary sessions ─────────────
  // Always runs (cheap), so session titles stay current regardless of
  // whether we process messages this cycle.
  const allSessions = await reader.getSessionsUpdatedSince(new Date(0));
  const primarySessions = allSessions.filter(s => !s.parentId);

  for (const session of primarySessions) {
    const topicResult = await ensureSessionTopic(session, reader, stateManager);
    if (topicResult === "created") result.topicsCreated++;
    else if (topicResult === "updated") result.topicsUpdated++;
  }

  if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
    eiInterface?.onHumanUpdated?.();
  }

  // ─── Step 2: Find next unprocessed session ────────────────────────────
  const human = stateManager.getHuman();
  const processedSessions = human.settings?.opencode?.processed_sessions ?? {};

  // Sessions sorted oldest-first; find first unprocessed or updated-since-last-import
  const sortedSessions = [...primarySessions].sort(
    (a, b) => a.time.updated - b.time.updated
  );
  let targetSession: OpenCodeSession | null = null;
  const MIN_SESSION_AGE_MS = 20 * 60 * 1000; // 20 minutes
  const now = Date.now();

  for (const session of sortedSessions) {
    const lastImported = processedSessions[session.id];
    if (!lastImported) {
      const ageMs = now - session.time.updated;
      if (ageMs >= MIN_SESSION_AGE_MS) {
        targetSession = session;
        break;
      }
    }
    if (session.time.updated > new Date(lastImported).getTime()) {
      const ageMs = now - session.time.updated;
      if (ageMs >= MIN_SESSION_AGE_MS) {
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
    updateExtractionState(stateManager, targetSession);
    return result;
  }

  // ─── Step 4: Resolve agents → personas, group by persona ID ────────
  // Resolve aliases up front so 'sisyphus' and 'Sisyphus (Ultraworker)'
  // land in the same bucket instead of clobbering each other.
  const byPersonaId = new Map<string, { persona: NonNullable<ReturnType<typeof stateManager.persona_getByName>>; msgs: OpenCodeMessage[] }>();
  for (const msg of relevant) {
    let persona = stateManager.persona_getByName(msg.agent);
    if (!persona) {
      persona = await ensureAgentPersona(msg.agent, {
        stateManager,
        interface: eiInterface,
        reader,
      });
      result.personasCreated.push(msg.agent);
    }
    const bucket = byPersonaId.get(persona.id);
    if (bucket) {
      bucket.msgs.push(msg);
    } else {
      byPersonaId.set(persona.id, { persona, msgs: [msg] });
    }
  }

  const cutoffIso = processedSessions[targetSession.id] ?? null;
  const cutoffMs = cutoffIso ? new Date(cutoffIso).getTime() : null;

  for (const [, { persona, msgs: agentMsgs }] of byPersonaId) {
    // Archive persona (message store only, not a conversational persona)
    if (!persona.is_archived) {
      stateManager.persona_archive(persona.id);
    }

    // Clear existing messages — this persona holds exactly one session at a time
    const existingMsgs = stateManager.messages_get(persona.id);
    if (existingMsgs.length > 0) {
      stateManager.messages_remove(persona.id, existingMsgs.map(m => m.id));
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
    stateManager.persona_update(persona.id, {
      last_activity: new Date().toISOString(),
    });
    eiInterface?.onMessageAdded?.(persona.id);

    // ─── Step 5: Queue extraction for unmarked messages ────────────────
    if (toAnalyze.length > 0) {
      const allInState = stateManager.messages_get(persona.id);
      const analyzeIds = new Set(toAnalyze.map(m => m.id));
      const analyzeStartIndex = allInState.findIndex(m => analyzeIds.has(m.id));
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
  }

  result.sessionsProcessed = 1;

  // ─── Step 6: Advance extraction state ────────────────────────────────
  updateExtractionState(stateManager, targetSession);

  console.log(
    `[OpenCode] Session complete: ${result.messagesImported} messages imported, ` +
    `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}

// =============================================================================
// Topic Management
// =============================================================================

async function ensureSessionTopic(
  session: OpenCodeSession,
  reader: IOpenCodeReader,
  stateManager: StateManager
): Promise<"created" | "updated" | "unchanged"> {
  const human = stateManager.getHuman();
  const existingTopic = human.topics.find((t) => t.id === session.id);

  const firstAgent = await reader.getFirstAgent(session.id);
  const learnedBy = firstAgent ?? "build";

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
    description: "",
    sentiment: 0,
    exposure_current: 0.5,
    exposure_desired: 0.3,
    persona_groups: OPENCODE_TOPIC_GROUPS,
    learned_by: learnedBy,
    last_updated: new Date().toISOString(),
  };

  stateManager.human_topic_upsert(newTopic);
  return "created";
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
