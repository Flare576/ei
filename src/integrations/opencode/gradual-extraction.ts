import type { StateManager } from "../../core/state-manager.js";
import {
  queueFactScan,
  queueTraitScan,
  queuePersonScan,
  queueTopicScan,
  type ExtractionContext,
  type ExtractionOptions,
} from "../../core/orchestrators/human-extraction.js";

export interface GradualExtractionResult {
  personasProcessed: number;
  scansQueued: number;
  newExtractionPoint: string | null;
  completed: boolean;
}

export function processGradualExtraction(stateManager: StateManager): GradualExtractionResult {
  const human = stateManager.getHuman();
  const opencode = human.settings?.opencode;
  const extractionPoint = opencode?.extraction_point;

  const result: GradualExtractionResult = {
    personasProcessed: 0,
    scansQueued: 0,
    newExtractionPoint: null,
    completed: false,
  };

  if (!extractionPoint || extractionPoint === "done") {
    return result;
  }

  const extractionPointMs = new Date(extractionPoint).getTime();
  const now = Date.now();
  const scopeLimit = calculateScopeLimit(extractionPointMs);

  if (scopeLimit >= now) {
    result.completed = true;
    result.newExtractionPoint = "done";
    updateExtractionPoint(stateManager, "done");
    console.log(`[OpenCode] Gradual extraction complete - caught up to present, handing off to Ceremony`);
    return result;
  }

  const scopeLimitIso = new Date(scopeLimit).toISOString();

  const openCodePersonas = stateManager.persona_getAll()
    .filter(p => p.group_primary === "OpenCode");

  if (openCodePersonas.length === 0) {
    result.newExtractionPoint = scopeLimitIso;
    updateExtractionPoint(stateManager, scopeLimitIso);
    return result;
  }

  const options: ExtractionOptions = {};

  for (const persona of openCodePersonas) {
    if (!persona.id) continue;

    const allMessages = stateManager.messages_get(persona.id);
    
    const messagesInScope = allMessages.filter(msg => {
      const msgMs = new Date(msg.timestamp).getTime();
      return msgMs >= extractionPointMs && msgMs < scopeLimit;
    });

    if (messagesInScope.length === 0) continue;

    const contextMessages = allMessages.filter(msg => {
      const msgMs = new Date(msg.timestamp).getTime();
      return msgMs < extractionPointMs;
    }).slice(-20);

    let scansForPersona = 0;

    const unextractedFacts = messagesInScope.filter(m => m.f !== true);
    if (unextractedFacts.length > 0) {
      const context: ExtractionContext = {
        personaId: persona.id,
        personaDisplayName: persona.display_name,
        messages_context: contextMessages,
        messages_analyze: unextractedFacts,
        extraction_flag: "f",
      };
      queueFactScan(context, stateManager, options);
      scansForPersona++;
    }

    const unextractedTraits = messagesInScope.filter(m => m.r !== true);
    if (unextractedTraits.length > 0) {
      const context: ExtractionContext = {
        personaId: persona.id,
        personaDisplayName: persona.display_name,
        messages_context: contextMessages,
        messages_analyze: unextractedTraits,
        extraction_flag: "r",
      };
      queueTraitScan(context, stateManager, options);
      scansForPersona++;
    }

    const unextractedPeople = messagesInScope.filter(m => m.o !== true);
    if (unextractedPeople.length > 0) {
      const context: ExtractionContext = {
        personaId: persona.id,
        personaDisplayName: persona.display_name,
        messages_context: contextMessages,
        messages_analyze: unextractedPeople,
        extraction_flag: "o",
      };
      queuePersonScan(context, stateManager, options);
      scansForPersona++;
    }

    const unextractedTopics = messagesInScope.filter(m => m.p !== true);
    if (unextractedTopics.length > 0) {
      const context: ExtractionContext = {
        personaId: persona.id,
        personaDisplayName: persona.display_name,
        messages_context: contextMessages,
        messages_analyze: unextractedTopics,
        extraction_flag: "p",
      };
      queueTopicScan(context, stateManager, options);
      scansForPersona++;
    }

    if (scansForPersona > 0) {
      result.personasProcessed++;
      result.scansQueued += scansForPersona;
    }
  }

  result.newExtractionPoint = scopeLimitIso;
  updateExtractionPoint(stateManager, scopeLimitIso);

  if (result.personasProcessed > 0) {
    console.log(
      `[OpenCode] Gradual extraction: queued ${result.scansQueued} scans for ${result.personasProcessed} persona(s), ` +
      `scope: ${extractionPoint} → ${scopeLimitIso}`
    );
  }

  return result;
}

function calculateScopeLimit(extractionPointMs: number): number {
  const extractionDate = new Date(extractionPointMs);
  
  const next2am = new Date(extractionDate);
  next2am.setHours(2, 0, 0, 0);
  
  if (next2am.getTime() <= extractionPointMs) {
    next2am.setDate(next2am.getDate() + 1);
  }
  
  return next2am.getTime();
}

function updateExtractionPoint(stateManager: StateManager, newPoint: string): void {
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
