import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  type Message,
  type MessageQueryOptions,
  type ContextStatus,
  type LLMRequest,
} from "./types.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import {
  buildResponsePrompt,
  buildPersonaTraitExtractionPrompt,
  type PersonaTraitExtractionPromptData,
} from "../prompts/index.js";
import { buildResponsePromptData } from "./prompt-context-builder.js";
import {
  queueFactFind,
  queueTopicScan,
  queuePersonScan,
  type ExtractionContext,
} from "./orchestrators/index.js";
import { buildChatMessageContent } from "../prompts/message-utils.js";
import { filterMessagesForContext } from "./context-utils.js";

// =============================================================================
// MESSAGE QUERIES
// =============================================================================

export async function getMessages(
  sm: StateManager,
  personaId: string,
  _options?: MessageQueryOptions
): Promise<Message[]> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return [];
  return sm.messages_get(personaId);
}

export async function markMessageRead(
  sm: StateManager,
  personaId: string,
  messageId: string
): Promise<boolean> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return false;
  return sm.messages_markRead(personaId, messageId);
}

export async function markAllMessagesRead(sm: StateManager, personaId: string): Promise<number> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return 0;
  return sm.messages_markAllRead(personaId);
}

// =============================================================================
// PENDING REQUEST MANAGEMENT
// =============================================================================

/**
 * Clear pending LLM requests for a persona and abort the current one if it matches.
 * Returns true if anything was cleared (including the in-flight request).
 */
export function clearPendingRequestsFor(
  sm: StateManager,
  qp: QueueProcessor,
  currentRequest: LLMRequest | null,
  personaId: string
): boolean {
  const responsesToClear = [
    LLMNextStep.HandlePersonaResponse,
    LLMNextStep.HandlePersonaTraitExtraction,
    LLMNextStep.HandleHeartbeatCheck,
    LLMNextStep.HandleEiHeartbeat,
    LLMNextStep.HandleToolContinuation,
  ];

  let removedAny = false;
  for (const nextStep of responsesToClear) {
    const removedIds = sm.queue_clearPersonaResponses(personaId, nextStep);
    if (removedIds.length > 0) removedAny = true;
  }

  const currentMatchesPersona =
    currentRequest &&
    responsesToClear.includes(currentRequest.next_step as LLMNextStep) &&
    currentRequest.data.personaId === personaId;

  if (currentMatchesPersona) {
    qp.abort();
    return true;
  }

  return removedAny;
}

export async function recallPendingMessages(
  sm: StateManager,
  qp: QueueProcessor,
  currentRequest: LLMRequest | null,
  personaId: string,
  onMessageAdded: (id: string) => void,
  onMessageRecalled: (id: string, content: string) => void
): Promise<string> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return "";
  clearPendingRequestsFor(sm, qp, currentRequest, personaId);
  const messages = sm.messages_get(personaId);
  const pendingIds = messages
    .filter((m) => m.role === "human" && !m.read)
    .map((m) => m.id);
  if (pendingIds.length === 0) return "";
  const removed = sm.messages_remove(personaId, pendingIds);
  const recalledContent = removed.map((m) => m.verbal_response ?? "").join("\n\n");
  onMessageAdded(personaId);
  onMessageRecalled(personaId, recalledContent);
  return recalledContent;
}

// =============================================================================
// SEND MESSAGE
// =============================================================================

export async function sendMessage(
  sm: StateManager,
  qp: QueueProcessor,
  currentRequest: LLMRequest | null,
  personaId: string,
  content: string,
  isTUI: boolean,
  getModelForPersona: (id?: string) => string | undefined,
  onError: (err: { code: string; message: string }) => void,
  onMessageAdded: (id: string) => void,
  onMessageQueued: (id: string) => void
): Promise<void> {
  const persona = sm.persona_getById(personaId);
  if (!persona) {
    onError({
      code: "PERSONA_NOT_FOUND",
      message: `Persona with ID "${personaId}" not found`,
    });
    return;
  }

  clearPendingRequestsFor(sm, qp, currentRequest, personaId);

  const message: Message = {
    id: crypto.randomUUID(),
    role: "human",
    verbal_response: content,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: "default" as ContextStatus,
  };
  sm.messages_append(persona.id, message);
  onMessageAdded(persona.id);

  const tools = sm.tools_getForPersona(persona.id, isTUI);
  const promptData = await buildResponsePromptData(sm, persona, isTUI, content, tools);
  const prompt = buildResponsePrompt(promptData);

  sm.queue_enqueue({
    type: LLMRequestType.Response,
    priority: LLMPriority.High,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaResponse,
    model: getModelForPersona(persona.id),
    data: { personaId: persona.id, personaDisplayName: persona.display_name },
  });
  onMessageQueued(persona.id);

  const history = sm.messages_get(persona.id);

  const traitExtractionData: PersonaTraitExtractionPromptData = {
    persona_name: persona.display_name,
    current_traits: persona.traits,
    messages_context: history.slice(-11, -1),
    messages_analyze: [message],
  };
  const traitPrompt = buildPersonaTraitExtractionPrompt(traitExtractionData);

  sm.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: traitPrompt.system,
    user: traitPrompt.user,
    next_step: LLMNextStep.HandlePersonaTraitExtraction,
    model: getModelForPersona(persona.id),
    data: { personaId: persona.id, personaDisplayName: persona.display_name },
  });

  checkAndQueueHumanExtraction(sm, persona.id, persona.display_name, history);
}

// =============================================================================
// HUMAN EXTRACTION TRIGGER
// =============================================================================

/**
 * Queue fact/topic/person extraction scans using a tapering threshold.
 * Threshold = MIN(10, current item count) — fires on every message when
 * bootstrapping (0 items), then tapers to once every 10 messages as data grows.
 * Always extracts ALL unextracted messages when triggered (no artificial batching).
 */
const EXTRACTION_TAPER_CAP = 10;

export function checkAndQueueHumanExtraction(
  sm: StateManager,
  personaId: string,
  personaDisplayName: string,
  history: Message[]
): void {
  const human = sm.getHuman();

  const unextractedFacts = sm.messages_getUnextracted(personaId, "f");
  const factsThreshold = Math.min(EXTRACTION_TAPER_CAP, human.facts.filter(f => f.description && f.description !== "").length);
  if (unextractedFacts.length > 0 && unextractedFacts.length >= factsThreshold) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName,
      messages_context: history.filter((m) => m.f === true),
      messages_analyze: unextractedFacts,
      extraction_flag: "f",
    };
    queueFactFind(context, sm);
    console.log(
      `[Processor] Human Seed extraction: facts (threshold: ${factsThreshold}, unextracted: ${unextractedFacts.length})`
    );
  }

  const unextractedTopics = sm.messages_getUnextracted(personaId, "t");
  const topicsThreshold = Math.min(EXTRACTION_TAPER_CAP, human.topics.length);
  if (unextractedTopics.length > 0 && unextractedTopics.length >= topicsThreshold) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName,
      messages_context: history.filter((m) => m.t === true),
      messages_analyze: unextractedTopics,
      extraction_flag: "t",
    };
    queueTopicScan(context, sm);
    console.log(
      `[Processor] Human Seed extraction: topics (threshold: ${topicsThreshold}, unextracted: ${unextractedTopics.length})`
    );
  }

  const unextractedPeople = sm.messages_getUnextracted(personaId, "p");
  const peopleThreshold = Math.min(EXTRACTION_TAPER_CAP, human.people.length);
  if (unextractedPeople.length > 0 && unextractedPeople.length >= peopleThreshold) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName,
      messages_context: history.filter((m) => m.p === true),
      messages_analyze: unextractedPeople,
      extraction_flag: "p",
    };
    queuePersonScan(context, sm);
    console.log(
      `[Processor] Human Seed extraction: people (threshold: ${peopleThreshold}, unextracted: ${unextractedPeople.length})`
    );
  }
}

// =============================================================================
// FETCH MESSAGES FOR LLM (chat message format)
// =============================================================================

export function fetchMessagesForLLM(
   sm: StateManager,
   personaId: string
 ): import("./types.js").ChatMessage[] {
   const persona = sm.persona_getById(personaId);
   if (!persona) return [];
 
   const human = sm.getHuman();
   const history = sm.messages_get(personaId);
   const contextWindowHours = persona.context_window_hours ?? human.settings?.default_context_window_hours ?? 8;
   const filteredHistory = filterMessagesForContext(history, persona.context_boundary, contextWindowHours);

  return filteredHistory.reduce<import("./types.js").ChatMessage[]>((acc, m) => {
    const content = buildChatMessageContent(m);
    if (content.length > 0) {
      acc.push({
        role: m.role === "human" ? "user" : "assistant",
        content,
      });
    }
    return acc;
  }, []);
}

// =============================================================================
// CONTEXT BOUNDARY + STATUS
// =============================================================================

export async function setContextBoundary(
  sm: StateManager,
  personaId: string,
  timestamp: string | null
): Promise<void> {
  sm.persona_setContextBoundary(personaId, timestamp);
}

export async function setMessageContextStatus(
  sm: StateManager,
  personaId: string,
  messageId: string,
  status: ContextStatus
): Promise<void> {
  sm.messages_setContextStatus(personaId, messageId, status);
}

export async function deleteMessages(
  sm: StateManager,
  personaId: string,
  messageIds: string[]
): Promise<Message[]> {
  return sm.messages_remove(personaId, messageIds);
}
