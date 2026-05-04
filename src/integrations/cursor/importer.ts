import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message, ContextStatus, PersonaEntity, PersonaTrait } from "../../core/types.js";
import { DEFAULT_SEED_TRAITS } from "../../core/constants/seed-traits.js";
import type { ICursorReader, CursorSession, CursorMessage } from "./types.js";
import {
  CURSOR_PERSONA_NAME,
  MIN_SESSION_AGE_MS,
} from "./types.js";
import { CursorReader } from "./reader.js";
import { isProcessRunning } from "../process-check.js";
import { getMachineId } from "../machine-id.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import {
  queuePersonRewritePhase,
  queueTopicRewritePhase,
} from "../../core/orchestrators/ceremony.js";

export interface CursorImportResult {
  sessionsProcessed: number;
  messagesImported: number;
  personaCreated: boolean;
  extractionScansQueued: number;
}

export interface CursorImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: ICursorReader;
  signal?: AbortSignal;
}

const TWELVE_HOURS_MS = 43_200_000;
const CURSOR_GROUP = "Cursor";

function convertToEiMessage(msg: CursorMessage): Message {
  return {
    id: msg.id,
    role: msg.type === 1 ? "human" : "system",
    content: msg.text,
    timestamp: msg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

function convertToPreMarkedEiMessage(msg: CursorMessage): Message {
  return {
    ...convertToEiMessage(msg),
    f: true,
    t: true,
    p: true,
    e: true,
  };
}

function ensureCursorPersona(
  stateManager: StateManager,
  eiInterface?: Ei_Interface
): PersonaEntity {
  const existing = stateManager.persona_getByName(CURSOR_PERSONA_NAME);
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
    display_name: CURSOR_PERSONA_NAME,
    entity: "system",
    aliases: ["cursor", "cursor ide"],
    short_description: "Cursor IDE — AI-powered coding environment",
    long_description:
      "Cursor is an AI-powered IDE that helps with coding tasks, debugging, architecture decisions, and more.",
    group_primary: CURSOR_GROUP,
    groups_visible: [CURSOR_GROUP],
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

function updateProcessedState(
  stateManager: StateManager,
  session: CursorSession
): void {
  const human = stateManager.getHuman();
  const lastMessageMs = new Date(session.lastMessageAt).getTime();
  const extractionPoint = human.settings?.cursor?.extraction_point;
  const currentPointMs = extractionPoint ? new Date(extractionPoint).getTime() : 0;
  const newPointMs = Math.max(currentPointMs, lastMessageMs);

  const processedSessions = {
    ...(human.settings?.cursor?.processed_sessions ?? {}),
    [session.id]: new Date().toISOString(),
  };

  // extraction_point is a progress indicator for user visibility only —
  // it does NOT gate imports. processed_sessions is the sole source of
  // truth for which sessions have been seen and when.
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      cursor: {
        ...human.settings?.cursor,
        extraction_point: new Date(newPointMs).toISOString(),
        processed_sessions: processedSessions,
      },
    },
  });
}

export async function importCursorSessions(
  options: CursorImporterOptions
): Promise<CursorImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? new CursorReader();

  const result: CursorImportResult = {
    sessionsProcessed: 0,
    messagesImported: 0,
    personaCreated: false,
    extractionScansQueued: 0,
  };

  const allSessions = await reader.getSessions();

  if (signal?.aborted) return result;

  const human = stateManager.getHuman();
  const processedSessions = human.settings?.cursor?.processed_sessions ?? {};
  const now = Date.now();
  const toolRunning = await isProcessRunning("Cursor");

  let targetSession: CursorSession | null = null;

  for (const session of allSessions) {
    const sessionLastMs = new Date(session.lastMessageAt).getTime();
    const ageMs = now - sessionLastMs;

    if (ageMs < MIN_SESSION_AGE_MS && toolRunning) continue;

    const lastImported = processedSessions[session.id];
    if (lastImported && sessionLastMs <= new Date(lastImported).getTime()) continue;

    targetSession = session;
    break;
  }

  if (!targetSession) {
    console.log("[Cursor] All sessions processed, nothing new to import");
    return result;
  }

  if (signal?.aborted) return result;

  console.log(
    `[Cursor] Processing session: "${targetSession.name}" ` +
      `(last message: ${targetSession.lastMessageAt})`
  );

  const messages = targetSession.messages;

  if (messages.length === 0) {
    updateProcessedState(stateManager, targetSession);
    return result;
  }

  if (signal?.aborted) return result;

  const personaExistedBefore = stateManager.persona_getByName(CURSOR_PERSONA_NAME) !== null;
  const persona = ensureCursorPersona(stateManager, eiInterface);
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
    const eiMsg = isOld ? convertToPreMarkedEiMessage(msg) : convertToEiMessage(msg);
    stateManager.messages_append(persona.id, eiMsg);
    result.messagesImported++;
    if (!isOld) toAnalyze.push(eiMsg);
  }

  stateManager.messages_sort(persona.id);
  eiInterface?.onMessageAdded?.(persona.id);

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
      sources: [`cursor:${getMachineId()}:${targetSession.id}`],
    };

    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
    queueAllScans(context, stateManager, { external_filter: "only" });
    result.extractionScansQueued += 4;
  }

  result.sessionsProcessed = 1;

  updateProcessedState(stateManager, targetSession);

  console.log(
    `[Cursor] Session complete: ${result.messagesImported} messages imported, ` +
      `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}
