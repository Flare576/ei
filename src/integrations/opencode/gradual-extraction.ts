import type { StateManager } from "../../core/state-manager.js";
import {
  queueAllScans,
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

  const options: ExtractionOptions = { include_quotes: false };

  for (const persona of openCodePersonas) {
    const personaName = persona.aliases?.[0];
    if (!personaName) continue;

    const allMessages = stateManager.messages_get(personaName);
    const messagesInScope = allMessages.filter(msg => {
      const msgMs = new Date(msg.timestamp).getTime();
      return msgMs >= extractionPointMs && msgMs < scopeLimit;
    });

    if (messagesInScope.length === 0) continue;

    const contextMessages = allMessages.filter(msg => {
      const msgMs = new Date(msg.timestamp).getTime();
      return msgMs < extractionPointMs;
    }).slice(-20);

    const context: ExtractionContext = {
      personaName,
      messages_context: contextMessages,
      messages_analyze: messagesInScope,
      include_quotes: false,
    };

    queueAllScans(context, stateManager, options);
    result.personasProcessed++;
    result.scansQueued += 4;
  }

  result.newExtractionPoint = scopeLimitIso;
  updateExtractionPoint(stateManager, scopeLimitIso);

  if (result.personasProcessed > 0) {
    console.log(
      `[OpenCode] Gradual extraction: queued scans for ${result.personasProcessed} persona(s), ` +
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
