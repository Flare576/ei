import type { StateManager } from "../../core/state-manager.js";
import type { Message } from "../../core/types.js";
import {
  queueTopicScan,
  queuePersonScan,
  queueFactFind,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import {
  queuePersonRewritePhase,
  queueTopicRewritePhase,
} from "../../core/orchestrators/ceremony.js";

export interface PersonaHistoryImportResult {
  daysQueued: number;
  personasProcessed: number;
  scansQueued: number;
  complete: boolean;
}

export interface PersonaHistoryImporterOptions {
  stateManager: StateManager;
}

function dayBounds(dateStr: string): { start: number; end: number } {
  const start = new Date(dateStr + "T00:00:00.000Z").getTime();
  const end = new Date(dateStr + "T23:59:59.999Z").getTime();
  return { start, end };
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function messagesForDay(messages: Message[], start: number, end: number): Message[] {
  return messages.filter(m => {
    const ts = new Date(m.timestamp).getTime();
    return ts >= start && ts <= end;
  });
}

function hasUnprocessed(messages: Message[]): boolean {
  return messages.some(m => !m.t || !m.p);
}

export async function importPersonaHistory(
  options: PersonaHistoryImporterOptions
): Promise<PersonaHistoryImportResult> {
  const { stateManager } = options;
  const human = stateManager.getHuman();
  const settings = human.settings?.personaHistory;

  const result: PersonaHistoryImportResult = {
    daysQueued: 0,
    personasProcessed: 0,
    scansQueued: 0,
    complete: false,
  };

  if (settings?.complete) {
    result.complete = true;
    return result;
  }

  const personas = stateManager.persona_getAll().filter(p => !p.is_archived);
  const today = todayUTC();

  let currentDate = settings?.last_queued_date
    ? nextDay(settings.last_queued_date)
    : settings?.start_date ?? findEarliestMessageDate(stateManager) ?? today;

  if (currentDate > today) {
    markComplete(stateManager);
    result.complete = true;
    return result;
  }

  console.log(`[PersonaHistory] Queuing day: ${currentDate}`);

  const { start, end } = dayBounds(currentDate);

  for (const persona of personas) {
    const allMessages = stateManager.messages_get(persona.id);
    const dayMessages = messagesForDay(allMessages, start, end);

    if (dayMessages.length === 0) continue;
    if (!hasUnprocessed(dayMessages)) continue;

    const firstDayIdx = allMessages.findIndex(m => {
      const ts = new Date(m.timestamp).getTime();
      return ts >= start;
    });
    const contextMsgs = firstDayIdx > 0 ? allMessages.slice(Math.max(0, firstDayIdx - 20), firstDayIdx) : [];

    const context: ExtractionContext = {
      personaId: persona.id,
      channelDisplayName: persona.display_name,
      messages_context: contextMsgs,
      messages_analyze: dayMessages,
    };

    const extractionModel = settings?.extraction_model;
    queueFactFind(context, stateManager, { extraction_model: extractionModel });
    queueTopicScan(context, stateManager, { extraction_model: extractionModel });
    queuePersonScan(context, stateManager, { extraction_model: extractionModel });

    result.personasProcessed++;
    result.scansQueued += 3;
  }

  for (const room of Object.values((stateManager.getStorageState() as any).rooms ?? {})) {
    const r = room as { id: string; display_name: string; messages?: Message[] };
    if (!r.messages || r.messages.length === 0) continue;

    const dayMessages = messagesForDay(r.messages, start, end);
    if (dayMessages.length === 0) continue;
    if (!hasUnprocessed(dayMessages)) continue;

    const firstDayIdx = r.messages.findIndex((m: Message) => {
      const ts = new Date(m.timestamp).getTime();
      return ts >= start;
    });
    const contextMsgs = firstDayIdx > 0 ? r.messages.slice(Math.max(0, firstDayIdx - 20), firstDayIdx) : [];

    const context: ExtractionContext = {
      personaId: r.id,
      channelDisplayName: r.display_name,
      messages_context: contextMsgs,
      messages_analyze: dayMessages,
      roomId: r.id,
    };

    const extractionModel = settings?.extraction_model;
    queueTopicScan(context, stateManager, { extraction_model: extractionModel });
    queuePersonScan(context, stateManager, { extraction_model: extractionModel });

    result.scansQueued += 2;
  }

  result.daysQueued = 1;

  if (result.scansQueued > 0) {
    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
  }

  const isLastDay = currentDate >= today;
  advanceProgress(stateManager, currentDate, isLastDay);

  if (isLastDay) {
    result.complete = true;
    console.log(`[PersonaHistory] All days queued — marking complete`);
  } else {
    console.log(`[PersonaHistory] Day ${currentDate} queued (${result.scansQueued} scans), next: ${nextDay(currentDate)}`);
  }

  return result;
}

function findEarliestMessageDate(stateManager: StateManager): string | null {
  const personas = stateManager.persona_getAll();
  let earliest: number | null = null;

  for (const persona of personas) {
    const msgs = stateManager.messages_get(persona.id);
    for (const m of msgs) {
      const ts = new Date(m.timestamp).getTime();
      if (earliest === null || ts < earliest) earliest = ts;
    }
  }

  return earliest !== null ? new Date(earliest).toISOString().slice(0, 10) : null;
}

function advanceProgress(stateManager: StateManager, date: string, complete: boolean): void {
  const human = stateManager.getHuman();
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      personaHistory: {
        ...human.settings?.personaHistory,
        last_queued_date: date,
        ...(complete && { complete: true }),
      },
    },
  });
}

function markComplete(stateManager: StateManager): void {
  const human = stateManager.getHuman();
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      personaHistory: {
        ...human.settings?.personaHistory,
        complete: true,
      },
    },
  });
}
