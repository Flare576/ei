import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  ValidationLevel,
  RESERVED_PERSONA_NAMES,
  isReservedPersonaName,
  type LLMRequest,
  type Ei_Interface,
  type PersonaSummary,
  type PersonaEntity,
  type PersonaCreationInput,
  type Message,
  type MessageQueryOptions,
  type HumanEntity,
  type Fact,
  type Trait,
  type Topic,
  type Person,
  type Quote,
  type QueueStatus,
  type ContextStatus,
  type DataItemBase,
  type LLMResponse,
  type StorageState,
  type StateConflictResolution,
  type StateConflictData,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import { remoteSync } from "../storage/remote.js";
import { yoloMerge } from "../storage/merge.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import { handlers } from "./handlers/index.js";
import {
  buildResponsePrompt,
  buildPersonaTraitExtractionPrompt,
  buildHeartbeatCheckPrompt,
  buildEiHeartbeatPrompt,
  type ResponsePromptData,
  type PersonaTraitExtractionPromptData,
  type HeartbeatCheckPromptData,
  type EiHeartbeatPromptData,
  type EiHeartbeatItem,
} from "../prompts/index.js";
import { 
  orchestratePersonaGeneration,
  queueFactScan,
  queueTopicScan,
  queuePersonScan,
  shouldStartCeremony,
  startCeremony,
  handleCeremonyProgress,
  type ExtractionContext,
} from "./orchestrators/index.js";
import { EI_WELCOME_MESSAGE, EI_PERSONA_DEFINITION } from "../templates/welcome.js";
import { getEmbeddingService, findTopK, needsEmbeddingUpdate, needsQuoteEmbeddingUpdate, computeDataItemEmbedding, computeQuoteEmbedding } from "./embedding-service.js";
import { ContextStatus as ContextStatusEnum } from "./types.js";
import { buildChatMessageContent } from "../prompts/message-utils.js";

// =============================================================================
// EMBEDDING STRIPPING - Remove embeddings from data items before returning to FE
// Embeddings are internal implementation details for similarity search.
// =============================================================================

function stripDataItemEmbedding<T extends DataItemBase>(item: T): T {
  const { embedding, ...rest } = item;
  return rest as T;
}

function stripQuoteEmbedding(quote: Quote): Quote {
  const { embedding, ...rest } = quote;
  return rest;
}

function stripHumanEmbeddings(human: HumanEntity): HumanEntity {
  return {
    ...human,
    facts: (human.facts ?? []).map(stripDataItemEmbedding),
    traits: (human.traits ?? []).map(stripDataItemEmbedding),
    topics: (human.topics ?? []).map(stripDataItemEmbedding),
    people: (human.people ?? []).map(stripDataItemEmbedding),
    quotes: (human.quotes ?? []).map(stripQuoteEmbedding),
  };
}

const DEFAULT_LOOP_INTERVAL_MS = 100;
const DEFAULT_CONTEXT_WINDOW_HOURS = 8;
const DEFAULT_OPENCODE_POLLING_MS = 1800000;

let processorInstanceCount = 0;

export function filterMessagesForContext(
  messages: Message[],
  contextBoundary: string | undefined,
  contextWindowHours: number
): Message[] {
  if (messages.length === 0) return [];

  const now = Date.now();
  const windowStartMs = now - contextWindowHours * 60 * 60 * 1000;
  const boundaryMs = contextBoundary ? new Date(contextBoundary).getTime() : 0;

  return messages.filter((msg) => {
    if (msg.context_status === ContextStatusEnum.Always) return true;
    if (msg.context_status === ContextStatusEnum.Never) return false;

    const msgMs = new Date(msg.timestamp).getTime();

    if (contextBoundary) {
      return msgMs >= boundaryMs;
    }

    return msgMs >= windowStartMs;
  });
}

export class Processor {
  private stateManager = new StateManager();
  private queueProcessor = new QueueProcessor();
  private interface: Ei_Interface;
  private running = false;
  private stopped = false;
  private instanceId: number;
  private currentRequest: LLMRequest | null = null;
  private isTUI = false;
  private lastOpenCodeSync = 0;
  private lastDLQTrim = 0;
  private openCodeImportInProgress = false;
  private pendingConflict: StateConflictData | null = null;

  constructor(ei: Ei_Interface) {
    this.interface = ei;
    this.instanceId = ++processorInstanceCount;
    console.log(`[Processor ${this.instanceId}] CREATED`);
    this.detectEnvironment();
  }
  
  private detectEnvironment(): void {
    const hasProcess = typeof process !== "undefined" && typeof process.versions !== "undefined";
    const hasBun = hasProcess && typeof process.versions.bun !== "undefined";
    const hasNode = hasProcess && typeof process.versions.node !== "undefined";
    const hasDocument = typeof document !== "undefined";
    
    this.isTUI = (hasBun || hasNode) && !hasDocument;
  }

  async start(storage: Storage): Promise<void> {
    console.log(`[Processor ${this.instanceId}] start() called`);
    await this.stateManager.initialize(storage);
    if (this.stopped) {
      console.log(`[Processor ${this.instanceId}] stopped during init, not starting loop`);
      return;
    }

    // === SYNC DECISION TREE ===
    const primary = this.stateManager.hasExistingData();
    const backup = await this.stateManager.loadBackup();
    const syncCreds = primary
      ? this.stateManager.getHuman().settings?.sync
      : backup?.human?.settings?.sync;
    // Sync creds can come from state/backup OR from pre-configuration
    // (TUI pre-configures from env vars, Web from onboarding form)
    const hasSyncCreds = !!(syncCreds?.username && syncCreds?.passphrase);
    if (hasSyncCreds || remoteSync.isConfigured()) {
      // State/backup creds always win over env var pre-config
      // (env vars bootstrap you; once creds are in state, state is source of truth)
      if (hasSyncCreds) {
        await remoteSync.configure(syncCreds);
      }

      try {
        const remoteInfo = await remoteSync.checkRemote(); // also captures etag
        if (!primary && remoteInfo.exists) {
          // CASE A: No primary state (clean exit or fresh install with env vars)
          // → Silent pull, no questions asked
          console.log(`[Processor ${this.instanceId}] No primary state, remote exists — silent pull`);
          const result = await remoteSync.fetch(); // captures etag
          if (result.success && result.state) {
            this.stateManager.restoreFromState(result.state);
          }
          // If fetch fails, fall through to bootstrapFirstRun below
        } else if (primary && remoteInfo.exists) {
          // CASE B: Both primary AND remote exist
          // This means: crash recovery, stale etag rejection, or multi-device conflict
          // → ALWAYS ask user: [L]ocal / [S]erver / [Y]olo
          console.log(`[Processor ${this.instanceId}] Both primary and remote exist — conflict`);
          const localTimestamp = new Date(this.stateManager.getHuman().last_updated);
          const remoteTimestamp = remoteInfo.lastModified ?? new Date();
          this.pendingConflict = { localTimestamp, remoteTimestamp, hasLocalState: true };
          this.interface.onStateConflict?.(this.pendingConflict);
          // Loop does NOT start — waits for resolveStateConflict()
          return;
        }
        // primary exists, no remote → normal boot (first time syncing from this device)
        // no primary, no remote → fall through to bootstrapFirstRun
      } catch (err) {
        console.warn(`[Processor ${this.instanceId}] Sync check failed, continuing without sync:`, err);
      }
    }
    // If still no data after sync attempts, bootstrap
    if (!this.stateManager.hasExistingData() || this.stateManager.persona_getAll().length === 0) {
      await this.bootstrapFirstRun();
    }
    this.running = true;
    console.log(`[Processor ${this.instanceId}] initialized, starting loop`);
    this.runLoop();
  }

  private async bootstrapFirstRun(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] First run detected, bootstrapping Ei`);

    const human = this.stateManager.getHuman();
    this.stateManager.setHuman({
      ...human,
      settings: {
        ...human.settings,
        ceremony: {
          time: human.settings?.ceremony?.time ?? "09:00",
          last_ceremony: new Date().toISOString(),
        },
      },
    });

    const eiEntity: PersonaEntity = {
      ...EI_PERSONA_DEFINITION,
      id: "ei",
      display_name: "Ei",
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    };
    this.stateManager.persona_add(eiEntity);

    const welcomeMessage: Message = {
      id: crypto.randomUUID(),
      role: "system",
      verbal_response: EI_WELCOME_MESSAGE,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: ContextStatusEnum.Always,
    };
    this.stateManager.messages_append(eiEntity.id, welcomeMessage);

    this.interface.onPersonaAdded?.();
    this.interface.onMessageAdded?.(eiEntity.id);
  }

  async stop(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] stop() called, running=${this.running}, stopped=${this.stopped}`);
    this.stopped = true;

    if (!this.running) {
      console.log(`[Processor ${this.instanceId}] not running, skipping save`);
      return;
    }

    this.running = false;
    this.queueProcessor.abort();
    await this.stateManager.flush();
    console.log(`[Processor ${this.instanceId}] stopped`);
  }

  async saveAndExit(): Promise<{ success: boolean; error?: string }> {
    console.log(`[Processor ${this.instanceId}] saveAndExit() called`);
    this.interface.onSaveAndExitStart?.();

    this.queueProcessor.abort();
    if (this.openCodeImportInProgress) {
      console.log(`[Processor ${this.instanceId}] Aborting OpenCode import in progress`);
      this.openCodeImportInProgress = false;
    }

    await this.stateManager.flush();

    const human = this.stateManager.getHuman();
    const hasSyncCreds = !!human.settings?.sync?.username && !!human.settings?.sync?.passphrase;

    if (hasSyncCreds && remoteSync.isConfigured()) {
      const state = this.stateManager.getStorageState();
      const result = await remoteSync.sync(state);
      
      if (!result.success) {
        // Push failed — likely 412 etag mismatch or network error
        // Do NOT moveToBackup — leave state.json intact
        // Next boot will detect primary + remote → conflict resolution
        console.log(`[Processor ${this.instanceId}] Remote sync failed: ${result.error}`);
        await this.stop();
        this.interface.onSaveAndExitFinish?.();
        return { success: false, error: result.error };
      }

      await this.stateManager.moveToBackup();
      console.log(`[Processor ${this.instanceId}] State moved to backup after successful sync`);
    }

    await this.stop();
    this.interface.onSaveAndExitFinish?.();
    return { success: true };
  }


  async resolveStateConflict(resolution: StateConflictResolution): Promise<void> {
    if (!this.pendingConflict) return;

    switch (resolution) {
      case "local":
        // Keep local, push to server on next exit
        break;
      case "server": {
        const result = await remoteSync.fetch(); // gets fresh etag
        if (result.success && result.state) {
          this.stateManager.restoreFromState(result.state);
        }
        break;
      }
      case "yolo": {
        const localState = this.stateManager.getStorageState();
        const remoteResult = await remoteSync.fetch(); // gets fresh etag
        if (remoteResult.success && remoteResult.state) {
          const merged = yoloMerge(localState, remoteResult.state);
          this.stateManager.restoreFromState(merged);
        }
        break;
      }
    }

    this.pendingConflict = null;
    this.running = true;
    this.runLoop();
    this.interface.onStateImported?.();
  }

  private async runLoop(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] runLoop() started`);
    while (this.running) {
      await this.checkScheduledTasks();

      if (this.queueProcessor.getState() === "idle") {
        const retryAfter = this.stateManager.queue_nextItemRetryAfter();
        const isBackingOff = retryAfter !== null && retryAfter > new Date().toISOString();

        if (!isBackingOff) {
          const request = this.stateManager.queue_claimHighest();
          if (request) {
            const personaId = request.data.personaId as string | undefined;
            const personaDisplayName = request.data.personaDisplayName as string | undefined;
            const personaSuffix = personaDisplayName ? ` [${personaDisplayName}]` : "";
            console.log(`[Processor ${this.instanceId}] processing request: ${request.next_step}${personaSuffix}`);
            this.currentRequest = request;

            if (personaId && request.next_step === LLMNextStep.HandlePersonaResponse) {
              this.interface.onMessageProcessing?.(personaId);
            }

            this.queueProcessor.start(request, async (response) => {
              this.currentRequest = null;
              await this.handleResponse(response);
              const nextState = this.stateManager.queue_isPaused() ? "paused" : "idle";
              // the processor state is set in the caller, so this needs a bit of delay
              setTimeout(() => this.interface.onQueueStateChanged?.(nextState), 0);
            }, {
              accounts: this.stateManager.getHuman().settings?.accounts,
              messageFetcher: (pName) => this.fetchMessagesForLLM(pName),
              rawMessageFetcher: (pName) => this.stateManager.messages_get(pName),
            });

            this.interface.onQueueStateChanged?.("busy");
          }
        }
      }

      await this.sleep(DEFAULT_LOOP_INTERVAL_MS);
    }
    console.log(`[Processor ${this.instanceId}] runLoop() exited`);
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = Date.now();
    const DEFAULT_HEARTBEAT_DELAY_MS = 1800000; //5 * 60 * 1000;//

    const human = this.stateManager.getHuman();
    
    if (this.isTUI && human.settings?.opencode?.integration && this.stateManager.queue_length() === 0) {
      await this.checkAndSyncOpenCode(human, now);
    }
    
    if (human.settings?.ceremony && shouldStartCeremony(human.settings.ceremony, this.stateManager)) {
      // Auto-backup to remote before ceremony (if configured)
      if (human.settings?.sync && remoteSync.isConfigured()) {
        const state = this.stateManager.getStorageState();
        const result = await remoteSync.sync(state);
        if (!result.success) {
          console.warn(`[Processor] Pre-ceremony remote backup failed: ${result.error}`);
        }
      }
      startCeremony(this.stateManager);
    }

    for (const persona of this.stateManager.persona_getAll()) {
      if (persona.is_paused || persona.is_archived) continue;

      const heartbeatDelay = persona.heartbeat_delay_ms ?? DEFAULT_HEARTBEAT_DELAY_MS;
      const lastActivity = persona.last_activity ? new Date(persona.last_activity).getTime() : 0;
      const timeSinceActivity = now - lastActivity;

      if (timeSinceActivity >= heartbeatDelay) {
        const lastHeartbeat = persona.last_heartbeat
          ? new Date(persona.last_heartbeat).getTime()
          : 0;
        const timeSinceHeartbeat = now - lastHeartbeat;

        if (timeSinceHeartbeat >= heartbeatDelay) {
          this.queueHeartbeatCheck(persona.id);
        }
      }
    }
    // DLQ rolloff — once per day
    const MS_PER_DAY = 86_400_000;
    if (now - this.lastDLQTrim >= MS_PER_DAY) {
      this.lastDLQTrim = now;
      const trimmed = this.stateManager.queue_trimDLQ();
      if (trimmed > 0) {
        console.log(`[Processor] DLQ trim: removed ${trimmed} expired items`);
      }
    }
  }

  private async checkAndSyncOpenCode(human: HumanEntity, now: number): Promise<void> {
    if (this.openCodeImportInProgress) {
      return;
    }

    const opencode = human.settings?.opencode;
    const pollingInterval = opencode?.polling_interval_ms ?? DEFAULT_OPENCODE_POLLING_MS;
    const lastSync = opencode?.last_sync
      ? new Date(opencode.last_sync).getTime()
      : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastOpenCodeSync > 0) {
      return;
    }

    this.lastOpenCodeSync = now;
    const syncTimestamp = new Date().toISOString();
    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        opencode: {
          ...opencode,
          last_sync: syncTimestamp,
        },
      },
    });

    this.openCodeImportInProgress = true;
    import("../integrations/opencode/importer.js")
      .then(({ importOpenCodeSessions }) =>
        importOpenCodeSessions({
          stateManager: this.stateManager,
          interface: this.interface,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] OpenCode sync complete: ${result.sessionsProcessed} sessions, ` +
            `${result.topicsCreated} topics created, ${result.messagesImported} messages imported, ` +
            `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] OpenCode sync failed:`, err);
      })
      .finally(() => {
        this.openCodeImportInProgress = false;
      });
  }

  private getModelForPersona(personaId?: string): string | undefined {
    const human = this.stateManager.getHuman();
    if (personaId) {
      const persona = this.stateManager.persona_getById(personaId);
      return persona?.model || human.settings?.default_model;
    }
    return human.settings?.default_model;
  }

  private fetchMessagesForLLM(personaId: string): import("./types.js").ChatMessage[] {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return [];

    const history = this.stateManager.messages_get(personaId);
    const contextWindowHours = persona.context_window_hours ?? DEFAULT_CONTEXT_WINDOW_HOURS;
    const filteredHistory = filterMessagesForContext(
      history,
      persona.context_boundary,
      contextWindowHours
    );
    
    return filteredHistory
      .reduce<import("./types.js").ChatMessage[]>((acc, m) => {
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

  private async queueHeartbeatCheck(personaId: string): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;
    this.stateManager.persona_update(personaId, { last_heartbeat: new Date().toISOString() });
    const human = this.stateManager.getHuman();
    const history = this.stateManager.messages_get(personaId);
    if (personaId === "ei") {
      await this.queueEiHeartbeat(human, history);
      return;
    }

    const filteredHuman = await this.filterHumanDataByVisibility(human, persona);
    const inactiveDays = persona.last_activity
      ? Math.floor((Date.now() - new Date(persona.last_activity).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const sortByEngagementGap = <T extends { exposure_desired: number; exposure_current: number }>(items: T[]): T[] =>
      [...items].sort((a, b) => (b.exposure_desired - b.exposure_current) - (a.exposure_desired - a.exposure_current));
    const promptData: HeartbeatCheckPromptData = {
      persona: {
        name: persona.display_name,
        traits: persona.traits,
        topics: persona.topics,
      },
      human: {
        topics: sortByEngagementGap(filteredHuman.topics).slice(0, 5),
        people: sortByEngagementGap(filteredHuman.people).slice(0, 5),
      },
      recent_history: history.slice(-10),
      inactive_days: inactiveDays,
    };

    const prompt = buildHeartbeatCheckPrompt(promptData);

    this.stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHeartbeatCheck,
      model: this.getModelForPersona(personaId),
      data: { personaId, personaDisplayName: persona.display_name },
    });
  }

  private async queueEiHeartbeat(human: HumanEntity, history: import("./types.js").Message[]): Promise<void> {
    const now = Date.now();
    const engagementGapThreshold = 0.2;
    const cooldownMs = 7 * 24 * 60 * 60 * 1000;
    const personas = this.stateManager.persona_getAll();
    const items: EiHeartbeatItem[] = [];

    const unverifiedFacts = human.facts
      .filter(f => f.validated === ValidationLevel.None && f.learned_by !== "ei" && (f.last_changed_by === undefined || f.last_changed_by !== "ei"))
      .slice(0, 5);
    for (const fact of unverifiedFacts) {
      const quote = human.quotes.find(q => q.data_item_ids.includes(fact.id));
      items.push({
        id: fact.id,
        type: "Fact Check",
        name: fact.name,
        description: fact.description,
        quote: quote?.text,
      });
    }

    const underEngagedPeople = human.people
      .filter(p =>
        (p.exposure_desired - p.exposure_current) > engagementGapThreshold &&
        (!p.last_ei_asked || now - new Date(p.last_ei_asked).getTime() > cooldownMs)
      )
      .sort((a, b) => (b.exposure_desired - b.exposure_current) - (a.exposure_desired - a.exposure_current))
      .slice(0, 5);
    for (const person of underEngagedPeople) {
      const gap = Math.round((person.exposure_desired - person.exposure_current) * 100);
      const quote = human.quotes.find(q => q.data_item_ids.includes(person.id));
      items.push({
        id: person.id,
        type: "Low-Engagement Person",
        engagement_delta: `${gap}%`,
        relationship: person.relationship,
        name: person.name,
        description: person.description,
        quote: quote?.text,
      });
    }

    const underEngagedTopics = human.topics
      .filter(t =>
        (t.exposure_desired - t.exposure_current) > engagementGapThreshold &&
        (!t.last_ei_asked || now - new Date(t.last_ei_asked).getTime() > cooldownMs)
      )
      .sort((a, b) => (b.exposure_desired - b.exposure_current) - (a.exposure_desired - a.exposure_current))
      .slice(0, 5);
    for (const topic of underEngagedTopics) {
      const gap = Math.round((topic.exposure_desired - topic.exposure_current) * 100);
      const quote = human.quotes.find(q => q.data_item_ids.includes(topic.id));
      items.push({
        id: topic.id,
        type: "Low-Engagement Topic",
        engagement_delta: `${gap}%`,
        name: topic.name,
        description: topic.description,
        quote: quote?.text,
      });
    }

    const activePersonas = personas
      .filter(p => !p.is_archived && !p.is_paused && p.id !== "ei")
      .map(p => {
        const msgs = this.stateManager.messages_get(p.id);
        const lastHuman = [...msgs].reverse().find(m => m.role === "human");
        const lastTs = lastHuman?.timestamp ? new Date(lastHuman.timestamp).getTime() : 0;
        return { persona: p, lastHumanTs: lastTs };
      })
      .filter(({ lastHumanTs }) => {
        const daysSince = (now - lastHumanTs) / (1000 * 60 * 60 * 24);
        return daysSince >= 3;
      })
      .sort((a, b) => a.lastHumanTs - b.lastHumanTs)
      .slice(0, 3);
    for (const { persona: p, lastHumanTs } of activePersonas) {
      const daysSince = lastHumanTs > 0
        ? Math.floor((now - lastHumanTs) / (1000 * 60 * 60 * 24))
        : 999;
      items.push({
        id: p.id,
        type: "Inactive Persona",
        name: p.display_name,
        short_description: p.short_description,
        days_inactive: daysSince,
      });
    }

    if (items.length === 0) {
      console.log("[queueEiHeartbeat] No items to address, skipping");
      return;
    }

    const promptData: EiHeartbeatPromptData = {
      items,
      recent_history: history.slice(-10),
    };

    const prompt = buildEiHeartbeatPrompt(promptData);

    this.stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleEiHeartbeat,
      model: this.getModelForPersona("ei"),
      data: { personaId: "ei", isTUI: this.isTUI },
    });
  }


  private classifyLLMError(error: string): string {
    const match = error.match(/\((\d{3})\)/);
    if (match) {
      const status = parseInt(match[1], 10);
      if (status === 429) return "LLM_RATE_LIMITED";
      if (status === 401 || status === 403) return "LLM_AUTH_ERROR";
      if (status >= 500) return "LLM_SERVER_ERROR";
      if (status >= 400) return "LLM_REQUEST_ERROR";
    }
    if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(error)) {
      return "LLM_TIMEOUT";
    }
    return "LLM_ERROR";
  }
  private async handleResponse(response: LLMResponse): Promise<void> {
    if (!response.success) {
      const errorMsg = response.error ?? "Unknown LLM error";
      const result = this.stateManager.queue_fail(response.request.id, errorMsg);
      const code = this.classifyLLMError(errorMsg);

      let message = errorMsg;
      if (!result.dropped && result.retryDelay != null) {
        message += ` (attempt ${response.request.attempts}, retrying in ${Math.round(result.retryDelay / 1000)}s)`;
      } else if (result.dropped) {
        message += " (permanent failure \u2014 request removed)";
      }

      this.interface.onError?.({ code, message });
      return;
    }

    const handler = handlers[response.request.next_step as LLMNextStep];
    if (!handler) {
      const errorMsg = `No handler for ${response.request.next_step}`;
      this.stateManager.queue_fail(response.request.id, errorMsg, true);
      this.interface.onError?.({
        code: "HANDLER_NOT_FOUND",
        message: `${errorMsg} (permanent failure \u2014 request removed)`,
      });
      return;
    }

    try {
      await handler(response, this.stateManager);
      this.stateManager.queue_complete(response.request.id);

      if (response.request.next_step === LLMNextStep.HandlePersonaResponse) {
        // Always notify FE - even without content, user's message was "read" by the persona
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onMessageAdded?.(personaId);
        }
      }

      if (response.request.next_step === LLMNextStep.HandleOneShot) {
        const guid = response.request.data.guid as string;
        const content = response.content ?? "";
        this.interface.onOneShotReturned?.(guid, content);
      }

      if (response.request.next_step === LLMNextStep.HandlePersonaGeneration) {
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onPersonaUpdated?.(personaId);
        }
      }

      if (response.request.next_step === LLMNextStep.HandlePersonaDescriptions) {
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onPersonaUpdated?.(personaId);
        }
      }

      if (
        response.request.next_step === LLMNextStep.HandlePersonaTraitExtraction ||
        response.request.next_step === LLMNextStep.HandlePersonaTopicScan ||
        response.request.next_step === LLMNextStep.HandlePersonaTopicMatch ||
        response.request.next_step === LLMNextStep.HandlePersonaTopicUpdate
      ) {
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onPersonaUpdated?.(personaId);
        }
      }

      if (response.request.next_step === LLMNextStep.HandleHeartbeatCheck ||
          response.request.next_step === LLMNextStep.HandleEiHeartbeat) {
        const personaId = response.request.data.personaId as string ?? "ei";
        if (response.content) {
          this.interface.onMessageAdded?.(personaId);
        }
      }



      if (response.request.next_step === LLMNextStep.HandleHumanItemUpdate) {
        this.interface.onHumanUpdated?.();
        this.interface.onQuoteAdded?.();
      }

      if (response.request.data.ceremony_progress) {
        handleCeremonyProgress(this.stateManager);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result = this.stateManager.queue_fail(response.request.id, errorMsg);

      let message = errorMsg;
      if (!result.dropped && result.retryDelay != null) {
        message += ` (attempt ${response.request.attempts}, retrying in ${Math.round(result.retryDelay / 1000)}s)`;
      } else if (result.dropped) {
        message += " (permanent failure \u2014 request removed)";
      }
      this.interface.onError?.({
        code: "HANDLER_ERROR",
        message,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getPersonaList(): Promise<PersonaSummary[]> {
    return this.stateManager.persona_getAll().map((entity) => {
      return {
        id: entity.id,
        display_name: entity.display_name,
        aliases: entity.aliases ?? [],
        short_description: entity.short_description,
        is_paused: entity.is_paused,
        is_archived: entity.is_archived,
        unread_count: this.stateManager.messages_countUnread(entity.id),
        last_activity: entity.last_activity,
        context_boundary: entity.context_boundary,
      };
    });
  }

  /**
   * Resolve a persona name or alias to its ID.
   * Use this when the user types a name (e.g., "/persona Bob").
   * Returns null if no matching persona is found.
   */
  async resolvePersonaName(nameOrAlias: string): Promise<string | null> {
    const persona = this.stateManager.persona_getByName(nameOrAlias);
    return persona?.id ?? null;
  }

  async getPersona(personaId: string): Promise<PersonaEntity | null> {
    return this.stateManager.persona_getById(personaId);
  }

  async createPersona(input: PersonaCreationInput): Promise<string> {
    if (isReservedPersonaName(input.name)) {
      throw new Error(`Cannot create persona with reserved name "${input.name}". Reserved names: ${RESERVED_PERSONA_NAMES.join(", ")}`);
    }
    const now = new Date().toISOString();
    const DEFAULT_GROUP = "General";
    const personaId = crypto.randomUUID();
    const placeholder: PersonaEntity = {
      id: personaId,
      display_name: input.name,
      entity: "system",
      aliases: input.aliases ?? [input.name],
      short_description: input.short_description,
      long_description: input.long_description,
      model: input.model,
      group_primary: input.group_primary ?? DEFAULT_GROUP,
      groups_visible: input.groups_visible ?? [DEFAULT_GROUP],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: now,
      last_activity: now,
    };
    this.stateManager.persona_add(placeholder);
    this.interface.onPersonaAdded?.();

    orchestratePersonaGeneration(
      { ...input, id: personaId },
      this.stateManager,
      () => this.interface.onPersonaUpdated?.(placeholder.display_name)
    );

    return personaId;
  }

  async archivePersona(personaId: string): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;
    this.stateManager.persona_archive(personaId);
    this.interface.onPersonaRemoved?.();
  }

  async unarchivePersona(personaId: string): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;
    this.stateManager.persona_unarchive(personaId);
    this.interface.onPersonaAdded?.();
  }

  async deletePersona(personaId: string, _deleteHumanData: boolean): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;
    this.stateManager.persona_delete(personaId);
    this.interface.onPersonaRemoved?.();
  }

  async updatePersona(personaId: string, updates: Partial<PersonaEntity>): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;
    this.stateManager.persona_update(personaId, updates);
    this.interface.onPersonaUpdated?.(personaId);
  }

  async getGroupList(): Promise<string[]> {
    const personas = this.stateManager.persona_getAll();
    const groups = new Set<string>();
    for (const p of personas) {
      if (p.group_primary) groups.add(p.group_primary);
      for (const g of p.groups_visible || []) groups.add(g);
    }
    return [...groups].sort();
  }

  async getMessages(personaId: string, _options?: MessageQueryOptions): Promise<Message[]> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return [];
    return this.stateManager.messages_get(personaId);
  }

  async markMessageRead(personaId: string, messageId: string): Promise<boolean> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return false;
    return this.stateManager.messages_markRead(personaId, messageId);
  }

  async markAllMessagesRead(personaId: string): Promise<number> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return 0;
    return this.stateManager.messages_markAllRead(personaId);
  }

  private clearPendingRequestsFor(personaId: string): boolean {
    const responsesToClear = [
      LLMNextStep.HandlePersonaResponse,
      LLMNextStep.HandlePersonaTraitExtraction,
      LLMNextStep.HandlePersonaTopicScan,
      LLMNextStep.HandlePersonaTopicMatch,
      LLMNextStep.HandlePersonaTopicUpdate,
    ];

    let removedAny = false;
    for (const nextStep of responsesToClear) {
      const removedIds = this.stateManager.queue_clearPersonaResponses(personaId, nextStep);
      if (removedIds.length > 0) removedAny = true;
    }

    const currentMatchesPersona = this.currentRequest &&
      responsesToClear.includes(this.currentRequest.next_step as LLMNextStep) &&
      this.currentRequest.data.personaId === personaId;

    if (currentMatchesPersona) {
      this.queueProcessor.abort();
      return true;
    }

    return removedAny;
  }

  async recallPendingMessages(personaId: string): Promise<string> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return "";
    this.clearPendingRequestsFor(personaId);
    const messages = this.stateManager.messages_get(personaId);
    const pendingIds = messages
      .filter(m => m.role === "human" && !m.read)
      .map(m => m.id);
    if (pendingIds.length === 0) return "";
    const removed = this.stateManager.messages_remove(personaId, pendingIds);
    const recalledContent = removed.map(m => m.verbal_response ?? '').join("\n\n");
    this.interface.onMessageAdded?.(personaId);
    this.interface.onMessageRecalled?.(personaId, recalledContent);
    return recalledContent;
  }

  async sendMessage(personaId: string, content: string): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) {
      this.interface.onError?.({
        code: "PERSONA_NOT_FOUND",
        message: `Persona with ID "${personaId}" not found`,
      });
      return;
    }

    this.clearPendingRequestsFor(personaId);

    const message: Message = {
      id: crypto.randomUUID(),
      role: "human",
      verbal_response: content,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: "default" as ContextStatus,
    };
    this.stateManager.messages_append(persona.id, message);
    this.interface.onMessageAdded?.(persona.id);

    const promptData = await this.buildResponsePromptData(persona, content);
    const prompt = buildResponsePrompt(promptData);

    this.stateManager.queue_enqueue({
      type: LLMRequestType.Response,
      priority: LLMPriority.High,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandlePersonaResponse,
      model: this.getModelForPersona(persona.id),
      data: { personaId: persona.id, personaDisplayName: persona.display_name },
    });
    this.interface.onMessageQueued?.(persona.id);

    const history = this.stateManager.messages_get(persona.id);
    
    const traitExtractionData: PersonaTraitExtractionPromptData = {
      persona_name: persona.display_name,
      current_traits: persona.traits,
      messages_context: history.slice(0, -1),
      messages_analyze: [message],
    };
    const traitPrompt = buildPersonaTraitExtractionPrompt(traitExtractionData);

    this.stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: traitPrompt.system,
      user: traitPrompt.user,
      next_step: LLMNextStep.HandlePersonaTraitExtraction,
      model: this.getModelForPersona(persona.id),
      data: { personaId: persona.id, personaDisplayName: persona.display_name },
    });

    this.checkAndQueueHumanExtraction(persona.id, persona.display_name, history);
  }

  /**
   * Flare Note: I've gone back and forth on this several times, and want to leave a note for myself here:
   * ***This is fine.***
   * The effect here is that, if a person has 5 facts already, starts a new persona and says:
   *   "My name is Inigo Montoya"
   * Then switches away, we won't process that message or the persona response for facts (or quotes about facts) until
   * the Ceremony.
   * And that's ***OK***
   * The ONLY reason you need the facts on the Human record is so other Personas know _some_ information about the
   * Human - the persona you just told it to will have it in it's context for their conversation, and we already know 5
   * things **in that category** about them.
   * 
   * TRAIT EXTRACTION NOTE: Traits are intentionally NOT extracted here. They're stable personality patterns that:
   * 1. Don't change from message to message
   * 2. Need more conversational data to identify accurately
   * 3. Were causing massive queue bloat with cascading updates
   * Trait extraction happens during Ceremony only, where we have a full day's context.
   */
  private checkAndQueueHumanExtraction(personaId: string, personaDisplayName: string, history: Message[]): void {
    const human = this.stateManager.getHuman();
    
    const unextractedFacts = this.stateManager.messages_getUnextracted(personaId, "f");
    if (human.facts.length < unextractedFacts.length) {
      const context: ExtractionContext = {
        personaId,
        personaDisplayName,
        messages_context: history.filter(m => m.f === true),
        messages_analyze: unextractedFacts,
        extraction_flag: "f",
      };
      queueFactScan(context, this.stateManager);
      console.log(`[Processor] Human Seed extraction: facts (${human.facts.length} < ${unextractedFacts.length} unextracted)`);
    }

    const unextractedTopics = this.stateManager.messages_getUnextracted(personaId, "p");
    if (human.topics.length < unextractedTopics.length) {
      const context: ExtractionContext = {
        personaId,
        personaDisplayName,
        messages_context: history.filter(m => m.p === true),
        messages_analyze: unextractedTopics,
        extraction_flag: "p",
      };
      queueTopicScan(context, this.stateManager);
      console.log(`[Processor] Human Seed extraction: topics (${human.topics.length} < ${unextractedTopics.length} unextracted)`);
    }

    const unextractedPeople = this.stateManager.messages_getUnextracted(personaId, "o");
    if (human.people.length < unextractedPeople.length) {
      const context: ExtractionContext = {
        personaId,
        personaDisplayName,
        messages_context: history.filter(m => m.o === true),
        messages_analyze: unextractedPeople,
        extraction_flag: "o",
      };
      queuePersonScan(context, this.stateManager);
      console.log(`[Processor] Human Seed extraction: people (${human.people.length} < ${unextractedPeople.length} unextracted)`);
    }
  }

  private async buildResponsePromptData(persona: PersonaEntity, currentMessage?: string): Promise<ResponsePromptData> {
    const human = this.stateManager.getHuman();
    const filteredHuman = await this.filterHumanDataByVisibility(human, persona, currentMessage);
    const visiblePersonas = this.getVisiblePersonas(persona);
    const messages = this.stateManager.messages_get(persona.id);
    const previousMessage = messages.length >= 2 ? messages[messages.length - 2] : null;
    const delayMs = previousMessage
      ? Date.now() - new Date(previousMessage.timestamp).getTime()
      : 0;

    return {
      persona: {
        name: persona.display_name,
        aliases: persona.aliases ?? [],
        short_description: persona.short_description,
        long_description: persona.long_description,
        traits: persona.traits,
        topics: persona.topics,
      },
      human: filteredHuman,
      visible_personas: visiblePersonas,
      delay_ms: delayMs,
      isTUI: this.isTUI,
    };
  }

  private async filterHumanDataByVisibility(
    human: HumanEntity,
    persona: PersonaEntity,
    currentMessage?: string
  ): Promise<ResponsePromptData["human"]> {
    const DEFAULT_GROUP = "General";
    const QUOTE_LIMIT = 10;
    const DATA_ITEM_LIMIT = 15;
    const SIMILARITY_THRESHOLD = 0.3;
    // Generic relevance selector for embedding-capable items.
    // Falls back to returning all items when no message/embeddings are available.
    const selectRelevantItems = async <T extends { id: string; embedding?: number[] }>(
      items: T[],
      limit: number
    ): Promise<T[]> => {
      if (items.length === 0) return [];

      const withEmbeddings = items.filter(i => i.embedding?.length);

      if (currentMessage && withEmbeddings.length > 0) {
        try {
          const embeddingService = getEmbeddingService();
          const queryVector = await embeddingService.embed(currentMessage);
          const results = findTopK(queryVector, withEmbeddings, limit);
          const relevant = results
            .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
            .map(({ item }) => item);

          if (relevant.length > 0) return relevant;
        } catch (err) {
          console.warn("[filterHumanDataByVisibility] Embedding search failed:", err);
        }
      }

      // Fallback: return top items by recency — never return unbounded list
      return [...items]
        .sort((a, b) => {
          const aTime = (a as { last_updated?: string }).last_updated ?? "";
          const bTime = (b as { last_updated?: string }).last_updated ?? "";
          return bTime.localeCompare(aTime);
        })
        .slice(0, limit);
    };
    const selectRelevantQuotes = async (quotes: Quote[]): Promise<Quote[]> => {
      if (quotes.length === 0) return [];
      const withEmbeddings = quotes.filter(q => q.embedding?.length);

      if (currentMessage && withEmbeddings.length > 0) {
        try {
          const embeddingService = getEmbeddingService();
          const queryVector = await embeddingService.embed(currentMessage);
          const results = findTopK(queryVector, withEmbeddings, QUOTE_LIMIT);
          const relevant = results
            .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
            .map(({ item }) => item);

          if (relevant.length > 0) return relevant;
        } catch (err) {
          console.warn("[filterHumanDataByVisibility] Embedding search failed:", err);
        }
      }
      return [...quotes]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, QUOTE_LIMIT);
    };
    if (persona.id === "ei") {
      const [facts, traits, topics, people, quotes] = await Promise.all([
        selectRelevantItems(human.facts, DATA_ITEM_LIMIT),
        selectRelevantItems(human.traits, DATA_ITEM_LIMIT),
        selectRelevantItems(human.topics, DATA_ITEM_LIMIT),
        selectRelevantItems(human.people, DATA_ITEM_LIMIT),
        selectRelevantQuotes(human.quotes ?? []),
      ]);
      return { facts, traits, topics, people, quotes };
    }
    const visibleGroups = new Set<string>();
    if (persona.group_primary) {
      visibleGroups.add(persona.group_primary);
    }
    (persona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));
    const filterByGroup = <T extends DataItemBase>(items: T[]): T[] => {
      return items.filter((item) => {
        const itemGroups = item.persona_groups ?? [];
        const effectiveGroups = itemGroups.length === 0 ? [DEFAULT_GROUP] : itemGroups;
        return effectiveGroups.some((g) => visibleGroups.has(g));
      });
    };
    const groupFilteredQuotes = (human.quotes ?? []).filter((q) => {
      const effectiveGroups = q.persona_groups.length === 0 ? [DEFAULT_GROUP] : q.persona_groups;
      return effectiveGroups.some((g) => visibleGroups.has(g));
    });

    const [facts, traits, topics, people, quotes] = await Promise.all([
      selectRelevantItems(filterByGroup(human.facts), DATA_ITEM_LIMIT),
      selectRelevantItems(filterByGroup(human.traits), DATA_ITEM_LIMIT),
      selectRelevantItems(filterByGroup(human.topics), DATA_ITEM_LIMIT),
      selectRelevantItems(filterByGroup(human.people), DATA_ITEM_LIMIT),
      selectRelevantQuotes(groupFilteredQuotes),
    ]);

    return { facts, traits, topics, people, quotes };
  }

  private getVisiblePersonas(
    currentPersona: PersonaEntity
  ): Array<{ name: string; short_description?: string }> {
    const allPersonas = this.stateManager.persona_getAll();

    if (currentPersona.id === "ei") {
      return allPersonas
        .filter((p) => p.id !== "ei" && !p.is_archived)
        .map((p) => ({
          name: p.display_name,
          short_description: p.short_description,
        }));
    }

    const visibleGroups = new Set<string>();
    if (currentPersona.group_primary) {
      visibleGroups.add(currentPersona.group_primary);
    }
    (currentPersona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));

    if (visibleGroups.size === 0) {
      return [];
    }

    return allPersonas
      .filter((p) => {
        if (p.id === currentPersona.id || p.id === "ei" || p.is_archived) {
          return false;
        }
        return p.group_primary && visibleGroups.has(p.group_primary);
      })
      .map((p) => ({
        name: p.display_name,
        short_description: p.short_description,
      }));
  }

  async setContextBoundary(personaId: string, timestamp: string | null): Promise<void> {
    this.stateManager.persona_setContextBoundary(personaId, timestamp);
    this.interface.onContextBoundaryChanged?.(personaId);
  }

  async setMessageContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): Promise<void> {
    this.stateManager.messages_setContextStatus(personaId, messageId, status);
  }

  async deleteMessages(personaId: string, messageIds: string[]): Promise<Message[]> {
    const removed = this.stateManager.messages_remove(personaId, messageIds);
    this.interface.onMessageAdded?.(personaId);
    return removed;
  }

  async getHuman(): Promise<HumanEntity> {
    return stripHumanEmbeddings(this.stateManager.getHuman());
  }

  async updateHuman(updates: Partial<HumanEntity>): Promise<void> {
    const current = this.stateManager.getHuman();
    this.stateManager.setHuman({ ...current, ...updates });
    this.interface.onHumanUpdated?.();
  }

  async getStorageState(): Promise<StorageState> {
    return this.stateManager.getStorageState();
  }

  async restoreFromState(state: StorageState): Promise<void> {
    return this.stateManager.restoreFromState(state);
  }

  async upsertFact(fact: Fact): Promise<void> {
    const human = this.stateManager.getHuman();
    const existing = human.facts.find(f => f.id === fact.id);
    
    if (needsEmbeddingUpdate(existing, fact)) {
      fact.embedding = await computeDataItemEmbedding(fact);
    } else if (existing?.embedding) {
      fact.embedding = existing.embedding;
    }
    
    this.stateManager.human_fact_upsert(fact);
    this.interface.onHumanUpdated?.();
  }

  async upsertTrait(trait: Trait): Promise<void> {
    const human = this.stateManager.getHuman();
    const existing = human.traits.find(t => t.id === trait.id);
    
    if (needsEmbeddingUpdate(existing, trait)) {
      trait.embedding = await computeDataItemEmbedding(trait);
    } else if (existing?.embedding) {
      trait.embedding = existing.embedding;
    }
    
    this.stateManager.human_trait_upsert(trait);
    this.interface.onHumanUpdated?.();
  }

  async upsertTopic(topic: Topic): Promise<void> {
    const human = this.stateManager.getHuman();
    const existing = human.topics.find(t => t.id === topic.id);
    
    if (needsEmbeddingUpdate(existing, topic)) {
      topic.embedding = await computeDataItemEmbedding(topic);
    } else if (existing?.embedding) {
      topic.embedding = existing.embedding;
    }
    
    this.stateManager.human_topic_upsert(topic);
    this.interface.onHumanUpdated?.();
  }

  async upsertPerson(person: Person): Promise<void> {
    const human = this.stateManager.getHuman();
    const existing = human.people.find(p => p.id === person.id);
    
    if (needsEmbeddingUpdate(existing, person)) {
      person.embedding = await computeDataItemEmbedding(person);
    } else if (existing?.embedding) {
      person.embedding = existing.embedding;
    }
    
    this.stateManager.human_person_upsert(person);
    this.interface.onHumanUpdated?.();
  }

   async removeDataItem(type: "fact" | "trait" | "topic" | "person", id: string): Promise<void> {
     switch (type) {
       case "fact":
         this.stateManager.human_fact_remove(id);
         break;
       case "trait":
         this.stateManager.human_trait_remove(id);
         break;
       case "topic":
         this.stateManager.human_topic_remove(id);
         break;
       case "person":
         this.stateManager.human_person_remove(id);
         break;
     }
     this.interface.onHumanUpdated?.();
   }

   async addQuote(quote: Quote): Promise<void> {
     if (!quote.embedding) {
       quote.embedding = await computeQuoteEmbedding(quote.text);
     }
     this.stateManager.human_quote_add(quote);
     this.interface.onQuoteAdded?.();
   }

   async updateQuote(id: string, updates: Partial<Quote>): Promise<void> {
     if (updates.text !== undefined) {
       const human = this.stateManager.getHuman();
       const existing = human.quotes.find(q => q.id === id);
       
       if (needsQuoteEmbeddingUpdate(existing, { text: updates.text })) {
         updates.embedding = await computeQuoteEmbedding(updates.text);
       }
     }
     this.stateManager.human_quote_update(id, updates);
     this.interface.onQuoteUpdated?.();
   }

   async removeQuote(id: string): Promise<void> {
     this.stateManager.human_quote_remove(id);
     this.interface.onQuoteRemoved?.();
   }

   async getQuotes(filter?: { message_id?: string; data_item_id?: string }): Promise<Quote[]> {
     const human = this.stateManager.getHuman();
     let quotes: Quote[];
     if (!filter) {
       quotes = human.quotes;
     } else if (filter.message_id) {
       quotes = this.stateManager.human_quote_getForMessage(filter.message_id);
     } else if (filter.data_item_id) {
       quotes = this.stateManager.human_quote_getForDataItem(filter.data_item_id);
     } else {
       quotes = human.quotes;
     }
     return quotes.map(stripQuoteEmbedding);
   }

   async getQuotesForMessage(messageId: string): Promise<Quote[]> {
     return this.stateManager.human_quote_getForMessage(messageId).map(stripQuoteEmbedding);
   }

   async searchHumanData(
     query: string,
     options: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number } = {}
   ): Promise<{
     facts: Fact[];
     traits: Trait[];
     topics: Topic[];
     people: Person[];
     quotes: Quote[];
   }> {
     const { types = ["fact", "trait", "topic", "person", "quote"], limit = 10 } = options;
     const human = this.stateManager.getHuman();
     const SIMILARITY_THRESHOLD = 0.3;

     const result = {
       facts: [] as Fact[],
       traits: [] as Trait[],
       topics: [] as Topic[],
       people: [] as Person[],
       quotes: [] as Quote[],
     };

     let queryVector: number[] | null = null;
     try {
       const embeddingService = getEmbeddingService();
       queryVector = await embeddingService.embed(query);
     } catch (err) {
       console.warn("[searchHumanData] Failed to generate query embedding:", err);
     }

     const searchItems = <T extends { id: string; embedding?: number[] }>(
       items: T[],
       textExtractor: (item: T) => string
     ): T[] => {
       const withEmbeddings = items.filter(i => i.embedding?.length);
       
       if (queryVector && withEmbeddings.length > 0) {
         return findTopK(queryVector, withEmbeddings, limit)
           .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
           .map(({ item }) => item);
       }
       
       const lowerQuery = query.toLowerCase();
       return items
         .filter(i => textExtractor(i).toLowerCase().includes(lowerQuery))
         .slice(0, limit);
     };

     if (types.includes("fact")) {
       result.facts = searchItems(human.facts, f => `${f.name} ${f.description || ""}`).map(stripDataItemEmbedding);
     }
     if (types.includes("trait")) {
       result.traits = searchItems(human.traits, t => `${t.name} ${t.description || ""}`).map(stripDataItemEmbedding);
     }
     if (types.includes("topic")) {
       result.topics = searchItems(human.topics, t => `${t.name} ${t.description || ""}`).map(stripDataItemEmbedding);
     }
     if (types.includes("person")) {
       result.people = searchItems(human.people, p => `${p.name} ${p.description || ""} ${p.relationship}`).map(stripDataItemEmbedding);
     }
     if (types.includes("quote")) {
       result.quotes = searchItems(human.quotes, q => q.text).map(stripQuoteEmbedding);
     }

     return result;
   }

  async exportState(): Promise<string> {
    const state = this.stateManager.getStorageState();
    return JSON.stringify(state, null, 2);
  }

  async importState(json: string): Promise<void> {
    const state = JSON.parse(json) as StorageState;
    if (!state.version || !state.human || !state.personas) {
      throw new Error("Invalid backup file format");
    }
    this.stateManager.restoreFromState(state);
    this.interface.onStateImported?.();
  }

  async abortCurrentOperation(): Promise<void> {
    this.stateManager.queue_pause();
    this.queueProcessor.abort();
  }

  async resumeQueue(): Promise<void> {
    this.stateManager.queue_resume();
  }

  async getQueueStatus(): Promise<QueueStatus> {
    return {
      state: this.stateManager.queue_isPaused()
        ? "paused"
        : this.stateManager.queue_hasProcessingItem()
          ? "busy"
          : "idle",
      pending_count: this.stateManager.queue_length(),
      dlq_count: this.stateManager.queue_dlqLength(),
    };
  }

  pauseQueue(): void {
    this.stateManager.queue_pause();
    this.queueProcessor.abort();
  }

  getQueueActiveItems(): LLMRequest[] {
    return this.stateManager.queue_getAllActiveItems();
  }

  getDLQItems(): LLMRequest[] {
    return this.stateManager.queue_getDLQItems();
  }

  updateQueueItem(id: string, updates: Partial<LLMRequest>): boolean {
    return this.stateManager.queue_updateItem(id, updates);
  }

  async clearQueue(): Promise<number> {
    this.queueProcessor.abort();
    return this.stateManager.queue_clear();
  }

  async submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void> {
    this.stateManager.queue_enqueue({
      type: LLMRequestType.Raw,
      priority: LLMPriority.High,
      system: systemPrompt,
      user: userPrompt,
      next_step: LLMNextStep.HandleOneShot,
      model: this.getModelForPersona(),
      data: { guid },
    });
  }

  // ============================================================================
  // DEBUG / TESTING UTILITIES
  // ============================================================================
  // These methods are for development and testing. In browser devtools:
  //   1. Set a breakpoint in App.tsx or similar
  //   2. When it hits, access: processor.triggerCeremonyNow()
  //   3. Watch console for ceremony phase logs
  // ============================================================================

  /**
   * Manually trigger ceremony execution, bypassing time checks.
   * 
   * USE FROM BROWSER DEVTOOLS:
   *   processor.triggerCeremonyNow()
   * 
   * This will:
   *   - Run ceremony for all active personas with recent activity
   *   - Apply decay to all persona topics
   *   - Queue Expire → Explore → DescCheck phases (LLM calls)
   *   - Run Human ceremony (decay human topics/people)
   *   - Update last_ceremony timestamp
   * 
   * Watch console for detailed phase logging.
   */
  triggerCeremonyNow(): void {
    console.log("[Processor] Manual ceremony trigger requested");
    startCeremony(this.stateManager);
  }

  /**
   * Get ceremony status for debugging.
   * 
   * USE FROM BROWSER DEVTOOLS:
   *   processor.getCeremonyStatus()
   */
  getCeremonyStatus(): { lastRun: string | null; nextRunTime: string } {
    const human = this.stateManager.getHuman();
    const config = human.settings?.ceremony;
    
    return {
      lastRun: config?.last_ceremony ?? null,
      nextRunTime: `Today at ${config?.time ?? "09:00"}`,
    };
  }
}
