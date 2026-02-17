import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
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
  type Checkpoint,
  type QueueStatus,
  type ContextStatus,
  type DataItemBase,
  type LLMResponse,
  type StorageState,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import { remoteSync } from "../storage/remote.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import { handlers } from "./handlers/index.js";
import {
  buildResponsePrompt,
  buildPersonaTraitExtractionPrompt,
  buildHeartbeatCheckPrompt,
  type ResponsePromptData,
  type PersonaTraitExtractionPromptData,
  type HeartbeatCheckPromptData,
} from "../prompts/index.js";
import { 
  orchestratePersonaGeneration,
  queueFactScan,
  queueTopicScan,
  queuePersonScan,
  shouldRunCeremony,
  startCeremony,
  type ExtractionContext,
} from "./orchestrators/index.js";
import { EI_WELCOME_MESSAGE, EI_PERSONA_DEFINITION } from "../templates/welcome.js";
import { ContextStatus as ContextStatusEnum } from "./types.js";

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
const DEFAULT_AUTO_SAVE_INTERVAL_MS = 60000;
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
  private lastAutoSave = 0;
  private autoSaveInterval = DEFAULT_AUTO_SAVE_INTERVAL_MS;
  private instanceId: number;
  private currentRequest: LLMRequest | null = null;
  private isTUI = false;
  private lastOpenCodeSync = 0;
  private openCodeImportInProgress = false;

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

    const checkpoints = await this.stateManager.checkpoint_list();
    const hasNoPersonas = this.stateManager.persona_getAll().length === 0;
    if (checkpoints.length === 0 && hasNoPersonas) {
      await this.bootstrapFirstRun();
    }

    this.running = true;
    this.lastAutoSave = Date.now();
    console.log(`[Processor ${this.instanceId}] initialized, starting loop`);

    const settings = this.stateManager.getHuman().settings;
    if (settings?.auto_save_interval_ms) {
      this.autoSaveInterval = settings.auto_save_interval_ms;
    }

    this.runLoop();
  }

  private async bootstrapFirstRun(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] First run detected, bootstrapping Ei`);

    const human = this.stateManager.getHuman();
    this.stateManager.setHuman({
      ...human,
      ceremony_config: {
        enabled: human.ceremony_config?.enabled ?? true,
        time: human.ceremony_config?.time ?? "09:00",
        last_ceremony: new Date().toISOString(),
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
      content: EI_WELCOME_MESSAGE,
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
    this.interface.onCheckpointStart?.();
    await this.stateManager.checkpoint_saveAuto();
    this.interface.onCheckpointCreated?.();
    console.log(`[Processor ${this.instanceId}] stopped`);
  }

  private async runLoop(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] runLoop() started`);
    while (this.running) {
      if (this.shouldAutoSave()) {
        this.lastAutoSave = Date.now();
        this.interface.onCheckpointStart?.();
        try {
          await this.stateManager.checkpoint_saveAuto();
          this.interface.onCheckpointCreated?.();
        } catch (e) {
          if (e instanceof Error && e.message.includes("STORAGE_SAVE_FAILED")) {
            console.warn("[Processor] Auto-save failed (quota exceeded), continuing...");
            this.interface.onError?.({
              code: "STORAGE_QUOTA_EXCEEDED",
              message: "localStorage quota exceeded. Auto-save disabled until queue shrinks. Consider clearing the queue.",
            });
          } else {
            throw e;
          }
        }
      }

      await this.checkScheduledTasks();

      if (this.queueProcessor.getState() === "idle") {
        const request = this.stateManager.queue_peekHighest();
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
            setTimeout(() => this.interface.onQueueStateChanged?.(nextState),0);
          }, {
            accounts: this.stateManager.getHuman().settings?.accounts,
            messageFetcher: (pName) => this.fetchMessagesForLLM(pName),
            rawMessageFetcher: (pName) => this.stateManager.messages_get(pName),
          });

          this.interface.onQueueStateChanged?.("busy");
        }
      }

      await this.sleep(DEFAULT_LOOP_INTERVAL_MS);
    }
    console.log(`[Processor ${this.instanceId}] runLoop() exited`);
  }

  private shouldAutoSave(): boolean {
    return Date.now() - this.lastAutoSave >= this.autoSaveInterval;
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = Date.now();
    const DEFAULT_HEARTBEAT_DELAY_MS = 1800000; //5 * 60 * 1000;//

    const human = this.stateManager.getHuman();
    
    if (this.isTUI && human.settings?.opencode?.integration) {
      await this.checkAndSyncOpenCode(human, now);
    }
    
    if (human.ceremony_config && shouldRunCeremony(human.ceremony_config)) {
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

    const since = lastSync > 0 ? new Date(lastSync) : new Date(0);

    this.openCodeImportInProgress = true;
    import("../integrations/opencode/importer.js")
      .then(({ importOpenCodeSessions }) => 
        importOpenCodeSessions(since, {
          stateManager: this.stateManager,
          interface: this.interface,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] OpenCode sync complete: ${result.sessionsProcessed} sessions, ` +
            `${result.topicsCreated} topics created, ${result.messagesImported} messages imported, ` +
            `${result.topicUpdatesQueued} topic updates queued`
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
    
    return filteredHistory.map((m) => ({
      role: m.role === "human" ? "user" : "assistant",
      content: m.content,
    })) as import("./types.js").ChatMessage[];
  }

  private queueHeartbeatCheck(personaId: string): void {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;

    this.stateManager.persona_update(personaId, { last_heartbeat: new Date().toISOString() });

    const human = this.stateManager.getHuman();
    const history = this.stateManager.messages_get(personaId);
    const filteredHuman = this.filterHumanDataByVisibility(human, persona);

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

  private async handleResponse(response: LLMResponse): Promise<void> {
    if (!response.success) {
      this.interface.onError?.({
        code: response.error?.includes("rate") ? "LLM_RATE_LIMITED" : "LLM_TIMEOUT",
        message: response.error ?? "Unknown LLM error",
      });
      this.stateManager.queue_fail(response.request.id, response.error ?? "LLM error");
      return;
    }

    const handler = handlers[response.request.next_step as LLMNextStep];
    if (!handler) {
      this.interface.onError?.({
        code: "HANDLER_NOT_FOUND",
        message: `No handler for ${response.request.next_step}`,
      });
      this.stateManager.queue_fail(response.request.id, "No handler");
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

      if (response.request.next_step === LLMNextStep.HandleEiValidation) {
        this.interface.onHumanUpdated?.();
      }

      if (response.request.next_step === LLMNextStep.HandleHumanItemUpdate) {
        this.interface.onHumanUpdated?.();
        this.interface.onQuoteAdded?.();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.interface.onError?.({
        code: "HANDLER_ERROR",
        message,
      });
      this.stateManager.queue_fail(response.request.id, message);
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
    this.stateManager.queue_pause();
    
    const messages = this.stateManager.messages_get(personaId);
    const pendingIds = messages
      .filter(m => m.role === "human" && !m.read)
      .map(m => m.id);
    
    if (pendingIds.length === 0) return "";
    
    const removed = this.stateManager.messages_remove(personaId, pendingIds);
    const recalledContent = removed.map(m => m.content).join("\n\n");
    
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
      content,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: "default" as ContextStatus,
    };
    this.stateManager.messages_append(persona.id, message);
    this.interface.onMessageAdded?.(persona.id);

    const promptData = this.buildResponsePromptData(persona);
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
    const now = new Date().toISOString();
    
    const getContextForType = (lastSeeded: string | undefined): ExtractionContext => {
      if (!lastSeeded) {
        return { personaId, personaDisplayName, messages_context: [], messages_analyze: history };
      }
      const sinceTime = new Date(lastSeeded).getTime();
      const splitIndex = history.findIndex(m => new Date(m.timestamp).getTime() > sinceTime);
      if (splitIndex === -1) {
        return { personaId, personaDisplayName, messages_context: history, messages_analyze: [] };
      }
      return {
        personaId,
        personaDisplayName,
        messages_context: history.slice(0, splitIndex),
        messages_analyze: history.slice(splitIndex),
      };
    };

    const factContext = getContextForType(human.last_seeded_fact);
    if (human.facts.length < factContext.messages_analyze.length) {
      queueFactScan(factContext, this.stateManager);
      this.stateManager.setHuman({ ...human, last_seeded_fact: now });
      console.log(`[Processor] Human Seed extraction: facts (${human.facts.length} < ${factContext.messages_analyze.length} messages)`);
    }

    const topicContext = getContextForType(human.last_seeded_topic);
    if (human.topics.length < topicContext.messages_analyze.length) {
      queueTopicScan(topicContext, this.stateManager);
      this.stateManager.setHuman({ ...this.stateManager.getHuman(), last_seeded_topic: now });
      console.log(`[Processor] Human Seed extraction: topics (${human.topics.length} < ${topicContext.messages_analyze.length} messages)`);
    }

    const personContext = getContextForType(human.last_seeded_person);
    if (human.people.length < personContext.messages_analyze.length) {
      queuePersonScan(personContext, this.stateManager);
      this.stateManager.setHuman({ ...this.stateManager.getHuman(), last_seeded_person: now });
      console.log(`[Processor] Human Seed extraction: people (${human.people.length} < ${personContext.messages_analyze.length} messages)`);
    }
  }

  private buildResponsePromptData(persona: PersonaEntity): ResponsePromptData {
    const human = this.stateManager.getHuman();
    const filteredHuman = this.filterHumanDataByVisibility(human, persona);
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
    };
  }

  private filterHumanDataByVisibility(
    human: HumanEntity,
    persona: PersonaEntity
  ): ResponsePromptData["human"] {
    const DEFAULT_GROUP = "General";

    if (persona.id === "ei") {
      const recentQuotes = [...(human.quotes ?? [])]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);
      return {
        facts: human.facts,
        traits: human.traits,
        topics: human.topics,
        people: human.people,
        quotes: recentQuotes,
      };
    }

    const visibleGroups = new Set<string>();
    if (persona.group_primary) {
      visibleGroups.add(persona.group_primary);
    }
    (persona.groups_visible ?? []).forEach((g) => visibleGroups.add(g));

    const filterByGroup = <T extends DataItemBase>(items: T[]): T[] => {
      return items.filter((item) => {
        const itemGroups = item.persona_groups ?? [];
        // Empty persona_groups means "General" (legacy/default data)
        const effectiveGroups = itemGroups.length === 0 ? [DEFAULT_GROUP] : itemGroups;
        return effectiveGroups.some((g) => visibleGroups.has(g));
      });
    };

    const filteredQuotes = (human.quotes ?? [])
      .filter((q) => {
        const effectiveGroups = q.persona_groups.length === 0 ? [DEFAULT_GROUP] : q.persona_groups;
        return effectiveGroups.some((g) => visibleGroups.has(g));
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    return {
      facts: filterByGroup(human.facts),
      traits: filterByGroup(human.traits),
      topics: filterByGroup(human.topics),
      people: filterByGroup(human.people),
      quotes: filteredQuotes,
    };
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
    this.stateManager.human_fact_upsert(fact);
    this.interface.onHumanUpdated?.();
  }

  async upsertTrait(trait: Trait): Promise<void> {
    this.stateManager.human_trait_upsert(trait);
    this.interface.onHumanUpdated?.();
  }

  async upsertTopic(topic: Topic): Promise<void> {
    this.stateManager.human_topic_upsert(topic);
    this.interface.onHumanUpdated?.();
  }

  async upsertPerson(person: Person): Promise<void> {
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
     this.stateManager.human_quote_add(quote);
     this.interface.onQuoteAdded?.();
   }

   async updateQuote(id: string, updates: Partial<Quote>): Promise<void> {
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

  async getCheckpoints(): Promise<Checkpoint[]> {
    return this.stateManager.checkpoint_list();
  }

  async createCheckpoint(index: number, name: string): Promise<void> {
    this.interface.onCheckpointStart?.();
    await this.stateManager.checkpoint_saveManual(index, name);
    this.interface.onCheckpointCreated?.(index);
  }

  async deleteCheckpoint(index: number): Promise<void> {
    this.interface.onCheckpointStart?.();
    const deleted = await this.stateManager.checkpoint_delete(index);
    if (deleted) {
      this.interface.onCheckpointDeleted?.(index);
    }
  }

  async restoreCheckpoint(index: number): Promise<boolean> {
    this.interface.onCheckpointStart?.();
    this.queueProcessor.abort();
    const result = await this.stateManager.checkpoint_restore(index);
    if (result) {
      this.interface.onCheckpointRestored?.(index);
      this.interface.onQueueStateChanged?.("idle");
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
    this.interface.onCheckpointRestored?.(-1);
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
        : this.queueProcessor.getState() === "busy"
          ? "busy"
          : "idle",
      pending_count: this.stateManager.queue_length(),
    };
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
  getCeremonyStatus(): { enabled: boolean; lastRun: string | null; nextRunTime: string | null } {
    const human = this.stateManager.getHuman();
    const config = human.ceremony_config;
    
    return {
      enabled: config?.enabled ?? false,
      lastRun: config?.last_ceremony ?? null,
      nextRunTime: config?.enabled ? `Today at ${config.time}` : null,
    };
  }
}
