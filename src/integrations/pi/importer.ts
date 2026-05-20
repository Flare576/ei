import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message, PersonaEntity, PersonaTrait } from "../../core/types.js";
import { DEFAULT_SEED_TRAITS } from "../../core/constants/seed-traits.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import {
  queuePersonRewritePhase,
  queueTopicRewritePhase,
} from "../../core/orchestrators/ceremony.js";
import { qualifyPiMessage } from "../../core/utils/message-id.js";
import { convertToEiMessage, convertToPreMarkedEiMessage } from "../shared/message-converter.js";
import { getMachineId } from "../machine-id.js";
import { isProcessRunning } from "../process-check.js";
import { PiReader } from "./reader.js";
import {
  PI_PERSONA_NAME,
  type PiSession,
  type IPiReader,
} from "./types.js";
import { MIN_SESSION_AGE_MS, TWELVE_HOURS_MS } from "../constants.js";

export interface PiImportResult {
  sessionsProcessed: number;
  messagesImported: number;
  personaCreated: boolean;
  extractionScansQueued: number;
}

export interface PiImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IPiReader;
  signal?: AbortSignal;
}

const PI_GROUP = "Pi";

const qualify = qualifyPiMessage;

function ensurePiPersona(
  stateManager: StateManager,
  eiInterface?: Ei_Interface
): PersonaEntity {
  const existing = stateManager.persona_getByName(PI_PERSONA_NAME);
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
    display_name: PI_PERSONA_NAME,
    entity: "system",
    aliases: ["pi", "pi coding agent", "omp", "oh-my-pi"],
    short_description: "Pi - minimal terminal coding harness",
    long_description:
      "Pi is a minimal terminal coding harness. Covers both vanilla Pi (earendil-works/pi) and the oh-my-pi fork (omp), which share the same JSONL session format.",
    group_primary: PI_GROUP,
    groups_visible: [PI_GROUP],
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

function updateProcessedState(stateManager: StateManager, session: PiSession): void {
  const human = stateManager.getHuman();
  const lastMessageMs = new Date(session.lastMessageAt).getTime();
  const extractionPoint = human.settings?.pi?.extraction_point;
  const currentPointMs = extractionPoint ? new Date(extractionPoint).getTime() : 0;
  const newPointMs = Math.max(currentPointMs, lastMessageMs);

  const processedSessions = {
    ...(human.settings?.pi?.processed_sessions ?? {}),
    [session.id]: new Date().toISOString(),
  };

  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      pi: {
        ...human.settings?.pi,
        extraction_point: new Date(newPointMs).toISOString(),
        processed_sessions: processedSessions,
      },
    },
  });
}

async function isPiRunning(): Promise<boolean> {
  return (
    (await isProcessRunning("pi")) ||
    (await isProcessRunning("omp"))
  );
}

export async function importPiSessions(options: PiImporterOptions): Promise<PiImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? new PiReader();

  const result: PiImportResult = {
    sessionsProcessed: 0,
    messagesImported: 0,
    personaCreated: false,
    extractionScansQueued: 0,
  };

  const allSessions = await reader.getSessions();
  if (signal?.aborted) return result;

  const human = stateManager.getHuman();
  const processedSessions = human.settings?.pi?.processed_sessions ?? {};
  const now = Date.now();
  const toolRunning = await isPiRunning();

  let targetSession: PiSession | null = null;

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
    console.log("[Pi] All sessions processed, nothing new to import");
    return result;
  }

  if (signal?.aborted) return result;

  console.log(
    `[Pi] Processing session: "${targetSession.title}" ` +
      `(last message: ${targetSession.lastMessageAt})`
  );

  const messages = targetSession.messages;
  if (messages.length === 0) {
    updateProcessedState(stateManager, targetSession);
    return result;
  }

  if (signal?.aborted) return result;

  const personaExistedBefore = stateManager.persona_getByName(PI_PERSONA_NAME) !== null;
  const persona = ensurePiPersona(stateManager, eiInterface);
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
    const eiMsg = isOld
      ? convertToPreMarkedEiMessage(msg, targetSession.id, qualify)
      : convertToEiMessage(msg, targetSession.id, qualify);

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
      sources: [`pi:${getMachineId()}:${targetSession.id}`],
    };

    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
    queueAllScans(context, stateManager, {
      extraction_model: human.settings?.pi?.extraction_model,
      external_filter: "only",
    });
    result.extractionScansQueued += 4;
  }

  result.sessionsProcessed = 1;
  updateProcessedState(stateManager, targetSession);

  console.log(
    `[Pi] Session complete: ${result.messagesImported} messages imported, ` +
      `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}
