import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message, PersonaEntity, Person } from "../../core/types.js";
import type { PersonIdentifier } from "../../core/types/data-items.js";
import { ContextStatus } from "../../core/types/enums.js";
import { queueAllScans, queuePersonScan, queuePersonUpdate, type ExtractionContext } from "../../core/orchestrators/human-extraction.js";
import type { ItemMatchResult } from "../../prompts/human/types.js";
import { qualifySlackMessage } from "../../core/utils/message-id.js";
import { SLACK_PERSONA_DEFINITION } from "../../templates/slack.js";
import { SlackReader, type ResolvedMessage } from "./reader.js";
import type { SlackChannelState } from "./types.js";

const SLACK_USER_ID_KEY = "Slack User ID";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SlackImportResult {
  channelProcessed: string | null;
  messagesImported: number;
  threadsProcessed: number;
  scansQueued: number;
}

// =============================================================================
// Persona bootstrap
// =============================================================================

function ensureSlackPersona(stateManager: StateManager, eiInterface: Ei_Interface): PersonaEntity {
  const existing = stateManager.persona_getAll().find(p => p.display_name === "Slack");
  if (existing) {
    if (existing.is_archived) stateManager.persona_unarchive(existing.id);
    return existing;
  }
  const persona: PersonaEntity = {
    ...SLACK_PERSONA_DEFINITION,
    id: crypto.randomUUID(),
    display_name: "Slack",
    last_updated: new Date().toISOString(),
  };
  stateManager.persona_add(persona);
  eiInterface.onPersonaAdded?.();
  return stateManager.persona_getAll().find(p => p.display_name === "Slack")!;
}

// =============================================================================
// User → Person resolution
//
// Checks human.people identifiers for a matching Slack workspace+user ID.
// Returns the Person if found, null if unknown.
// =============================================================================

function findPersonBySlackId(workspaceId: string, userId: string, stateManager: StateManager): Person | null {
  const fqId = `${workspaceId}:${userId}`;
  return stateManager.getHuman().people.find(p =>
    p.identifiers?.some(id => id.type === SLACK_USER_ID_KEY && id.value === fqId)
  ) ?? null;
}

// =============================================================================
// Message conversion
// =============================================================================

function toEiMessage(
  msg: ResolvedMessage,
  workspaceId: string,
  channelId: string,
  isNew: boolean,
): Message {
  return {
    id: qualifySlackMessage(workspaceId, channelId, msg.ts),
    role: "system",
    content: `${msg.displayName}: ${msg.text}`,
    speaker_name: msg.displayName,
    timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
    read: true,
    context_status: ContextStatus.Default,
    external: true,
    f: isNew ? undefined : true,
    t: isNew ? undefined : true,
    p: isNew ? undefined : true,
    e: isNew ? undefined : true,
  };
}

// =============================================================================
// Queue scans for a batch of messages
//
// - Known participants (matched by Slack ID in human.people) → queuePersonUpdate
// - Unknown mentioned people → queuePersonScan with participant exclusion list
// - Topic/fact/event extraction → queueAllScans
// =============================================================================

function queueScansForMessages(
  contextMessages: Message[],
  analyzeMessages: Message[],
  participants: Array<{ userId: string; displayName: string; person: Person | null }>,
  personaId: string,
  channelName: string,
  sourceTag: string,
  workspaceId: string,
  stateManager: StateManager,
  extractionModel: string | undefined,
): number {
  let queued = 0;

  const context: ExtractionContext = {
    personaId,
    channelDisplayName: channelName,
    messages_context: contextMessages,
    messages_analyze: analyzeMessages,
    sources: [sourceTag],
  };

  // Known participants → direct person update (skip scan + match)
  const knownParticipants = participants.filter(p => p.person !== null);
  const excludedParticipants = knownParticipants.map(p => ({
    name: p.displayName,
    id: `${workspaceId}:${p.userId}`,
  }));

  for (const { displayName, userId, person } of knownParticipants) {
    const matchResult: ItemMatchResult = { matched_guid: person!.id };
    queued += queuePersonUpdate(matchResult, {
      ...context,
      candidateName: displayName,
      candidateDescription: person!.description,
      candidateRelationship: person!.relationship,
      candidateIdentifiers: [{
        type: SLACK_USER_ID_KEY,
        value: `${workspaceId}:${userId}`,
      } as PersonIdentifier],
      extraction_model: extractionModel,
    }, stateManager, person);
  }

  // Unknown mentioned people → person scan with exclusion list
  queued += queuePersonScan({
    ...context,
    excluded_participants: excludedParticipants,
  }, stateManager, {
    extraction_model: extractionModel,
    external_filter: "only",
  });

  // Topic / fact / event scans
  queueAllScans(context, stateManager, {
    extraction_model: extractionModel,
    external_filter: "only",
  });
  queued += 3; // topic, fact, event

  return queued;
}

// =============================================================================
// Main import function
// =============================================================================

export async function importSlackChannel(opts: {
  stateManager: StateManager;
  interface: Ei_Interface;
  signal?: AbortSignal;
}): Promise<SlackImportResult> {
  const { stateManager, signal } = opts;

  const result: SlackImportResult = {
    channelProcessed: null,
    messagesImported: 0,
    threadsProcessed: 0,
    scansQueued: 0,
  };

  const human = stateManager.getHuman();
  const slackSettings = human.settings?.slack;
  if (!slackSettings?.auth?.token) return result;

  const persona = ensureSlackPersona(stateManager, opts.interface);
  const reader = new SlackReader(slackSettings.auth.token);

  // Seed caches from known people identifiers
  for (const person of human.people) {
    const slackId = person.identifiers?.find(id => id.type === SLACK_USER_ID_KEY);
    if (slackId) {
      const [, userId] = slackId.value.split(":");
      if (userId) reader.seedUserCache(userId, person.name);
    }
  }

  const now = new Date().toISOString();
  const nowMs = new Date(now).getTime();

  // Refresh channel list and write last_run before API work begins
  if (signal?.aborted) return result;

  let channels = await reader.listChannels();
  const channelStates: Record<string, SlackChannelState> = { ...slackSettings.channels };

  // Seed channel name cache from saved state
  for (const [id, state] of Object.entries(channelStates)) {
    if (state.name) reader.seedChannelCache(id, state.name);
  }

  const workspaceId = slackSettings.auth?.workspace_id ?? "unknown";

  const candidate = reader.selectCandidateChannel(channels, channelStates, slackSettings, now);
  if (!candidate) return result; // all channels caught up

  const { channel, state: channelState } = candidate;
  const channelId = channel.id;
  const sourceTag = `slack:${channelId}`;

  // Write last_run BEFORE API calls (anti-duplicate guard for necro detection)
  const updatedState: SlackChannelState = {
    ...channelState,
    last_run: now,
  };

  // Resolve channel name if not cached
  if (!updatedState.name) {
    updatedState.name = await reader.resolveChannelName(channelId);
  }
  const channelName = updatedState.name ?? channelId;
  reader.seedChannelCache(channelId, channelName);

  if (signal?.aborted) return result;

  // Determine window
  const startTs = (new Date(channelState.extraction_point ?? new Date(nowMs - (slackSettings.backfill_days?.public ?? 30) * 86400_000).toISOString()).getTime() / 1000).toFixed(6);
  const endMs = Math.min(parseFloat(startTs) * 1000 + WINDOW_MS, nowMs);
  const endTs = (endMs / 1000).toFixed(6);

  // Phase 1: spine messages in window
  const spineMessages = await reader.spineMessagesBetween(channelId, startTs, endTs);
  const newThreadParents = spineMessages.filter(m => m.isThreadParent);

  if (signal?.aborted) return result;

  // Phase 2: known threads with necro replies since last_run
  const lastRunTs = channelState.last_run
    ? (new Date(channelState.last_run).getTime() / 1000).toFixed(6)
    : startTs;
  const threadMap = channelState.threads ?? {};
  const necrothreads = await reader.threadsWithUpdatesSince(channelId, threadMap, lastRunTs);

  if (signal?.aborted) return result;

  // Collect all unique participant user IDs across spine + threads
  const allMessages = [
    ...spineMessages,
    ...necrothreads.flatMap(t => t.allReplies),
  ];
  const uniqueUserIds = [...new Set(allMessages.map(m => m.userId).filter(id => id !== "unknown"))];

  // Resolve participants against human.people
  const participants = uniqueUserIds.map(userId => ({
    userId,
    displayName: allMessages.find(m => m.userId === userId)?.displayName ?? userId,
    person: findPersonBySlackId(workspaceId, userId, stateManager),
  }));

  // Build and write Ei messages for this channel (replace stale, write new)
  const existingIds = new Set(stateManager.messages_get(persona.id).map(m => m.id));

  const spineContextMessages: Message[] = spineMessages
    .map(m => toEiMessage(m, workspaceId, channelId, true))
    .filter(m => !existingIds.has(m.id));

  for (const msg of spineContextMessages) {
    stateManager.messages_append(persona.id, msg);
  }
  result.messagesImported += spineContextMessages.length;

  // Queue spine scans
  if (spineMessages.length > 0) {
    result.scansQueued += queueScansForMessages(
      [],
      spineContextMessages,
      participants,
      persona.id,
      channelName,
      sourceTag,
      workspaceId,
      stateManager,
      slackSettings.extraction_model,
    );
  }

  // Process new thread parents from the spine window
  for (const parent of newThreadParents) {
    if (signal?.aborted) break;
    const sinceTs = parent.ts; // first-ever fetch — all replies are new
    const { allReplies, newReplies } = await reader.fetchThread(channelId, parent.ts, sinceTs);

    const contextMsgs = allReplies
      .filter(r => r.ts <= sinceTs)
      .map(r => toEiMessage(r, workspaceId, channelId, false));
    const analyzeMsgs = newReplies.map(r => toEiMessage(r, workspaceId, channelId, true));

    for (const msg of [...contextMsgs, ...analyzeMsgs]) {
      if (!existingIds.has(msg.id)) stateManager.messages_append(persona.id, msg);
    }
    result.messagesImported += analyzeMsgs.length;

    if (analyzeMsgs.length > 0) {
      result.scansQueued += queueScansForMessages(
        contextMsgs, analyzeMsgs, participants,
        persona.id, channelName, sourceTag, workspaceId,
        stateManager, slackSettings.extraction_model,
      );
    }

    const latestReplyTs = allReplies.at(-1)?.ts ?? parent.ts;
    updatedState.threads = { ...updatedState.threads, [parent.ts]: latestReplyTs };
    result.threadsProcessed++;
  }

  // Process necro threads
  for (const { threadTs, newReplies, allReplies } of necrothreads) {
    if (signal?.aborted) break;
    const lastSeen = threadMap[threadTs] ?? threadTs;

    const contextMsgs = allReplies
      .filter(r => r.ts <= lastSeen)
      .map(r => toEiMessage(r, workspaceId, channelId, false));
    const analyzeMsgs = newReplies.map(r => toEiMessage(r, workspaceId, channelId, true));

    for (const msg of analyzeMsgs) {
      if (!existingIds.has(msg.id)) stateManager.messages_append(persona.id, msg);
    }
    result.messagesImported += analyzeMsgs.length;

    if (analyzeMsgs.length > 0) {
      result.scansQueued += queueScansForMessages(
        contextMsgs, analyzeMsgs, participants,
        persona.id, channelName, sourceTag, workspaceId,
        stateManager, slackSettings.extraction_model,
      );
    }

    const latestReplyTs = allReplies.at(-1)?.ts ?? lastSeen;
    updatedState.threads = { ...updatedState.threads, [threadTs]: latestReplyTs };
    result.threadsProcessed++;
  }

  // Advance extraction_point to end of processed window
  updatedState.extraction_point = new Date(endMs).toISOString();

  // Persist updated channel state
  const updatedHuman = stateManager.getHuman();
  stateManager.setHuman({
    ...updatedHuman,
    settings: {
      ...updatedHuman.settings,
      slack: {
        ...updatedHuman.settings?.slack,
        channels: {
          ...updatedHuman.settings?.slack?.channels,
          [channelId]: updatedState,
        },
      },
    },
  });

  result.channelProcessed = channelName;
  return result;
}
