import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequest,
  type Ei_Interface,
  type PersonaSummary,
  type PersonaEntity,
  type PersonaCreationInput,
  type Message,
  type MessageQueryOptions,
  type HumanEntity,
  type Fact,
  type Topic,
  type Person,
  type Quote,
  type QueueStatus,
  type ContextStatus,
  type LLMResponse,
  type StorageState,
  type StateConflictResolution,
  type StateConflictData,
  type ToolDefinition,
  type ToolProvider,
} from "./types.js";
import { buildPersonaFromPersonPrompt } from "../prompts/index.js";
import { buildSiblingAwarenessSection } from "../prompts/room/index.js";
import type { PersonaGenerationResult } from "../prompts/generation/types.js";

import type { Storage } from "../storage/interface.js";
import { remoteSync } from "../storage/remote.js";
import { yoloMerge } from "../storage/merge.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import { handlers } from "./handlers/index.js";
import { normalizeRoomMessages, getMessageContent } from "./handlers/utils.js";
import { sanitizeEiPersonaIdentifiers } from "./utils/identifier-utils.js";
import { qualifyEiMessage } from "./utils/message-id.js";
import { ContextStatus as ContextStatusEnum, RoomMode } from "./types.js";
import { bootstrapTools } from "./bootstrap-tools.js";
import { seedBuiltinFacts, migrateLearnedOn, migrateMessageIds, migrateSlackToMultiWorkspace, seedSettings } from "./migrations.js";
import { IntegrationSyncManager } from "./integration-sync-manager.js";
import { registerFindMemoryExecutor, registerFetchMemoryExecutor, registerFetchMessageExecutor, registerFileReadExecutor, registerPersonaNoteExecutors, buildPersonaNoteTools, SYSTEM_TOOLS } from "./tools/index.js";
import { createAddNoteExecutor, createClearNoteExecutor } from "./tools/builtin/persona-notes.js";
import { createFindMemoryExecutor } from "./tools/builtin/find-memory.js";
import { createFetchMemoryExecutor } from "./tools/builtin/fetch-memory.js";
import { createFetchMessageExecutor } from "./tools/builtin/fetch-message.js";
import { EI_WELCOME_MESSAGE, EI_PERSONA_DEFINITION } from "../templates/welcome.js";
import { EMMETT_PERSONA_DEFINITION } from "../templates/emmett.js";
import { shouldStartCeremony, startCeremony, handleCeremonyProgress, queueReflectionDrain, queueUserDedupRequest, queueRoomCapture, queuePersonaCapture, checkAndQueueRoomExtraction, queueTargetedPersonUpdate, queueTargetedTopicUpdate } from "./orchestrators/index.js";
import { finishDocumentBatch } from "./handlers/document-segmentation.js";
import { buildSynthesisPrompt } from "../prompts/synthesis/index.js";
import { DEFAULT_SEED_TRAITS } from "./constants/seed-traits.js";

// Static module imports
import {
  filterMessagesForContext,
} from "./context-utils.js";
import {
  getPersonaList,
  resolvePersonaName,
  getPersona,
  createPersona,
  archivePersona,
  unarchivePersona,
  deletePersona,
  updatePersona,
  getGroupList,
} from "./persona-manager.js";
import {
  getMessages,
  markMessageRead,
  markAllMessagesRead,
  recallPendingMessages,
  sendMessage,
  setContextBoundary,
  setMessageContextStatus,
  deleteMessages,
  fetchMessagesForLLM,
} from "./message-manager.js";
import {
  getModelForPersona,
  getOneshotModel,
  countTrailingPersonaMessages,
  queueHeartbeatCheck,
} from "./heartbeat-manager.js";
import {
  getHuman,
  updateHuman,
  upsertFact,
  upsertTopic,
  upsertPerson,
  removeDataItem,
  addQuote,
  updateQuote,
  removeQuote,
  getQuotes,
  getQuotesForMessage,
  searchHumanData,
} from "./human-data-manager.js";
import {
  getToolProviderList,
  getToolProvider,
  addToolProvider,
  updateToolProvider,
  removeToolProvider,
  getToolList,
  getTool,
  addTool,
  updateTool,
  removeTool,
} from "./tool-manager.js";
import {
  abortCurrentOperation,
  resumeQueue,
  getQueueStatus,
  pauseQueue,
  getQueueActiveItems,
  getDLQItems,
  updateQueueItem,
  deleteQueueItems,
  clearQueue,
  submitOneShot,
  submitOneShotJSON,
} from "./queue-manager.js";
import {
  getRoomList,
  getRoom,
  getRoomMessages,
  getRoomActivePath,
  resolveRoomName,
  createRoom,
  submitHumanRoomMessage,
  recallHumanRoomMessage,
  sendFfaMessage,
  activateRoom,
  selectCYPBranch,
  archiveRoom,
  unarchiveRoom,
  deleteRoom,
  markAllRoomMessagesRead,
} from "./room-manager.js";
import type { RoomCreationInput, RoomEntity, RoomMessage, RoomSummary } from "./types.js";
import { previewUnsource as _previewUnsource } from "../integrations/document/unsource.js";
import type { UnsourcePreview, UnsourceResult } from "../integrations/document/unsource.js";

const DEFAULT_LOOP_INTERVAL_MS = 100;

let processorInstanceCount = 0;

// filterMessagesForContext is still exported for legacy imports in tests/orchestrators
export { filterMessagesForContext };

export class Processor {
  private stateManager = new StateManager();
  private queueProcessor = new QueueProcessor();
  private interface: Ei_Interface;
  private running = false;
  private stopped = false;
  private instanceId: number;
  private currentRequest: LLMRequest | null = null;
  private isTUI = false;
  private lastDLQTrim = 0;
  private pendingConflict: StateConflictData | null = null;
  private storage: Storage | null = null;
  private importAbortController = new AbortController();
  private syncManager: IntegrationSyncManager | null = null;
  private personaPreviewResolvers = new Map<string, { resolve: (r: PersonaGenerationResult) => void; reject: (e: Error) => void }>();

  constructor(ei: Ei_Interface) {
    this.interface = ei;
    this.instanceId = ++processorInstanceCount;
    console.log(`[Processor ${this.instanceId}] CREATED`);
    this.detectEnvironment();
    this.stateManager.setQueueChangeListener(() => {
      this.interface.onQueueStateChanged?.("busy");
    });
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
    this.storage = storage;
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
    const hasSyncCreds = !!(syncCreds?.username && syncCreds?.passphrase);
    if (hasSyncCreds || remoteSync.isConfigured()) {
      if (hasSyncCreds) {
        await remoteSync.configure(syncCreds);
      }

      try {
        const remoteInfo = await remoteSync.checkRemote();
        if (!primary && remoteInfo.exists) {
          console.log(`[Processor ${this.instanceId}] No primary state, remote exists — silent pull`);
          const result = await remoteSync.fetch();
          if (result.success && result.state) {
            this.stateManager.restoreFromState(result.state);
          }
        } else if (primary && remoteInfo.exists) {
          console.log(`[Processor ${this.instanceId}] Both primary and remote exist — conflict`);
          const localTimestamp = new Date(this.stateManager.getHuman().last_updated);
          const remoteTimestamp = remoteInfo.lastModified ?? new Date();
          this.pendingConflict = { localTimestamp, remoteTimestamp, hasLocalState: true };
          this.interface.onStateConflict?.(this.pendingConflict);
          return;
        }
      } catch (err) {
        console.warn(`[Processor ${this.instanceId}] Sync check failed, continuing without sync:`, err);
      }
    }

    await this.completeInitialization();
  }

  private async completeInitialization(): Promise<void> {
    if (!this.stateManager.hasExistingData() || this.stateManager.persona_getAll().length === 0) {
      await this.bootstrapFirstRun();
    }
    this.bootstrapTools();
    seedBuiltinFacts(this.stateManager);
    migrateLearnedOn(this.stateManager);
    await migrateMessageIds(this.stateManager, this.isTUI);
    migrateSlackToMultiWorkspace(this.stateManager);
    seedSettings(this.stateManager);
    registerFindMemoryExecutor(createFindMemoryExecutor(this.searchHumanData.bind(this), this.getPersonaList.bind(this), this.stateManager.getHuman.bind(this.stateManager)));
    registerFetchMemoryExecutor(createFetchMemoryExecutor(this.stateManager.getHuman.bind(this.stateManager)));
    registerPersonaNoteExecutors(
      createAddNoteExecutor(this.stateManager.persona_getById.bind(this.stateManager), this.stateManager.persona_update.bind(this.stateManager)),
      createClearNoteExecutor(this.stateManager.persona_getById.bind(this.stateManager), this.stateManager.persona_update.bind(this.stateManager))
    );
    if (this.isTUI) {
      await registerFileReadExecutor();
      const retrievalPath = "../cli/retrieval.js";
      const { resolveExternalMessage } = await import(/* @vite-ignore */ retrievalPath);
      registerFetchMessageExecutor(createFetchMessageExecutor(
        this.stateManager.persona_getAll.bind(this.stateManager),
        this.stateManager.messages_get.bind(this.stateManager),
        this.stateManager.getRoomList.bind(this.stateManager),
        this.stateManager.getRoomMessages.bind(this.stateManager),
        (roomId: string) => this.stateManager.getRoom(roomId)?.display_name ?? null,
        resolveExternalMessage
      ));
    } else {
      registerFetchMessageExecutor(createFetchMessageExecutor(
        this.stateManager.persona_getAll.bind(this.stateManager),
        this.stateManager.messages_get.bind(this.stateManager),
        this.stateManager.getRoomList.bind(this.stateManager),
        this.stateManager.getRoomMessages.bind(this.stateManager),
        (roomId: string) => this.stateManager.getRoom(roomId)?.display_name ?? null
      ));
    }
    this.syncManager = new IntegrationSyncManager(this.stateManager, this.isTUI, this.storage, this.importAbortController, this.interface);
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
    };
    this.stateManager.persona_add(eiEntity);

    const welcomeMessage: Message = {
      id: qualifyEiMessage(crypto.randomUUID()),
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

  private bootstrapEmmett(): void {
    const existing = this.stateManager.persona_getById("emmet");
    if (existing) {
      if (existing.is_archived) {
        this.stateManager.persona_unarchive("emmet");
      }
      return;
    }
    const emmettEntity: PersonaEntity = {
      ...EMMETT_PERSONA_DEFINITION,
      id: "emmet",
      display_name: "Emmett",
      last_updated: new Date().toISOString(),
      tools: [],
    };
    this.stateManager.persona_add(emmettEntity);
    this.interface.onPersonaAdded?.();
  }

  async importDocument(content: string, filename: string): Promise<import("../integrations/document/types.js").DocumentImportResult> {
    this.bootstrapEmmett();
    const { importDocument } = await import("../integrations/document/importer.js");
    return importDocument({
      stateManager: this.stateManager,
      interface: this.interface,
      content,
      filename,
    });
  }

  getUnsourcePreview(sourceTag: string): UnsourcePreview {
    return _previewUnsource(sourceTag, this.stateManager);
  }

  async executeUnsource(preview: UnsourcePreview): Promise<UnsourceResult> {
    const { executeUnsource } = await import("../integrations/document/unsource.js");
    return executeUnsource(preview, this.stateManager);
  }

  async generateDocument(subject: string): Promise<{ slug: string }> {
    this.bootstrapEmmett();
    const slugBase = subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = `${slugBase}_${timestamp}`;

    const primary = await this.searchHumanData(subject, { limit: 20 });
    if (
      primary.facts.length === 0 &&
      primary.topics.length === 0 &&
      primary.people.length === 0 &&
      primary.quotes.length === 0
    ) {
      throw new Error(`No knowledge found about '${subject}'`);
    }

    const seenQuoteIds = new Set<string>();
    const seenItemIds = new Set<string>(
      [...primary.topics, ...primary.people, ...primary.facts].map(i => i.id)
    );

    const MAX_QUOTES_PER_ENTITY = 3;

    const enrichTopic = (topic: import("../prompts/synthesis/types.js").EnrichedTopic["topic"]) => {
      const linked = this.stateManager.human_quote_getForDataItem(topic.id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, MAX_QUOTES_PER_ENTITY);
      linked.forEach(q => seenQuoteIds.add(q.id));
      return { topic, quotes: linked };
    };

    const enrichPerson = (person: import("../prompts/synthesis/types.js").EnrichedPerson["person"]) => {
      const linked = this.stateManager.human_quote_getForDataItem(person.id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, MAX_QUOTES_PER_ENTITY);
      linked.forEach(q => seenQuoteIds.add(q.id));
      return { person, quotes: linked };
    };

    const enrichedTopics = primary.topics.map(enrichTopic);
    const enrichedPeople = primary.people.map(enrichPerson);

    const human = this.stateManager.getHuman();
    const allItems = [...human.facts, ...human.topics, ...human.people];

    const MAX_SECONDARY_ENTITIES = 10;

    const secondaryTopics: typeof enrichedTopics = [];
    const secondaryPeople: typeof enrichedPeople = [];
    const secondaryFacts: typeof primary.facts = [];

    outer: for (const quote of [...enrichedTopics.flatMap(e => e.quotes), ...enrichedPeople.flatMap(e => e.quotes)]) {
      for (const itemId of quote.data_item_ids) {
        if (secondaryTopics.length + secondaryPeople.length + secondaryFacts.length >= MAX_SECONDARY_ENTITIES) break outer;
        if (seenItemIds.has(itemId)) continue;
        seenItemIds.add(itemId);
        const item = allItems.find(i => i.id === itemId);
        if (!item) continue;
        if (human.topics.find(t => t.id === itemId)) {
          secondaryTopics.push(enrichTopic(item as typeof primary.topics[0]));
        } else if (human.people.find(p => p.id === itemId)) {
          secondaryPeople.push(enrichPerson(item as typeof primary.people[0]));
        } else if (human.facts.find(f => f.id === itemId)) {
          secondaryFacts.push(item as typeof primary.facts[0]);
        }
      }
    }

    const standaloneQuotes = primary.quotes.filter(q => !seenQuoteIds.has(q.id));

    const allLoadedFacts = [...primary.facts, ...secondaryFacts];
    const allLoadedTopics = [...enrichedTopics, ...secondaryTopics];
    const allLoadedPeople = [...enrichedPeople, ...secondaryPeople];

    const loadedEntityNames = new Map<string, string>();
    for (const f of allLoadedFacts) loadedEntityNames.set(f.id, f.name);
    for (const { topic } of allLoadedTopics) loadedEntityNames.set(topic.id, topic.name);
    for (const { person } of allLoadedPeople) loadedEntityNames.set(person.id, person.name);

    const prompt = buildSynthesisPrompt({
      subject,
      facts: allLoadedFacts,
      topics: allLoadedTopics,
      people: allLoadedPeople,
      standaloneQuotes,
      loadedEntityNames,
    });

    const model = this.stateManager.getHuman().settings?.rewrite_model
      ?? this.stateManager.getHuman().settings?.default_model;

    this.stateManager.queue_enqueue({
      type: LLMRequestType.Raw,
      priority: LLMPriority.Normal,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleKnowledgeSynthesis,
      model,
      data: { slug, subject },
    });

    return { slug };
  }

  checkGenerationModel(): { model: string; isRewriteModel: boolean } {
    const settings = this.stateManager.getHuman().settings;
    if (settings?.rewrite_model) {
      return { model: settings.rewrite_model, isRewriteModel: true };
    }
    return { model: settings?.default_model ?? "unknown", isRewriteModel: false };
  }

  async getGeneratedDocumentContent(slug: string): Promise<string | null> {
    const messages = this.stateManager.messages_get("emmet");
    const target = `generate:document:${slug}`;
    const message = messages.find(m => m.id.startsWith(`${target}:`));
    return message?.content ?? null;
  }

  async reRunDocument(slug: string): Promise<{ slug: string }> {
    const docs = this.stateManager.getHuman().settings?.document?.processed_documents ?? {};
    const entry = docs[slug];
    if (!entry || entry.type !== "generated" || !entry.subject) {
      throw new Error(`No generated document found for slug "${slug}"`);
    }
    const subject = entry.subject;
    const preview = this.getUnsourcePreview(`generate:document:${slug}`);
    await this.executeUnsource(preview);
    return this.generateDocument(subject);
  }

  private bootstrapTools(): void {
    bootstrapTools(this.stateManager);
  }

  async stop(): Promise<void> {
    console.log(
      `[Processor ${this.instanceId}] stop() called, running=${this.running}, stopped=${this.stopped}`
    );
    this.stopped = true;

    if (!this.running) {
      console.log(`[Processor ${this.instanceId}] not running, skipping save`);
      return;
    }

    this.running = false;
    this.importAbortController.abort();
    this.queueProcessor.abort();
    await this.stateManager.flush();
    console.log(`[Processor ${this.instanceId}] stopped`);
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }

  async pause(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] pause() called`);
    this.running = false;
    this.queueProcessor.abort();
    this.importAbortController.abort();
    this.syncManager?.resetImportFlags();
    await this.stateManager.flush();
    console.log(`[Processor ${this.instanceId}] pause() complete (main loop stopped, state flushed)`);
  }

  async resume(): Promise<void> {
    console.log(`[Processor ${this.instanceId}] resume() called`);
    if (this.stopped) {
      throw new Error(`Cannot resume a stopped processor (instanceId: ${this.instanceId})`);
    }
    this.importAbortController = new AbortController();
    this.syncManager?.updateAbortController(this.importAbortController);
    this.running = true;
    this.runLoop();
    console.log(`[Processor ${this.instanceId}] resume() complete (main loop restarted)`);
  }
  async saveAndExit(): Promise<{ success: boolean; error?: string }> {
    console.log(`[Processor ${this.instanceId}] saveAndExit() called`);
    this.interface.onSaveAndExitStart?.();

    await this.pause();

    const human = this.stateManager.getHuman();
    const hasSyncCreds =
      !!human.settings?.sync?.username && !!human.settings?.sync?.passphrase;

    if (hasSyncCreds && remoteSync.isConfigured()) {
      const state = this.stateManager.getStorageState();
      const result = await remoteSync.sync(state);

      if (!result.success) {
        console.log(`[Processor ${this.instanceId}] Remote sync failed: ${result.error}`);
        await this.resume();
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
        break;
      case "server": {
        const result = await remoteSync.fetch();
        if (result.success && result.state) {
          this.stateManager.restoreFromState(result.state);
        }
        break;
      }
      case "yolo": {
        const localState = this.stateManager.getStorageState();
        const remoteResult = await remoteSync.fetch();
        if (remoteResult.success && remoteResult.state) {
          const merged = yoloMerge(localState, remoteResult.state);
          this.stateManager.restoreFromState(merged);
        }
        break;
      }
    }

    this.pendingConflict = null;
    this.importAbortController = new AbortController();
    await this.completeInitialization();
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
          let request = this.stateManager.queue_claimHighest();
          if (request) {
            request = this.augmentRoomRequest(request);
            const personaId = request.data.personaId as string | undefined;
            const personaDisplayName = request.data.personaDisplayName as string | undefined;
            const personaSuffix = personaDisplayName ? ` [${personaDisplayName}]` : "";
            console.log(
              `[Processor ${this.instanceId}] processing request: ${request.next_step}${personaSuffix}`
            );
            this.currentRequest = request;

            if (personaId && request.next_step === LLMNextStep.HandlePersonaResponse) {
              this.interface.onMessageProcessing?.(personaId);
            }

            const roomId = request.data.roomId as string | undefined;
            if (roomId && (request.next_step === LLMNextStep.HandleRoomResponse || request.next_step === LLMNextStep.HandleRoomJudge)) {
              this.interface.onRoomMessageProcessing?.(roomId);
            }

const toolNextSteps = new Set([
  LLMNextStep.HandlePersonaResponse,
  LLMNextStep.HandleRoomResponse,
  LLMNextStep.HandleHeartbeatCheck,
  LLMNextStep.HandleEiHeartbeat,
  LLMNextStep.HandleToolContinuation,
  LLMNextStep.HandleDedupCurate,
  LLMNextStep.HandleKnowledgeSynthesis,
]);
            const toolPersonaId =
              personaId ??
              (request.next_step === LLMNextStep.HandleEiHeartbeat ? "ei" : undefined);
            
            // Dedup operates on Human data, not persona data — provide find_memory from SYSTEM_TOOLS directly.
            // Also covers HandleToolContinuation originating from a dedup request: the
            // continuation rebuilds tool lists from scratch and has no personaId, so without
            // this check Opus loses find_memory access after round 1.
            const isDedupRequest =
              request.next_step === LLMNextStep.HandleDedupCurate ||
              (request.next_step === LLMNextStep.HandleToolContinuation &&
                request.data.originalNextStep === LLMNextStep.HandleDedupCurate);

            const isSynthesisRequest = request.next_step === LLMNextStep.HandleKnowledgeSynthesis ||
              (request.next_step === LLMNextStep.HandleToolContinuation &&
                request.data.originalNextStep === LLMNextStep.HandleKnowledgeSynthesis);

            let tools: ToolDefinition[] = [];
            if (isDedupRequest) {
              tools = SYSTEM_TOOLS.filter(t => t.name === "find_memory");
            } else if (isSynthesisRequest) {
              tools = SYSTEM_TOOLS.filter(t =>
                t.name === "find_memory" || t.name === "fetch_memory" || t.name === "fetch_message"
              );
            } else if (toolNextSteps.has(request.next_step) && toolPersonaId) {
              tools = [...SYSTEM_TOOLS, ...buildPersonaNoteTools(toolPersonaId), ...this.stateManager.tools_getForPersona(toolPersonaId, this.isTUI)];
            }

            // Auto-inject each handler's dedicated submit tool — infrastructure, not user-visible.
            const submitToolByStep: Partial<Record<string, string>> = {
              [LLMNextStep.HandleHeartbeatCheck]:   "submit_heartbeat_check",
              [LLMNextStep.HandleEiHeartbeat]:      "submit_ei_heartbeat",
              [LLMNextStep.HandleDedupCurate]:      "submit_dedup_decisions",
            };
            const effectiveStep = request.next_step === LLMNextStep.HandleToolContinuation
              ? (request.data.originalNextStep as string | undefined)
              : request.next_step;
            const submitToolName = effectiveStep ? submitToolByStep[effectiveStep] : undefined;
            if (submitToolName) {
              const submitTool = this.stateManager.tools_getByName(submitToolName);
              if (submitTool?.enabled && !tools.find(t => t.name === submitToolName)) {
                tools = [...tools, submitTool];
              }
            }
            
            const toolPersonaName = toolPersonaId
              ? (this.stateManager.persona_getById(toolPersonaId)?.display_name ?? toolPersonaId)
              : "none";
            console.log(
              `[Tools] Dispatch for ${request.next_step} persona=${toolPersonaName}: ${tools.length} tool(s) attached`
            );

            this.queueProcessor.start(
              request,
              async (response) => {
                this.currentRequest = null;
                await this.handleResponse(response);
                const nextState = this.stateManager.queue_isPaused() ? "paused" : "idle";
                setTimeout(() => this.interface.onQueueStateChanged?.(nextState), 0);
              },
              {
                accounts: this.stateManager.getHuman().settings?.accounts,
                messageFetcher: (pName) => fetchMessagesForLLM(this.stateManager, pName),
                rawMessageFetcher: (id) => {
                  if (id.startsWith("room:")) {
                    const roomId = id.slice(5);
                    return normalizeRoomMessages(this.stateManager.getRoomMessages(roomId), this.stateManager);
                  }
                  return this.stateManager.messages_get(id);
                },
                tools: tools.length > 0 ? tools : undefined,
                onEnqueue: (req) => this.stateManager.queue_enqueue(req),
                onProviderConfigUpdate: (providerId, updates) => {
                  const provider = this.stateManager.tools_getProviderById(providerId);
                  if (provider) {
                    this.stateManager.tools_updateProvider(providerId, {
                      config: { ...provider.config, ...updates },
                    });
                  }
                },
                onUsageUpdate: (modelId, usage) => {
                  this.stateManager.model_update_usage(modelId, usage);
                },
              }
            );

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

    const human = this.stateManager.getHuman();

    if (this.syncManager) {
      await this.syncManager.checkAll(human, now);
    }

    if (human.settings?.ceremony && shouldStartCeremony(human.settings.ceremony, this.stateManager)) {
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
      if (persona.is_paused || persona.is_archived || persona.is_static) continue;

      const defaultHeartbeatMs = this.stateManager.getHuman().settings?.default_heartbeat_ms ?? 1800000;
      const heartbeatDelay = persona.heartbeat_delay_ms ?? defaultHeartbeatMs;
      const lastActivity = this.stateManager.messages_getLastActivity(persona.id);
      const timeSinceActivity = now - lastActivity;

      if (timeSinceActivity >= heartbeatDelay) {
        const lastHeartbeat = persona.last_heartbeat
          ? new Date(persona.last_heartbeat).getTime()
          : 0;
        const timeSinceHeartbeat = now - lastHeartbeat;

        if (timeSinceHeartbeat >= heartbeatDelay) {
           const history = this.stateManager.messages_get(persona.id);
           const contextWindowMs =
             persona.context_window_ms 
             ?? this.stateManager.getHuman().settings?.default_context_window_ms 
             ?? 28800000;
          const contextHistory = filterMessagesForContext(
            history,
            persona.context_boundary,
            contextWindowMs
          );
          const trailing = countTrailingPersonaMessages(contextHistory);
          if (trailing < 3) {
            queueHeartbeatCheck(this.stateManager, persona.id, this.isTUI);
          }
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

  private augmentRoomRequest(request: LLMRequest): LLMRequest {
    if (request.next_step !== LLMNextStep.HandleRoomResponse) return request;

    const roomId = request.data.roomId as string | undefined;
    const parentMessageId = request.data.parentMessageId as string | undefined;
    const personaDisplayName = request.data.personaDisplayName as string | undefined;

    if (!roomId || !parentMessageId || !personaDisplayName) return request;

    const room = this.stateManager.getRoom(roomId);
    if (room?.mode !== RoomMode.FreeForAll) return request;

    const siblings = this.stateManager.getRoomChildren(roomId, parentMessageId)
      .filter((m: RoomMessage) => m.role === "persona" && getMessageContent(m))
      .map((m: RoomMessage) => ({
        name: this.stateManager.persona_getById(m.persona_id ?? "")?.display_name ?? "Participant",
        content: getMessageContent(m),
      }));

    if (siblings.length === 0) return request;

    const siblingSection = buildSiblingAwarenessSection(siblings);
    return { ...request, system: request.system + "\n\n" + siblingSection };
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
        if (response.request.next_step === LLMNextStep.HandlePersonaPreview) {
          const guid = response.request.data.guid as string;
          const entry = this.personaPreviewResolvers.get(guid);
          if (entry) {
            this.personaPreviewResolvers.delete(guid);
            entry.reject(new Error("Persona preview generation failed after max retries"));
            return;
          }
        }
        if (response.request.next_step === LLMNextStep.HandleOneShot) {
          const guid = response.request.data.guid as string;
          this.interface.onOneShotReturned?.(guid, "");
        }
        if (response.request.next_step === LLMNextStep.HandleOneShotJSON) {
          const guid = response.request.data.guid as string;
          this.interface.onOneShotJSONReturned?.(guid, null);
        }
      }

      this.interface.onError?.({ code, message });
      return;
    }

    if (response.finish_reason === "tool_calls_enqueued") {
      console.log(
        `[Processor] tool_calls_enqueued for ${response.request.next_step} — awaiting HandleToolContinuation`
      );
      this.stateManager.queue_complete(response.request.id);
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

      if (
        response.request.next_step === LLMNextStep.HandlePersonaResponse ||
        response.request.next_step === LLMNextStep.HandleToolContinuation
      ) {
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

      if (response.request.next_step === LLMNextStep.HandleOneShotJSON) {
        const guid = response.request.data.guid as string;
        this.interface.onOneShotJSONReturned?.(guid, response.parsed ?? null);
      }

      if (response.request.next_step === LLMNextStep.HandlePersonaPreview) {
        const guid = response.request.data.guid as string;
        const loopCounter = (response.request.data.loop_counter as number) ?? 0;
        const existingPersonaId = response.request.data.personaId as string | undefined;
        const MAX_PREVIEW_LOOPS = 3;
        const entry = this.personaPreviewResolvers.get(guid);
        if (!entry) return;

        if (!response.success || !response.parsed) {
          return;
        }

        let result = response.parsed as import("../prompts/generation/types.js").PersonaGenerationResult;
        const isComplete =
          result.traits && result.traits.length >= 3 &&
          result.topics && result.topics.length >= 3 &&
          result.long_description && result.short_description;

        const hydrateWithExisting = (r: typeof result): typeof result => {
          if (!existingPersonaId) return r;
          const existing = this.stateManager.persona_getById(existingPersonaId);
          if (!existing) return r;

          const existingTraitNames = new Set(existing.traits.map(t => t.name.toLowerCase().trim()));
          const newTraits = r.traits.filter(t => !existingTraitNames.has(t.name.toLowerCase().trim()));
          const mergedTraits = [
            ...existing.traits.map(t => ({
              name: t.name,
              description: t.description,
              strength: t.strength ?? 0.5,
              sentiment: t.sentiment,
            })),
            ...newTraits,
          ];

          const existingTopicNames = new Set(existing.topics.map(t => t.name.toLowerCase().trim()));
          const newTopics = r.topics.filter(t => !existingTopicNames.has(t.name.toLowerCase().trim()));
          const mergedTopics = [...existing.topics, ...newTopics];

          return {
            ...r,
            traits: mergedTraits,
            topics: mergedTopics,
            previous_long_description: existing.long_description,
            previous_short_description: existing.short_description,
            aliases: existing.aliases ?? [],
          };
        };

        if (isComplete) {
          this.personaPreviewResolvers.delete(guid);
          const hydratedComplete = hydrateWithExisting(result);
          const seedTraitNamesComplete = new Set(hydratedComplete.traits.map((t: { name: string }) => t.name.toLowerCase().trim()));
          DEFAULT_SEED_TRAITS
            .filter(s => !seedTraitNamesComplete.has(s.name.toLowerCase().trim()))
            .forEach(s => hydratedComplete.traits.push({ name: s.name, description: s.description, sentiment: s.sentiment, strength: s.strength }));
          entry.resolve(hydratedComplete);
          return;
        }

        if (loopCounter < MAX_PREVIEW_LOOPS) {
          this.stateManager.queue_enqueue({
            type: LLMRequestType.JSON,
            priority: LLMPriority.High,
            system: response.request.system,
            user: response.request.user,
            next_step: LLMNextStep.HandlePersonaPreview,
            model: response.request.model,
            data: { guid, loop_counter: loopCounter + 1, personaId: existingPersonaId },
          });
          return;
        }

        this.personaPreviewResolvers.delete(guid);
        const hydratedFallback = hydrateWithExisting(result);
        const seedTraitNamesFallback = new Set(hydratedFallback.traits.map((t: { name: string }) => t.name.toLowerCase().trim()));
        DEFAULT_SEED_TRAITS
          .filter(s => !seedTraitNamesFallback.has(s.name.toLowerCase().trim()))
          .forEach(s => hydratedFallback.traits.push({ name: s.name, description: s.description, sentiment: s.sentiment, strength: s.strength }));
        entry.resolve(hydratedFallback);
      }

      if (response.request.next_step === LLMNextStep.HandlePersonaGeneration) {
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onPersonaUpdated?.(personaId);
        }
      }

      if (
        response.request.next_step === LLMNextStep.HandlePersonaTraitExtraction ||
        response.request.next_step === LLMNextStep.HandlePersonaTopicRating
      ) {
        const personaId = response.request.data.personaId as string;
        if (personaId) {
          this.interface.onPersonaUpdated?.(personaId);
        }
      }

      if (
        response.request.next_step === LLMNextStep.HandleHeartbeatCheck ||
        response.request.next_step === LLMNextStep.HandleEiHeartbeat
      ) {
        const personaId = (response.request.data.personaId as string) ?? "ei";
        if (response.content) {
          this.interface.onMessageAdded?.(personaId);
        }
      }

      if (
        response.request.next_step === LLMNextStep.HandleTopicUpdate ||
        response.request.next_step === LLMNextStep.HandlePersonUpdate
      ) {
        this.interface.onHumanUpdated?.();
        this.interface.onQuoteAdded?.();
      }

      if (response.request.next_step === LLMNextStep.HandleRewriteRewrite) {
        this.interface.onHumanUpdated?.();
      }

      if (response.request.next_step === LLMNextStep.HandleFactFind) {
        this.interface.onHumanUpdated?.();
      }

      if (response.request.next_step === LLMNextStep.HandleDedupCurate) {
        this.interface.onHumanUpdated?.();
      }

      const isRoomResponse =
        response.request.next_step === LLMNextStep.HandleRoomResponse ||
        (response.request.next_step === LLMNextStep.HandleToolContinuation &&
          response.request.data.originalNextStep === LLMNextStep.HandleRoomResponse);
      if (isRoomResponse) {
        const roomId = response.request.data.roomId as string;
        if (roomId) {
          this.interface.onRoomMessageAdded?.(roomId);
          checkAndQueueRoomExtraction(this.stateManager, roomId);
        }
      }

      if (response.request.next_step === LLMNextStep.HandleRoomJudge) {
        const roomId = response.request.data.roomId as string;
        if (roomId) this.interface.onRoomUpdated?.(roomId);
      }

      if (typeof response.request.data.ceremony_progress === "number") {
        const ceremonyResult = handleCeremonyProgress(this.stateManager, response.request.data.ceremony_progress);
        if (ceremonyResult.wroteEiWarning) {
          this.interface.onMessageAdded?.("ei");
        }
      }

      if (response.request.next_step === LLMNextStep.HandleDocumentSegmentation) {
        const batchId = response.request.data.batchId as string;
        const filename = response.request.data.filename as string;
        if (batchId && !this.stateManager.queue_hasPendingDocumentSegments(batchId)) {
          finishDocumentBatch(batchId, filename, this.stateManager);
          this.interface.onMessageAdded?.("emmet");
          this.interface.onHumanUpdated?.();
        }
      }

      const isSynthesisCompletion =
        response.request.next_step === LLMNextStep.HandleKnowledgeSynthesis ||
        (response.request.next_step === LLMNextStep.HandleToolContinuation &&
          response.request.data.originalNextStep === LLMNextStep.HandleKnowledgeSynthesis);
      if (isSynthesisCompletion) {
        const slug = response.request.data.slug as string;
        const hasContent = slug && this.stateManager.messages_get("emmet")
          .some(m => m.id.startsWith(`generate:document:${slug}:`));
        if (hasContent) this.interface.onDocumentGenerated?.(slug);
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

  // ==========================================================================
  // PERSONA API
  // ==========================================================================

  async getPersonaList(): Promise<PersonaSummary[]> {
    return getPersonaList(this.stateManager);
  }

  async resolvePersonaName(nameOrAlias: string): Promise<string | null> {
    return resolvePersonaName(this.stateManager, nameOrAlias);
  }

  async getPersona(personaId: string): Promise<PersonaEntity | null> {
    return getPersona(this.stateManager, personaId);
  }

  async createPersona(input: PersonaCreationInput): Promise<string> {
    const id = await createPersona(
      this.stateManager,
      input,
      (name) => this.interface.onPersonaUpdated?.(name)
    );
    this.interface.onPersonaAdded?.();
    return id;
  }

  async archivePersona(personaId: string): Promise<void> {
    const ok = await archivePersona(this.stateManager, personaId);
    if (ok) this.interface.onPersonaRemoved?.();
  }

  async unarchivePersona(personaId: string): Promise<void> {
    const ok = await unarchivePersona(this.stateManager, personaId);
    if (ok) this.interface.onPersonaAdded?.();
  }

  async deletePersona(personaId: string, _deleteHumanData: boolean): Promise<void> {
    const ok = await deletePersona(this.stateManager, personaId, _deleteHumanData);
    if (ok) this.interface.onPersonaRemoved?.();
  }

  async updatePersona(personaId: string, updates: Partial<PersonaEntity>): Promise<void> {
    const ok = await updatePersona(this.stateManager, personaId, updates);
    if (ok) this.interface.onPersonaUpdated?.(personaId);
  }

  async finalizeReflection(
    personaId: string,
    action: "apply" | "dismiss",
    identity?: { short_description?: string; long_description: string; traits: NonNullable<PersonaEntity["pending_update"]>["traits"]; topics: NonNullable<PersonaEntity["pending_update"]>["topics"] }
  ): Promise<void> {
    const persona = this.stateManager.persona_getById(personaId);
    if (!persona) return;

    const source = identity ?? (persona.pending_update ? {
      short_description: persona.pending_update.short_description,
      long_description: persona.pending_update.long_description,
      traits: persona.pending_update.traits,
      topics: persona.pending_update.topics,
    } : null);

    const updates: Partial<PersonaEntity> = { pending_update: undefined };

    if (action === "apply" && source) {
      updates.short_description = source.short_description;
      updates.long_description = source.long_description;
      updates.traits = source.traits.map(t => ({
        ...t,
        id: t.id?.startsWith("pending-") ? crypto.randomUUID() : t.id,
      }));
      updates.topics = source.topics.map(t => ({
        ...t,
        id: t.id?.startsWith("pending-") ? crypto.randomUUID() : t.id,
      }));
    }

    const ok = await updatePersona(this.stateManager, personaId, updates);
    if (ok) {
      queueReflectionDrain(personaId, this.stateManager);
      this.interface.onPersonaUpdated?.(personaId);
    }
  }

  async updateRoom(roomId: string, updates: Partial<RoomEntity>): Promise<void> {
    const ok = this.stateManager.updateRoom(roomId, updates);
    if (ok) this.interface.onRoomUpdated?.(roomId);
  }

  async getGroupList(): Promise<string[]> {
    return getGroupList(this.stateManager);
  }

  // ==========================================================================
  // MESSAGE API
  // ==========================================================================

  async getMessages(personaId: string, _options?: MessageQueryOptions): Promise<Message[]> {
    return getMessages(this.stateManager, personaId, _options);
  }

  async markMessageRead(personaId: string, messageId: string): Promise<boolean> {
    return markMessageRead(this.stateManager, personaId, messageId);
  }

  async markAllMessagesRead(personaId: string): Promise<number> {
    return markAllMessagesRead(this.stateManager, personaId);
  }

  async recallPendingMessages(personaId: string): Promise<string> {
    return recallPendingMessages(
      this.stateManager,
      this.queueProcessor,
      this.currentRequest,
      personaId,
      (id) => this.interface.onMessageAdded?.(id),
      (id, content) => this.interface.onMessageRecalled?.(id, content)
    );
  }

  async sendMessage(personaId: string, content: string | null, silenceReason?: string): Promise<void> {
    return sendMessage(
      this.stateManager,
      this.queueProcessor,
      this.currentRequest,
      personaId,
      content,
      this.isTUI,
      (id) => getModelForPersona(this.stateManager, id),
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onMessageAdded?.(id),
      (id) => this.interface.onMessageQueued?.(id),
      silenceReason
    );
  }

  async setContextBoundary(personaId: string, timestamp: string | null): Promise<void> {
    await setContextBoundary(this.stateManager, personaId, timestamp);
    this.interface.onContextBoundaryChanged?.(personaId);
  }

  async setMessageContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): Promise<void> {
    return setMessageContextStatus(this.stateManager, personaId, messageId, status);
  }

  async deleteMessages(personaId: string, messageIds: string[]): Promise<Message[]> {
    const removed = await deleteMessages(this.stateManager, personaId, messageIds);
    this.interface.onMessageAdded?.(personaId);
    return removed;
  }

  async addMessageOnly(personaId: string, message: Message): Promise<void> {
    this.stateManager.messages_append(personaId, message);
    this.interface.onMessageAdded?.(personaId);
  }

  async updateMessage(personaId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    this.stateManager.messages_update(personaId, messageId, updates);
    this.interface.onMessageAdded?.(personaId);
  }

  // ==========================================================================
  // HUMAN DATA API
  // ==========================================================================

  async getHuman(): Promise<HumanEntity> {
    return getHuman(this.stateManager);
  }

  async updateHuman(updates: Partial<HumanEntity>): Promise<void> {
    await updateHuman(this.stateManager, updates);
    this.interface.onHumanUpdated?.();
  }

  async upsertFact(fact: Fact): Promise<void> {
    await upsertFact(this.stateManager, fact);
    this.interface.onHumanUpdated?.();
  }


  async upsertTopic(topic: Topic): Promise<void> {
    await upsertTopic(this.stateManager, topic);
    this.interface.onHumanUpdated?.();
  }

  async upsertPerson(person: Person): Promise<void> {
    const sanitized = { ...person, identifiers: sanitizeEiPersonaIdentifiers(person.identifiers ?? [], this.stateManager.persona_getAll()) };
    await upsertPerson(this.stateManager, sanitized);
    this.interface.onHumanUpdated?.();
  }

  async removeDataItem(
    type: "fact" | "topic" | "person",
    id: string
  ): Promise<void> {
    await removeDataItem(this.stateManager, type, id);
    this.interface.onHumanUpdated?.();
  }

  async addQuote(quote: Quote): Promise<void> {
    await addQuote(this.stateManager, quote);
    this.interface.onQuoteAdded?.();
  }

  async updateQuote(id: string, updates: Partial<Quote>): Promise<void> {
    await updateQuote(this.stateManager, id, updates);
    this.interface.onQuoteUpdated?.();
  }

  async removeQuote(id: string): Promise<void> {
    await removeQuote(this.stateManager, id);
    this.interface.onQuoteRemoved?.();
  }

  async getQuotes(filter?: { message_id?: string; data_item_id?: string }): Promise<Quote[]> {
    return getQuotes(this.stateManager, filter);
  }

  async getQuotesForMessage(messageId: string): Promise<Quote[]> {
    return getQuotesForMessage(this.stateManager, messageId);
  }

  async searchHumanData(
    query: string,
    options: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number; recent?: boolean; persona_filter?: string } = {}
  ): Promise<{
    facts: Fact[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
  }> {
    return searchHumanData(this.stateManager, query, options);
  }

  // ==========================================================================
  // STATE IMPORT / EXPORT
  // ==========================================================================

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

  async getStorageState(): Promise<StorageState> {
    return this.stateManager.getStorageState();
  }

  async restoreFromState(state: StorageState): Promise<void> {
    return this.stateManager.restoreFromState(state);
  }

  // ==========================================================================
  // QUEUE API
  // ==========================================================================

  async abortCurrentOperation(): Promise<void> {
    return abortCurrentOperation(this.stateManager, this.queueProcessor);
  }

  async resumeQueue(): Promise<void> {
    return resumeQueue(this.stateManager);
  }

  async getQueueStatus(): Promise<QueueStatus> {
    return getQueueStatus(this.stateManager);
  }

  pauseQueue(): void {
    pauseQueue(this.stateManager, this.queueProcessor);
  }

  getQueueActiveItems(): LLMRequest[] {
    return getQueueActiveItems(this.stateManager);
  }

  getDLQItems(): LLMRequest[] {
    return getDLQItems(this.stateManager);
  }

  updateQueueItem(id: string, updates: Partial<LLMRequest>): boolean {
    return updateQueueItem(this.stateManager, id, updates);
  }

  deleteQueueItems(ids: string[]): number {
    return deleteQueueItems(this.stateManager, ids);
  }

  async clearQueue(): Promise<number> {
    return clearQueue(this.stateManager, this.queueProcessor);
  }

  queueUserDedup(itemType: "topic" | "person", entityIds: string[]): void {
    queueUserDedupRequest(this.stateManager, itemType, entityIds);
  }

  capturePersona(personaId: string): void {
    queuePersonaCapture(this.stateManager, personaId);
  }

  captureRoom(roomId: string): void {
    queueRoomCapture(this.stateManager, roomId);
  }

  captureTargetedPerson(personId: string, personaId: string, roomId?: string): number {
    return queueTargetedPersonUpdate(personId, personaId, this.stateManager, roomId);
  }

  captureTargetedTopic(topicId: string, personaId: string, roomId?: string): number {
    return queueTargetedTopicUpdate(topicId, personaId, this.stateManager, roomId);
  }

  async submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void> {
    return submitOneShot(
      this.stateManager,
      () => getOneshotModel(this.stateManager),
      guid,
      systemPrompt,
      userPrompt
    );
  }

  async submitOneShotJSON(guid: string, systemPrompt: string, userPrompt: string): Promise<void> {
    return submitOneShotJSON(
      this.stateManager,
      () => getOneshotModel(this.stateManager),
      guid,
      systemPrompt,
      userPrompt
    );
  }

  async generatePersonaPreview(
    name: string,
    description: string,
    relationship?: string,
    personaId?: string
  ): Promise<PersonaGenerationResult> {
    let existing_trait_names: string[] | undefined;
    let existing_topic_names: string[] | undefined;

    if (personaId) {
      const existing = this.stateManager.persona_getById(personaId);
      if (existing) {
        existing_trait_names = existing.traits.map((t) => t.name);
        existing_topic_names = existing.topics.map((t) => t.name);
      }
    }

    const prompt = buildPersonaFromPersonPrompt({
      name,
      description,
      relationship,
      existing_trait_names,
      existing_topic_names,
    });
    const guid = crypto.randomUUID();
    return new Promise<PersonaGenerationResult>((resolve, reject) => {
      this.personaPreviewResolvers.set(guid, { resolve, reject });
      this.stateManager.queue_enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.High,
        system: prompt.system,
        user: prompt.user,
        next_step: LLMNextStep.HandlePersonaPreview,
        model: getOneshotModel(this.stateManager),
        data: { guid, loop_counter: 0, personaId },
      });
    });
  }

  // ==========================================================================
  // TOOL API
  // ==========================================================================

  getToolProviderList(): ToolProvider[] {
    return getToolProviderList(this.stateManager);
  }

  getToolProvider(id: string): ToolProvider | null {
    return getToolProvider(this.stateManager, id);
  }

  async addToolProvider(provider: Omit<ToolProvider, "id" | "created_at">): Promise<string> {
    const id = await addToolProvider(this.stateManager, provider);
    this.interface.onToolProviderAdded?.();
    return id;
  }

  async updateToolProvider(
    id: string,
    updates: Partial<Omit<ToolProvider, "id" | "created_at">>
  ): Promise<boolean> {
    const result = await updateToolProvider(this.stateManager, id, updates);
    if (result) this.interface.onToolProviderUpdated?.(id);
    return result;
  }

  async removeToolProvider(id: string): Promise<boolean> {
    const result = await removeToolProvider(this.stateManager, id);
    if (result) this.interface.onToolProviderRemoved?.();
    return result;
  }

  getToolList(): ToolDefinition[] {
    return getToolList(this.stateManager);
  }

  getTool(id: string): ToolDefinition | null {
    return getTool(this.stateManager, id);
  }

  async addTool(tool: Omit<ToolDefinition, "id" | "created_at">): Promise<string> {
    const id = await addTool(this.stateManager, tool);
    this.interface.onToolAdded?.();
    return id;
  }

  async updateTool(
    id: string,
    updates: Partial<Omit<ToolDefinition, "id" | "created_at">>
  ): Promise<boolean> {
    const result = await updateTool(this.stateManager, id, updates);
    if (result) this.interface.onToolUpdated?.(id);
    return result;
  }

  async removeTool(id: string): Promise<boolean> {
    const result = await removeTool(this.stateManager, id);
    if (result) this.interface.onToolRemoved?.();
    return result;
  }

  // ==========================================================================
  // ROOM API
  // ==========================================================================

  getRoomList(includeArchived = false): RoomSummary[] {
    return getRoomList(this.stateManager, includeArchived);
  }

  getRoom(roomId: string): RoomEntity | null {
    return getRoom(this.stateManager, roomId);
  }

  getRoomMessages(roomId: string): RoomMessage[] {
    return getRoomMessages(this.stateManager, roomId);
  }

  getRoomActivePath(roomId: string): RoomMessage[] {
    return getRoomActivePath(this.stateManager, roomId);
  }

  resolveRoomName(nameOrAlias: string): string | null {
    return resolveRoomName(this.stateManager, nameOrAlias);
  }

  async createRoom(input: RoomCreationInput): Promise<string> {
    const id = await createRoom(
      this.stateManager,
      input,
      this.isTUI,
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onRoomMessageAdded?.(id),
      (id) => this.interface.onRoomMessageQueued?.(id)
    );
    if (id) this.interface.onRoomAdded?.();
    return id;
  }

  submitHumanRoomMessage(
    roomId: string,
    content: string | null,
    silenceReason?: string
  ): string | null {
    return submitHumanRoomMessage(
      this.stateManager,
      roomId,
      content,
      silenceReason,
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onRoomMessageAdded?.(id)
    );
  }

  recallHumanRoomMessage(roomId: string): boolean {
    return recallHumanRoomMessage(
      this.stateManager,
      roomId,
      (id) => this.interface.onRoomUpdated?.(id)
    );
  }

  async activateRoom(roomId: string): Promise<void> {
    return activateRoom(
      this.stateManager,
      roomId,
      this.isTUI,
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onRoomUpdated?.(id),
      (id) => this.interface.onRoomMessageQueued?.(id)
    );
  }

  async sendFfaMessage(
    roomId: string,
    content: string | null,
    silenceReason?: string
  ): Promise<void> {
    return sendFfaMessage(
      this.stateManager,
      roomId,
      content,
      silenceReason,
      this.isTUI,
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onRoomUpdated?.(id),
      (id) => this.interface.onRoomMessageAdded?.(id),
      (id) => this.interface.onRoomMessageQueued?.(id)
    );
  }

  async selectCYPBranch(roomId: string, messageId: string): Promise<void> {
    return selectCYPBranch(
      this.stateManager,
      roomId,
      messageId,
      this.isTUI,
      (err) => this.interface.onError?.(err),
      (id) => this.interface.onRoomUpdated?.(id),
      (id) => this.interface.onRoomMessageQueued?.(id)
    );
  }

  async archiveRoom(roomId: string): Promise<void> {
    const ok = archiveRoom(this.stateManager, roomId);
    if (ok) this.interface.onRoomRemoved?.();
  }

  async unarchiveRoom(roomId: string): Promise<void> {
    const ok = unarchiveRoom(this.stateManager, roomId);
    if (ok) this.interface.onRoomAdded?.();
  }

  async deleteRoom(roomId: string): Promise<void> {
    const ok = deleteRoom(this.stateManager, roomId);
    if (ok) this.interface.onRoomRemoved?.();
  }

  async markAllRoomMessagesRead(roomId: string): Promise<number> {
    return markAllRoomMessagesRead(this.stateManager, roomId);
  }

  // ==========================================================================
  // DEBUG / TESTING UTILITIES
  // ==========================================================================

  /**
   * Manually trigger ceremony execution, bypassing time checks.
   *
   * USE FROM BROWSER DEVTOOLS:
   *   processor.triggerCeremonyNow()
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
