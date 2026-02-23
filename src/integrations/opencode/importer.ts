import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Topic, Message, ContextStatus } from "../../core/types.js";
import { MESSAGE_MIN_COUNT, MESSAGE_MAX_AGE_DAYS } from "../../core/types.js";
import type { IOpenCodeReader, OpenCodeSession, OpenCodeMessage } from "./types.js";
import { UTILITY_AGENTS, AGENT_TO_AGENT_PREFIXES } from "./types.js";
import { createOpenCodeReader } from "./reader-factory.js";
import { ensureAgentPersona } from "../../core/personas/opencode-agent.js";
import {
  queueDirectTopicUpdate,
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import { resolveTokenLimit } from "../../core/llm-client.js";

// =============================================================================
// Constants
// =============================================================================

const OPENCODE_TOPIC_GROUPS = ["General", "Coding", "OpenCode"];

/** Max extraction calls per archive scan cycle (bounds queue flooding). */
const ARCHIVE_SCAN_MAX_CALLS = 50;
const CHARS_PER_TOKEN = 4;
const MIN_EXTRACTION_TOKENS = 10000;
const EXTRACTION_BUDGET_RATIO = 0.75;

// =============================================================================
// Transient Types (used only during import analysis, never persisted)
// =============================================================================

interface MiniMessage {
  id: string;
  timestamp: string;
}

interface ExternalMessage extends MiniMessage {
  isExternal: true;
  sessionId: string;
}

// =============================================================================
// Export Types
// =============================================================================

interface SessionAgentMessages {
  sessionId: string;
  agentName: string;
  personaId?: string;
  messages: OpenCodeMessage[];
}

export interface ImportResult {
  sessionsProcessed: number;
  topicsCreated: number;
  topicsUpdated: number;
  messagesImported: number;
  messagesPruned: number;
  personasCreated: string[];
  topicUpdatesQueued: number;
  extractionScansQueued: number;
  partialSessionsFound: number;
  archiveScansQueued: number;
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
    content: ocMsg.content,
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

function estimateTokensForMessages(messages: OpenCodeMessage[]): number {
  return messages.reduce(
    (sum, msg) => sum + Math.ceil(msg.content.length / CHARS_PER_TOKEN) + 4,
    0
  );
}

// =============================================================================
// Main Import Function
// =============================================================================

export async function importOpenCodeSessions(
  since: Date,
  options: OpenCodeImporterOptions
): Promise<ImportResult> {
  const { stateManager, interface: eiInterface } = options;
  const reader = options.reader ?? await createOpenCodeReader();

  const result: ImportResult = {
    sessionsProcessed: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    messagesImported: 0,
    messagesPruned: 0,
    personasCreated: [],
    topicUpdatesQueued: 0,
    extractionScansQueued: 0,
    partialSessionsFound: 0,
    archiveScansQueued: 0,
  };

  // ─── Step 1: Pull ALL sessions → Verify/Write topics ─────────────────
  // new Date(0) ensures we always see all sessions for topic verification,
  // regardless of when last sync was.
  const allSessions = await reader.getSessionsUpdatedSince(new Date(0));
  const primarySessions = allSessions.filter(s => !s.parentId);

  for (const session of primarySessions) {
    const topicResult = await ensureSessionTopic(session, reader, stateManager);
    if (topicResult === "created") result.topicsCreated++;
    else if (topicResult === "updated") result.topicsUpdated++;
  }

  // ─── Step 2: Pull messages since last_sync, group by agent ───────────
  const sinceMs = since.getTime();
  const updatedSessions = primarySessions.filter(s => s.time.updated > sinceMs);

  console.log(
    `[OpenCode] Found ${primarySessions.length} total sessions, ` +
    `${updatedSessions.length} updated since ${since.toISOString()}`
  );

  const agentsForPersona = new Set<string>();
  const sessionAgentBatches: SessionAgentMessages[] = [];

  for (const session of updatedSessions) {
    result.sessionsProcessed++;
    const messages = await reader.getMessagesForSession(session.id, since);
    const relevant = filterRelevantMessages(messages);
    const messagesByAgent = new Map<string, OpenCodeMessage[]>();

    for (const msg of relevant) {
      agentsForPersona.add(msg.agent);
      const existing = messagesByAgent.get(msg.agent) ?? [];
      existing.push(msg);
      messagesByAgent.set(msg.agent, existing);
    }

    for (const [agentName, agentMessages] of messagesByAgent) {
      sessionAgentBatches.push({
        sessionId: session.id,
        agentName,
        messages: agentMessages,
      });
    }
  }

  // ─── Steps 3-8: Only run if we have new messages to process ──────────
  let isFirstImport = false;

  if (sessionAgentBatches.length > 0) {
    // ─── Step 3: Ensure personas exist ─────────────────────────────────
    const agentNameToPersonaId = new Map<string, string>();

    for (const agentName of agentsForPersona) {
      let existing = stateManager.persona_getByName(agentName);
      if (!existing) {
        existing = await ensureAgentPersona(agentName, {
          stateManager,
          interface: eiInterface,
          reader,
        });
        result.personasCreated.push(agentName);
      }
      agentNameToPersonaId.set(agentName, existing.id);
    }

    for (const batch of sessionAgentBatches) {
      batch.personaId = agentNameToPersonaId.get(batch.agentName);
    }

    // Build reverse mapping: personaId → agent names
    const personaIdToAgentNames = new Map<string, Set<string>>();
    for (const [agentName, personaId] of agentNameToPersonaId) {
      const names = personaIdToAgentNames.get(personaId) ?? new Set();
      names.add(agentName);
      personaIdToAgentNames.set(personaId, names);
    }

    // ─── Steps 4-5: Merge/Dedup/Prune per persona ─────────────────────
    const batchesByPersona = new Map<string, SessionAgentMessages[]>();
    for (const batch of sessionAgentBatches) {
      if (!batch.personaId) continue;
      const existing = batchesByPersona.get(batch.personaId) ?? [];
      existing.push(batch);
      batchesByPersona.set(batch.personaId, existing);
    }

    // Track surviving new messages per persona for partial session detection
    const survivingNewByPersona = new Map<string, OpenCodeMessage[]>();

    for (const [personaId, personaBatches] of batchesByPersona) {
      // Combine all new OC messages for this persona
      const allNew: OpenCodeMessage[] = [];
      for (const batch of personaBatches) {
        allNew.push(...batch.messages);
      }

      // Get existing persona messages for dedup + pruning analysis
      const existingMessages = stateManager.messages_get(personaId);
      const existingIds = new Set(existingMessages.map(m => m.id));

      // Dedup: only messages not already in state
      const genuinelyNew = allNew.filter(m => !existingIds.has(m.id));
      if (genuinelyNew.length === 0) continue;

      // Build merged list for pruning analysis
      const merged: (MiniMessage | ExternalMessage)[] = [
        ...existingMessages.map(m => ({ id: m.id, timestamp: m.timestamp })),
        ...genuinelyNew.map(m => ({
          id: m.id,
          timestamp: m.timestamp,
          isExternal: true as const,
          sessionId: m.sessionId,
        })),
      ];

      // Prune
      const keptIds = pruneImportMessages(merged, existingMessages);
      const keptSet = new Set(keptIds);

      // ─── Step 6: Write to persona state ────────────────────────────
      const survivingNew: OpenCodeMessage[] = [];
      for (const ocMsg of genuinelyNew) {
        if (keptSet.has(ocMsg.id)) {
          stateManager.messages_append(personaId, convertToEiMessage(ocMsg));
          survivingNew.push(ocMsg);
          result.messagesImported++;
        }
      }

      const prunedExistingIds = existingMessages
        .filter(m => !keptSet.has(m.id))
        .map(m => m.id);
      if (prunedExistingIds.length > 0) {
        stateManager.messages_remove(personaId, prunedExistingIds);
        result.messagesPruned += prunedExistingIds.length;
      }

      stateManager.messages_sort(personaId);
      stateManager.persona_update(personaId, {
        last_activity: new Date().toISOString(),
      });
      eiInterface?.onMessageAdded?.(personaId);

      if (survivingNew.length > 0) {
        survivingNewByPersona.set(personaId, survivingNew);
      }
    }

    if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
      eiInterface?.onHumanUpdated?.();
    }

    // ─── Step 7: Detect partial sessions → SessionUpdate ─────────────
    for (const [personaId, survivingMsgs] of survivingNewByPersona) {
      const agentNames = personaIdToAgentNames.get(personaId) ?? new Set();
      const persona = stateManager.persona_getById(personaId);
      if (!persona) continue;

      // Group surviving new messages by session
      const bySession = new Map<string, OpenCodeMessage[]>();
      for (const msg of survivingMsgs) {
        const existing = bySession.get(msg.sessionId) ?? [];
        existing.push(msg);
        bySession.set(msg.sessionId, existing);
      }

      for (const [sessionId] of bySession) {
        const isPartial = await checkPartialSession(
          personaId, sessionId, agentNames, reader, stateManager
        );
        if (isPartial) {
          result.partialSessionsFound++;
          const scans = await processSessionUpdate(
            personaId, persona.display_name, sessionId, agentNames,
            reader, stateManager
          );
          result.extractionScansQueued += scans;
        }
      }
    }

    // ─── Step 8: Queue topic updates + extraction scans ──────────────
    isFirstImport = initializeExtractionPointIfNeeded(
      sessionAgentBatches, stateManager
    );

    if (result.messagesImported > 0) {
      // Topic description updates for sessions with new messages
      result.topicUpdatesQueued = queueTopicUpdatesForBatches(
        sessionAgentBatches, stateManager
      );

      if (isFirstImport) {
        // First import: all 4 extraction types on ALL surviving messages
        result.extractionScansQueued += queueAllExtractionsForAllMessages(
          batchesByPersona, stateManager
        );
        console.log(
          `[OpenCode] First import: queued extraction scans for ` +
          `${batchesByPersona.size} persona(s)`
        );
      } else {
        // Normal sync: all 4 extraction types on newly imported messages
        result.extractionScansQueued += queueExtractionsForNewMessages(
          batchesByPersona, stateManager
        );
      }

      console.log(
        `[OpenCode] Queued ${result.topicUpdatesQueued} topic updates, ` +
        `${result.extractionScansQueued} extraction scans`
      );
    }
  } else if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
    eiInterface?.onHumanUpdated?.();
  }

  // ─── Step 9: Archive scan (skip on first import to avoid queue flood) ─
  if (!isFirstImport) {
    const archiveResult = await processArchiveScan(
      stateManager, reader, eiInterface
    );
    result.archiveScansQueued = archiveResult.scansQueued;
  }

  return result;
}

// =============================================================================
// Pruning
// =============================================================================

/**
 * Determine which messages to keep after merging existing + new external messages.
 *
 * Rules:
 * - Always keep at least minMessages (even if they're ancient)
 * - Remove messages older than maxAgeDays IF:
 *   - External (never in state → safe to drop), OR
 *   - Fully extracted ([p,r,o,f] all true → knowledge already captured)
 * - Messages that are old but NOT external and NOT fully extracted are KEPT
 *   (they still have knowledge to extract)
 *
 * @returns Array of message IDs to keep
 */
export function pruneImportMessages(
  merged: (MiniMessage | ExternalMessage)[],
  existingMessages: Message[],
  minMessages: number = MESSAGE_MIN_COUNT,
  maxAgeDays: number = MESSAGE_MAX_AGE_DAYS
): string[] {
  if (merged.length <= minMessages) return merged.map(m => m.id);

  const cutoffMs = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const sorted = [...merged].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const existingById = new Map(existingMessages.map(m => [m.id, m]));

  const toRemove: string[] = [];
  for (const m of sorted) {
    if (merged.length - toRemove.length <= minMessages) break;

    const isOld = new Date(m.timestamp).getTime() < cutoffMs;
    if (!isOld) break; // Sorted by time — no more old messages after this

    const isExternal = "isExternal" in m && (m as ExternalMessage).isExternal;
    const existing = existingById.get(m.id);
    const fullyExtracted = existing?.f && existing?.r && existing?.o && existing?.p;

    if (isExternal || fullyExtracted) {
      toRemove.push(m.id);
    }
  }

  const removeSet = new Set(toRemove);
  return merged.filter(m => !removeSet.has(m.id)).map(m => m.id);
}

// =============================================================================
// Partial Session Detection & SessionUpdate
// =============================================================================

/**
 * Check if a session is "partial" — some messages in state but not all.
 * This happens when an old session gets new messages ("necro session").
 */
async function checkPartialSession(
  personaId: string,
  sessionId: string,
  agentNames: Set<string>,
  reader: IOpenCodeReader,
  stateManager: StateManager
): Promise<boolean> {
  const allSessionMsgs = await reader.getMessagesForSession(sessionId);
  const relevantMsgs = filterRelevantMessages(
    allSessionMsgs.filter(m => agentNames.has(m.agent))
  );

  const personaMsgs = stateManager.messages_get(personaId);
  const stateIds = new Set(personaMsgs.map(m => m.id));

  return relevantMsgs.some(m => !stateIds.has(m.id));
}

/**
 * Handle a partial session by injecting missing messages and queuing extraction.
 *
 * Old (missing) messages are injected with [p,r,o,f]=true — they serve as
 * context only and are already "fully extracted" so ceremony can prune them.
 * The new messages (already in state, NOT pre-marked) go to messages_analyze
 * for actual extraction.
 */
async function processSessionUpdate(
  personaId: string,
  personaDisplayName: string,
  sessionId: string,
  agentNames: Set<string>,
  reader: IOpenCodeReader,
  stateManager: StateManager
): Promise<number> {
  const allSessionMsgs = await reader.getMessagesForSession(sessionId);
  const relevantMsgs = filterRelevantMessages(
    allSessionMsgs.filter(m => agentNames.has(m.agent))
  );

  if (relevantMsgs.length === 0) return 0;

  // Find which messages are missing from state
  const personaMsgs = stateManager.messages_get(personaId);
  const stateIds = new Set(personaMsgs.map(m => m.id));
  const missingMsgs = relevantMsgs.filter(m => !stateIds.has(m.id));

  // Inject missing messages PRE-MARKED as fully extracted.
  // They're context only — ceremony will prune them (old + [p,r,o,f]=true).
  for (const ocMsg of missingMsgs) {
    stateManager.messages_append(personaId, convertToPreMarkedEiMessage(ocMsg));
  }
  stateManager.messages_sort(personaId);

  console.log(
    `[OpenCode] SessionUpdate: injected ${missingMsgs.length} pre-marked ` +
    `context messages for session ${sessionId}`
  );

  // Build extraction context:
  // - context = old injected messages (pre-marked, provide session background)
  // - analyze = new messages already in state (need actual extraction)
  const allInState = stateManager.messages_get(personaId);
  const sessionMsgIds = new Set(relevantMsgs.map(m => m.id));
  const missingIds = new Set(missingMsgs.map(m => m.id));

  const contextMsgs = allInState.filter(
    m => sessionMsgIds.has(m.id) && missingIds.has(m.id)
  );
  const analyzeMsgs = allInState.filter(
    m => sessionMsgIds.has(m.id) && !missingIds.has(m.id)
  );

  if (analyzeMsgs.length === 0) return 0;

  const context: ExtractionContext = {
    personaId,
    personaDisplayName,
    messages_context: contextMsgs,
    messages_analyze: analyzeMsgs,
  };

  queueAllScans(context, stateManager);

    const human = stateManager.getHuman();
    const topic = human.topics.find(t => t.id === sessionId);
    if (topic) {
      queueDirectTopicUpdate(topic, context, stateManager);
    }

    return 4;
}

// =============================================================================
// Archive Scan
// =============================================================================

/**
 * Process old sessions from SQLite for extraction.
 *
 * Replaces gradual-extraction.ts entirely. Reads sessions between
 * extraction_point and the 14-day cutoff, injects their messages into
 * persona state, and queues all 4 extraction types.
 *
 * Unlike SessionUpdate, archive messages are NOT pre-marked — they need
 * actual extraction. The queue-empty gate on ceremony (in ceremony.ts)
 * prevents premature pruning while extraction is pending.
 *
 * Bounded by a token budget to prevent queue flooding.
 */
async function processArchiveScan(
  stateManager: StateManager,
  reader: IOpenCodeReader,
  eiInterface?: Ei_Interface
): Promise<{ scansQueued: number; newExtractionPoint: string | null }> {
  const human = stateManager.getHuman();
  const extractionPoint = human.settings?.opencode?.extraction_point;

  if (!extractionPoint || extractionPoint === "done") {
    return { scansQueued: 0, newExtractionPoint: null };
  }

  const extractionPointMs = new Date(extractionPoint).getTime();
  const cutoffMs = Date.now() - (MESSAGE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  if (extractionPointMs >= cutoffMs) {
    // Archive scan caught up to the primary window
    updateExtractionPoint(stateManager, "done");
    console.log(`[OpenCode] Archive scan complete — caught up to primary window`);
    return { scansQueued: 0, newExtractionPoint: "done" };
  }

  const sessions = await reader.getSessionsInRange(
    new Date(extractionPointMs),
    new Date(cutoffMs)
  );

  if (sessions.length === 0) {
    // No sessions in archive range — advance to cutoff
    const newPoint = new Date(cutoffMs).toISOString();
    updateExtractionPoint(stateManager, newPoint);
    return { scansQueued: 0, newExtractionPoint: newPoint };
  }

  // Sort chronologically (getSessionsInRange should return ASC, but ensure)
  sessions.sort((a, b) => a.time.updated - b.time.updated);

  // Build set of all message IDs currently in state for fast lookups
  const openCodePersonas = stateManager.persona_getAll()
    .filter(p => p.group_primary === "OpenCode");
  const allStateMessageIds = new Set<string>();
  for (const persona of openCodePersonas) {
    for (const m of stateManager.messages_get(persona.id)) {
      allStateMessageIds.add(m.id);
    }
  }

  let tokenBudget = 0;
  const modelTokenLimit = resolveTokenLimit(human.settings?.default_model, human.settings?.accounts);
  const perCallBudget = Math.max(MIN_EXTRACTION_TOKENS, Math.floor(modelTokenLimit * EXTRACTION_BUDGET_RATIO));
  const tokenLimit = ARCHIVE_SCAN_MAX_CALLS * perCallBudget;
  let scansQueued = 0;
  let lastProcessed: OpenCodeSession | null = null;

  for (const session of sessions) {
    const allMsgs = await reader.getMessagesForSession(session.id);
    const relevant = filterRelevantMessages(allMsgs);

    // Skip sessions whose messages are already in state
    if (relevant.some(m => allStateMessageIds.has(m.id))) {
      lastProcessed = session;
      continue;
    }

    if (relevant.length === 0) {
      lastProcessed = session;
      continue;
    }

    // Token budget check
    const sessionTokens = estimateTokensForMessages(relevant);
    tokenBudget += sessionTokens;

    // Group by agent → persona
    const byAgent = new Map<string, OpenCodeMessage[]>();
    for (const msg of relevant) {
      const existing = byAgent.get(msg.agent) ?? [];
      existing.push(msg);
      byAgent.set(msg.agent, existing);
    }

    for (const [agentName, agentMsgs] of byAgent) {
      // Resolve persona (create if needed — unlikely for archive but safe)
      let persona = stateManager.persona_getByName(agentName);
      if (!persona) {
        persona = await ensureAgentPersona(agentName, {
          stateManager,
          interface: eiInterface,
          reader,
        });
      }

      // Inject messages into persona state (NOT pre-marked — need extraction)
      for (const ocMsg of agentMsgs) {
        stateManager.messages_append(persona.id, convertToEiMessage(ocMsg));
        allStateMessageIds.add(ocMsg.id);
      }
      stateManager.messages_sort(persona.id);

      // Build extraction context from the injected messages
      const injectedMsgs = stateManager.messages_get(persona.id)
        .filter(m => agentMsgs.some(am => am.id === m.id));

      const context: ExtractionContext = {
        personaId: persona.id,
        personaDisplayName: persona.display_name,
        messages_context: [],
        messages_analyze: injectedMsgs,
      };

      queueAllScans(context, stateManager);
      scansQueued += 4;

      const topic = human.topics.find(t => t.id === session.id);
      if (topic) {
        queueDirectTopicUpdate(topic, context, stateManager);
      }
    }

    lastProcessed = session;

    if (tokenBudget >= tokenLimit) {
      console.log(
        `[OpenCode] Archive scan: token budget reached after ${scansQueued} scans`
      );
      break;
    }
  }

  // Advance extraction_point
  if (lastProcessed) {
    const newPoint = new Date(lastProcessed.time.updated).toISOString();
    updateExtractionPoint(stateManager, newPoint);
    console.log(
      `[OpenCode] Archive scan: ${scansQueued} scans queued, ` +
      `extraction_point → ${newPoint}`
    );
    return { scansQueued, newExtractionPoint: newPoint };
  }

  return { scansQueued: 0, newExtractionPoint: null };
}

// =============================================================================
// Extraction Queueing
// =============================================================================

/**
 * Queue topic description updates for sessions with new messages.
 * Finds batch messages in persona state and builds ExtractionContext.
 */
function queueTopicUpdatesForBatches(
  batches: SessionAgentMessages[],
  stateManager: StateManager
): number {
  const human = stateManager.getHuman();
  let totalChunks = 0;

  for (const batch of batches) {
    if (!batch.personaId) continue;

    const topic = human.topics.find(t => t.id === batch.sessionId);
    if (!topic) continue;

    const persona = stateManager.persona_getById(batch.personaId);
    if (!persona) continue;

    const allMessages = stateManager.messages_get(batch.personaId);
    const batchMessageIds = new Set(batch.messages.map(m => m.id));

    const analyzeStartIndex = allMessages.findIndex(m => batchMessageIds.has(m.id));
    if (analyzeStartIndex === -1) continue;

    const context: ExtractionContext = {
      personaId: batch.personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.slice(0, analyzeStartIndex),
      messages_analyze: allMessages.filter(m => batchMessageIds.has(m.id)),
    };

    if (context.messages_analyze.length === 0) continue;

    totalChunks += queueDirectTopicUpdate(topic, context, stateManager);
  }

  return totalChunks;
}

/**
 * Queue all 4 extraction types for newly imported messages (normal sync).
 * Groups by persona to avoid duplicate scan queueing.
 */
function queueExtractionsForNewMessages(
  batchesByPersona: Map<string, SessionAgentMessages[]>,
  stateManager: StateManager
): number {
  let scansQueued = 0;

  for (const [personaId, personaBatches] of batchesByPersona) {
    const persona = stateManager.persona_getById(personaId);
    if (!persona) continue;

    const allMessages = stateManager.messages_get(personaId);

    // Combine all batch message IDs for this persona
    const batchMessageIds = new Set<string>();
    for (const batch of personaBatches) {
      for (const m of batch.messages) {
        batchMessageIds.add(m.id);
      }
    }

    // Find the new messages that are actually in state (survived pruning)
    const analyzeMessages = allMessages.filter(m => batchMessageIds.has(m.id));
    if (analyzeMessages.length === 0) continue;

    const analyzeStartIndex = allMessages.findIndex(m => batchMessageIds.has(m.id));
    const contextMessages = analyzeStartIndex > 0
      ? allMessages.slice(0, analyzeStartIndex)
      : [];

    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: contextMessages,
      messages_analyze: analyzeMessages,
    };

    queueAllScans(context, stateManager);
    scansQueued += 4;
  }

  return scansQueued;
}

/**
 * Queue all 4 extraction types on ALL surviving messages for every persona.
 * Used on first import — the "fun" moment where extraction kicks off.
 */
function queueAllExtractionsForAllMessages(
  batchesByPersona: Map<string, SessionAgentMessages[]>,
  stateManager: StateManager
): number {
  let scansQueued = 0;

  for (const [personaId] of batchesByPersona) {
    const persona = stateManager.persona_getById(personaId);
    if (!persona) continue;

    const allMessages = stateManager.messages_get(personaId);
    if (allMessages.length === 0) continue;

    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: [],
      messages_analyze: allMessages,
    };

    queueAllScans(context, stateManager);
    scansQueued += 4;
  }

  return scansQueued;
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

function initializeExtractionPointIfNeeded(
  batches: SessionAgentMessages[],
  stateManager: StateManager
): boolean {
  const human = stateManager.getHuman();
  const existingPoint = human.settings?.opencode?.extraction_point;

  if (existingPoint) return false;

  let earliestTimestamp: number | null = null;

  for (const batch of batches) {
    for (const msg of batch.messages) {
      const msgMs = new Date(msg.timestamp).getTime();
      if (earliestTimestamp === null || msgMs < earliestTimestamp) {
        earliestTimestamp = msgMs;
      }
    }
  }

  if (earliestTimestamp === null) return false;

  const extractionPoint = new Date(earliestTimestamp).toISOString();
  updateExtractionPoint(stateManager, extractionPoint);
  console.log(`[OpenCode] Initialized extraction_point to ${extractionPoint}`);
  return true;
}

function updateExtractionPoint(
  stateManager: StateManager,
  newPoint: string
): void {
  const human = stateManager.getHuman();
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      opencode: {
        ...human.settings?.opencode,
        extraction_point: newPoint,
      },
    },
  });
}
