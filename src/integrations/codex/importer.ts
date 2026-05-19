import type { StateManager } from "../../core/state-manager.js";
import type { ContextStatus, Ei_Interface, Message, PersonaEntity, PersonaTrait } from "../../core/types.js";
import { DEFAULT_SEED_TRAITS } from "../../core/constants/seed-traits.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import {
  queuePersonRewritePhase,
  queueTopicRewritePhase,
} from "../../core/orchestrators/ceremony.js";
import { qualifyCodexMessage } from "../../core/utils/message-id.js";
import { getMachineId } from "../machine-id.js";
import { isProcessRunning } from "../process-check.js";
import { CodexReader } from "./reader.js";
import {
  CODEX_PERSONA_NAME,
  MIN_SESSION_AGE_MS,
  type CodexMessage,
  type CodexSession,
  type ICodexReader,
} from "./types.js";

export interface CodexImportResult {
  sessionsProcessed: number;
  messagesImported: number;
  personaCreated: boolean;
  extractionScansQueued: number;
}

export interface CodexImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: ICodexReader;
  signal?: AbortSignal;
}

const TWELVE_HOURS_MS = 43_200_000;
const CODEX_GROUP = "Codex";

function convertToEiMessage(msg: CodexMessage, sessionId: string): Message {
  return {
    id: qualifyCodexMessage(getMachineId(), sessionId, msg.id),
    role: msg.role === "user" ? "human" : "system",
    content: msg.content,
    timestamp: msg.timestamp,
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

function convertToPreMarkedEiMessage(msg: CodexMessage, sessionId: string): Message {
  return {
    ...convertToEiMessage(msg, sessionId),
    f: true,
    t: true,
    p: true,
    e: true,
  };
}

function ensureCodexPersona(
  stateManager: StateManager,
  eiInterface?: Ei_Interface
): PersonaEntity {
  const existing = stateManager.persona_getByName(CODEX_PERSONA_NAME);
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
    display_name: CODEX_PERSONA_NAME,
    entity: "system",
    aliases: ["codex", "codex cli", "codex desktop", "openai codex"],
    short_description: "Codex - OpenAI coding agent environment",
    long_description:
      "Codex is OpenAI's coding agent environment for working with local codebases, terminal commands, tools, and implementation tasks.",
    group_primary: CODEX_GROUP,
    groups_visible: [CODEX_GROUP],
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
  session: CodexSession
): void {
  const human = stateManager.getHuman();
  const lastMessageMs = new Date(session.lastMessageAt).getTime();
  const extractionPoint = human.settings?.codex?.extraction_point;
  const currentPointMs = extractionPoint ? new Date(extractionPoint).getTime() : 0;
  const newPointMs = Math.max(currentPointMs, lastMessageMs);

  const processedSessions = {
    ...(human.settings?.codex?.processed_sessions ?? {}),
    [session.id]: new Date().toISOString(),
  };

  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      codex: {
        ...human.settings?.codex,
        extraction_point: new Date(newPointMs).toISOString(),
        processed_sessions: processedSessions,
      },
    },
  });
}

async function isCodexRunning(): Promise<boolean> {
  return (await isProcessRunning("Codex")) || (await isProcessRunning("codex"));
}

export async function importCodexSessions(
  options: CodexImporterOptions
): Promise<CodexImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? new CodexReader();

  const result: CodexImportResult = {
    sessionsProcessed: 0,
    messagesImported: 0,
    personaCreated: false,
    extractionScansQueued: 0,
  };

  const allSessions = await reader.getSessions();
  if (signal?.aborted) return result;

  const human = stateManager.getHuman();
  const processedSessions = human.settings?.codex?.processed_sessions ?? {};
  const now = Date.now();
  const toolRunning = await isCodexRunning();

  let targetSession: CodexSession | null = null;

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
    console.log("[Codex] All sessions processed, nothing new to import");
    return result;
  }

  if (signal?.aborted) return result;

  console.log(
    `[Codex] Processing session: "${targetSession.title}" ` +
      `(last message: ${targetSession.lastMessageAt})`
  );

  const messages = targetSession.messages;
  if (messages.length === 0) {
    updateProcessedState(stateManager, targetSession);
    return result;
  }

  if (signal?.aborted) return result;

  const personaExistedBefore = stateManager.persona_getByName(CODEX_PERSONA_NAME) !== null;
  const persona = ensureCodexPersona(stateManager, eiInterface);
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
      ? convertToPreMarkedEiMessage(msg, targetSession.id)
      : convertToEiMessage(msg, targetSession.id);

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
      sources: [`codex:${getMachineId()}:${targetSession.id}`],
    };

    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
    queueAllScans(context, stateManager, {
      extraction_model: human.settings?.codex?.extraction_model,
      external_filter: "only",
    });
    result.extractionScansQueued += 4;
  }

  result.sessionsProcessed = 1;
  updateProcessedState(stateManager, targetSession);

  console.log(
    `[Codex] Session complete: ${result.messagesImported} messages imported, ` +
      `${result.extractionScansQueued} extraction scans queued`
  );

  return result;
}
