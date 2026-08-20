import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message } from "../../core/types.js";
import { queuePersonaSignalScan, type ExtractionContext } from "../../core/orchestrators/human-extraction.js";
import { resolvePersonaLinkedPeople } from "../../core/utils/identifier-utils.js";
import { ensureAgentPersona, resolveCanonicalAgent } from "../../core/personas/opencode-agent.js";
import { qualifyOmpMessage } from "../../core/utils/message-id.js";
import { stripControlChars } from "../../core/utils/message-refusal.js";
import { convertToEiMessage } from "../shared/message-converter.js";
import { getMachineId } from "../machine-id.js";
import { OmpReader } from "./reader.js";
import type { OmpTranscriptRecord } from "./types.js";

export interface OmpImportResult {
  transcriptsProcessed: number;
  scansQueued: number;
  personasCreated: string[];
}

export interface OmpImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  /** Structural, not nominal — `OmpReader` itself, or any object exposing
   * the same two methods (test fixtures inject the latter). */
  reader?: Pick<OmpReader, "listTranscripts" | "readTranscript">;
  signal?: AbortSignal;
}

function updateProcessedState(stateManager: StateManager, processedSessions: Record<string, string>): void {
  const human = stateManager.getHuman();
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      omp: {
        ...human.settings?.omp,
        processed_sessions: processedSessions,
      },
    },
  });
}

/**
 * D4 (structured like `importPiSessions`): reads the
 * `human.settings.omp.processed_sessions` checkpoint, skips every
 * already-processed CD2+ transcript, and for each new one persists its
 * converted messages into the resolved subject's own Persona state (D7)
 * before queuing Bolt 004's Scan/Extract classifier
 * (`queuePersonaSignalScan`) directly against the transcript's own
 * resolved subject — the sub-agent named by its `session_init.agent`
 * (D3) — since that subject is already known from the transcript itself
 * and never needs the generic mention-detection pass.
 *
 * A transcript is checkpointed as processed only once its Scan request has
 * actually been queued (Stint holistic review Bucket 1, finding I4,
 * 2026-08-11) — never merely because it was successfully read. A malformed
 * transcript (D5), a missing-`agent` transcript (D3's fail-closed case), or
 * a zero/multi-link subject (R7 discipline) all fail BEFORE queueing, so
 * none of them is checkpointed; each remains eligible for retry on the
 * next run once its own blocker resolves (e.g. a Person link is added).
 * D8: that checkpoint write is still durable per-record, immediately after
 * each transcript's own queue outcome is known, never batched until the
 * whole loop completes — a later record's read/resolution failure (caught
 * below, D8/R7) can never replay an earlier, already-queued record on
 * the next run.
 */
export async function importOmpSessions(options: OmpImporterOptions): Promise<OmpImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const reader = options.reader ?? new OmpReader();

  const result: OmpImportResult = {
    transcriptsProcessed: 0,
    scansQueued: 0,
    personasCreated: [],
  };

  const records: OmpTranscriptRecord[] = await reader.listTranscripts();
  if (signal?.aborted) return result;

  const human = stateManager.getHuman();
  const processedSessions = { ...(human.settings?.omp?.processed_sessions ?? {}) };
  const extractionModel = human.settings?.omp?.extraction_model;

  const newRecords = records.filter((r) => !processedSessions[r.path]);
  if (newRecords.length === 0) {
    console.log("[OMP] All CD2+ transcripts processed, nothing new to import");
    return result;
  }

  for (const record of newRecords) {
    if (signal?.aborted) break;

    try {
      const session = await reader.readTranscript(record.path);
      if (!session || session.messages.length === 0) continue;

      const rawAgentId = session.provenance.agent_id;
      if (!rawAgentId) {
        // D3: session_init/agent missing entirely — no subject persona can
        // be resolved without inferring one, so this fails closed here,
        // before the transcript ever reaches Bolt 004's classifier.
        console.debug(`[OMP] ${stripControlChars(record.path)}: missing session_init.agent — skipping (no resolvable subject persona)`);
        continue;
      }
      const agentId = stripControlChars(rawAgentId); // D10: sanitized before it can reach ensureAgentPersona

      const { canonical } = resolveCanonicalAgent(agentId);
      let subjectPersona = stateManager.persona_getByName(canonical);
      if (!subjectPersona) {
        subjectPersona = await ensureAgentPersona(agentId, {
          stateManager,
          interface: eiInterface,
          reader: undefined,
        });
        result.personasCreated.push(agentId);
      }

      // R7 discipline (enumerate-all, never first-match): a subject with zero
      // or more than one linked Person record has no single, unambiguous
      // `subject_person_id` target — skip rather than guess or pick either.
      const linkedPeople = resolvePersonaLinkedPeople(subjectPersona.id, stateManager.getHuman().people);
      if (linkedPeople.length !== 1) {
        if (linkedPeople.length > 1) {
          console.warn(
            `[OMP] ${subjectPersona.display_name} is linked to multiple person records — skipping persona-signal observation for ${stripControlChars(record.path)}`
          );
        } else {
          console.debug(
            `[OMP] ${subjectPersona.display_name} has no linked Person record yet — skipping persona-signal observation for ${stripControlChars(record.path)}`
          );
        }
        continue;
      }

      // 2026-08-19 fix (message-locator round-trip): the qualified message
      // ID's "session" segment must BE the transcript's own unique
      // locator, not a lossy display label -- record.path (already the
      // full unique discriminator `listTranscripts` sorts by) is the only
      // field that both round-trips (resolveExternalMessage's own "omp"
      // case reads a transcript straight back off this exact path) and
      // never collides (two distinct transcripts always have distinct
      // paths, even when they share a filename). The old
      // `record.path.split("/").pop()` basename lost both properties:
      // unresolvable, and two differently nested same-named files with
      // colliding native ids produced identical qualified ids for
      // genuinely distinct source events.
      const sessionKey = record.path;
      const messages: Message[] = session.messages.map((m) => convertToEiMessage(m, sessionKey, qualifyOmpMessage));

      // D7 (Beta review I1, CRITICAL): persist the converted messages into
      // the subject Persona's own state BEFORE queuing the scan.
      // handlePersonaSignalScan's resolveMessageWindow resolves its analyze
      // window against state.messages_get(subjectPersona.id), never
      // against this importer-local array — a scan queued without this
      // step could never find its source quote, so every prior
      // "successful" scan produced zero observations. Mirrors
      // importPiSessions's own append -> sort lifecycle exactly.
      for (const eiMsg of messages) {
        stateManager.messages_append(subjectPersona.id, eiMsg);
      }
      stateManager.messages_sort(subjectPersona.id);
      eiInterface?.onMessageAdded?.(subjectPersona.id);

      const allInState = stateManager.messages_get(subjectPersona.id);
      const analyzeIds = new Set(messages.map((m) => m.id));
      const analyzeStartIndex = allInState.findIndex((m) => analyzeIds.has(m.id));
      const contextMsgs = analyzeStartIndex > 0 ? allInState.slice(0, analyzeStartIndex) : [];

      const context: ExtractionContext = {
        personaId: subjectPersona.id,
        channelDisplayName: subjectPersona.display_name,
        messages_context: contextMsgs,
        messages_analyze: messages,
        sources: [`omp:${getMachineId()}:${record.path}`],
      };

      // D3/D4: provenance is forwarded as-is, complete or not — Bolt 004's
      // classifier decides whether it's enough to land an Agent-lens
      // observation, never this importer.
      queuePersonaSignalScan(context, subjectPersona, linkedPeople[0].id, stateManager, extractionModel, session.provenance);

      // D8/I4 (Stint holistic review Bucket 1, 2026-08-11): checkpointed
      // durably right here, only now that the Scan request has actually
      // been queued — never earlier. A zero-link, missing-agent, or
      // malformed transcript never reaches this line, so it stays
      // eligible for retry once its own blocker resolves.
      processedSessions[record.path] = new Date().toISOString();
      updateProcessedState(stateManager, processedSessions);

      result.scansQueued++;
      result.transcriptsProcessed++;
    } catch (err) {
      // D8/R7 (Beta review I3): a per-record failure (e.g. a rejecting
      // reader) must never be checkpointed as processed, so it stays
      // eligible for retry on the next run, and must never roll back an
      // earlier record's already-durable checkpoint write above.
      console.warn(
        `[OMP] ${stripControlChars(record.path)}: failed to process — will retry next run: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (result.transcriptsProcessed > 0) {
    console.log(
      `[OMP] Import complete: ${result.transcriptsProcessed} CD2+ transcript(s) processed, ${result.scansQueued} scan(s) queued`
    );
  }

  return result;
}
