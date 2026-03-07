import {
  LLMNextStep,
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
  type LLMResponse,
  type StorageState,
  type StateConflictResolution,
  type StateConflictData,
  type ToolDefinition,
  type ToolProvider,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import { remoteSync } from "../storage/remote.js";
import { yoloMerge } from "../storage/merge.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import { handlers } from "./handlers/index.js";
import { ContextStatus as ContextStatusEnum } from "./types.js";
import { registerReadMemoryExecutor, registerFileReadExecutor } from "./tools/index.js";
import { createReadMemoryExecutor } from "./tools/builtin/read-memory.js";
import { EI_WELCOME_MESSAGE, EI_PERSONA_DEFINITION } from "../templates/welcome.js";
import { shouldStartCeremony, startCeremony, handleCeremonyProgress } from "./orchestrators/index.js";

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
  upsertTrait,
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
  clearQueue,
  submitOneShot,
} from "./queue-manager.js";

const DEFAULT_LOOP_INTERVAL_MS = 100;
const DEFAULT_CONTEXT_WINDOW_HOURS = 8;
const DEFAULT_OPENCODE_POLLING_MS = 1800000;
const DEFAULT_CLAUDE_CODE_POLLING_MS = 1800000;

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
  private lastOpenCodeSync = 0;
  private lastDLQTrim = 0;
  private openCodeImportInProgress = false;
  private lastClaudeCodeSync = 0;
  private claudeCodeImportInProgress = false;
  private pendingConflict: StateConflictData | null = null;
  private storage: Storage | null = null;
  private importAbortController = new AbortController();

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

    if (!this.stateManager.hasExistingData() || this.stateManager.persona_getAll().length === 0) {
      await this.bootstrapFirstRun();
    }
    this.bootstrapTools();
    registerReadMemoryExecutor(createReadMemoryExecutor(this.searchHumanData.bind(this)));
    if (this.isTUI) {
      registerFileReadExecutor();
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

  /**
   * Seed built-in tool providers and tools if they don't exist yet.
   * Called on every startup (after state load/restore) — safe to call repeatedly.
   * New builtins added in future releases will be seeded automatically.
   */
  private bootstrapTools(): void {
    const now = new Date().toISOString();

    // --- Ei built-in provider ---
    if (!this.stateManager.tools_getProviderById("ei")) {
      const eiProvider: ToolProvider = {
        id: "ei",
        name: "ei",
        display_name: "Ei Built-ins",
        description: "Built-in tools that ship with Ei. No external API needed.",
        builtin: true,
        config: {},
        enabled: true,
        created_at: now,
      };
      this.stateManager.tools_addProvider(eiProvider);
    }

    // read_memory tool
    if (!this.stateManager.tools_getByName("read_memory")) {
      this.stateManager.tools_add({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "read_memory",
        display_name: "Read Memory",
        description:
          "Search your personal memory for relevant facts, traits, topics, people, or quotes. Use this when you need information about the user that may not be in the current conversation.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for in memory" },
            types: {
              type: "array",
              items: { type: "string", enum: ["fact", "trait", "topic", "person", "quote"] },
              description: "Limit search to specific memory types (default: all types)",
            },
            limit: { type: "number", description: "Max results to return (default: 10, max: 20)" },
          },
          required: ["query"],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
      });
    }

    // file_read tool (TUI only)
    if (!this.stateManager.tools_getByName("file_read")) {
      this.stateManager.tools_add({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "file_read",
        display_name: "Read File",
        description:
          "Read the contents of a file from the local filesystem. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or relative path to the file" },
          },
          required: ["path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 5,
      });
    }

    // --- Tavily Search provider ---
    if (!this.stateManager.tools_getProviderById("tavily")) {
      const tavilyProvider: ToolProvider = {
        id: "tavily",
        name: "tavily",
        display_name: "Tavily Search",
        description:
          "Browser-compatible web search. Requires a Tavily API key (free tier: 1000 requests/month).",
        builtin: true,
        config: { api_key: "" },
        enabled: false,
        created_at: now,
      };
      this.stateManager.tools_addProvider(tavilyProvider);
    }

    // tavily_web_search
    if (!this.stateManager.tools_getByName("tavily_web_search")) {
      this.stateManager.tools_add({
        id: crypto.randomUUID(),
        provider_id: "tavily",
        name: "tavily_web_search",
        display_name: "Web Search",
        description:
          "Search the web using Tavily. Use for current events, fact verification, or any topic that benefits from up-to-date information.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: { type: "number", description: "Number of results (default: 5, max: 10)" },
          },
          required: ["query"],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
      });
    }

    // tavily_news_search
    if (!this.stateManager.tools_getByName("tavily_news_search")) {
      this.stateManager.tools_add({
        id: crypto.randomUUID(),
        provider_id: "tavily",
        name: "tavily_news_search",
        display_name: "News Search",
        description:
          "Search recent news articles using Tavily. Use for current events and recent developments.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "News search query" },
            max_results: { type: "number", description: "Number of results (default: 5, max: 10)" },
          },
          required: ["query"],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
      });
    }
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

  async saveAndExit(): Promise<{ success: boolean; error?: string }> {
    console.log(`[Processor ${this.instanceId}] saveAndExit() called`);
    this.interface.onSaveAndExitStart?.();

    this.queueProcessor.abort();
    this.importAbortController.abort();
    if (this.openCodeImportInProgress) {
      console.log(`[Processor ${this.instanceId}] Aborting OpenCode import in progress`);
      this.openCodeImportInProgress = false;
    }
    if (this.claudeCodeImportInProgress) {
      console.log(`[Processor ${this.instanceId}] Aborting Claude Code import in progress`);
      this.claudeCodeImportInProgress = false;
    }

    await this.stateManager.flush();

    const human = this.stateManager.getHuman();
    const hasSyncCreds =
      !!human.settings?.sync?.username && !!human.settings?.sync?.passphrase;

    if (hasSyncCreds && remoteSync.isConfigured()) {
      const state = this.stateManager.getStorageState();
      const result = await remoteSync.sync(state);

      if (!result.success) {
        console.log(`[Processor ${this.instanceId}] Remote sync failed: ${result.error}`);
        this.importAbortController = new AbortController();
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
            console.log(
              `[Processor ${this.instanceId}] processing request: ${request.next_step}${personaSuffix}`
            );
            this.currentRequest = request;

            if (personaId && request.next_step === LLMNextStep.HandlePersonaResponse) {
              this.interface.onMessageProcessing?.(personaId);
            }

            const toolNextSteps = new Set([
              LLMNextStep.HandlePersonaResponse,
              LLMNextStep.HandleHeartbeatCheck,
              LLMNextStep.HandleEiHeartbeat,
            ]);
            const toolPersonaId =
              personaId ??
              (request.next_step === LLMNextStep.HandleEiHeartbeat ? "ei" : undefined);
            const tools =
              toolNextSteps.has(request.next_step) && toolPersonaId
                ? this.stateManager.tools_getForPersona(toolPersonaId, this.isTUI)
                : [];
            console.log(
              `[Tools] Dispatch for ${request.next_step} persona=${toolPersonaId ?? "none"}: ${tools.length} tool(s) attached`
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
                rawMessageFetcher: (pName) => this.stateManager.messages_get(pName),
                tools: tools.length > 0 ? tools : undefined,
                onEnqueue: (req) => this.stateManager.queue_enqueue(req),
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
    const DEFAULT_HEARTBEAT_DELAY_MS = 1800000;

    const human = this.stateManager.getHuman();

    if (
      this.isTUI &&
      human.settings?.opencode?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncOpenCode(human, now);
    }

    if (this.isTUI && human.settings?.backup?.enabled) {
      await this.checkAndRunRollingBackup(human, now);
    }
    if (
      this.isTUI &&
      human.settings?.claudeCode?.integration &&
      this.stateManager.queue_length() === 0
    ) {
      await this.checkAndSyncClaudeCode(human, now);
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
      if (persona.is_paused || persona.is_archived) continue;

      const heartbeatDelay = persona.heartbeat_delay_ms ?? DEFAULT_HEARTBEAT_DELAY_MS;
      const lastActivity = persona.last_activity
        ? new Date(persona.last_activity).getTime()
        : 0;
      const timeSinceActivity = now - lastActivity;

      if (timeSinceActivity >= heartbeatDelay) {
        const lastHeartbeat = persona.last_heartbeat
          ? new Date(persona.last_heartbeat).getTime()
          : 0;
        const timeSinceHeartbeat = now - lastHeartbeat;

        if (timeSinceHeartbeat >= heartbeatDelay) {
          const history = this.stateManager.messages_get(persona.id);
          const contextWindowHours =
            persona.context_window_hours ?? DEFAULT_CONTEXT_WINDOW_HOURS;
          const contextHistory = filterMessagesForContext(
            history,
            persona.context_boundary,
            contextWindowHours
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

  private async checkAndRunRollingBackup(human: HumanEntity, now: number): Promise<void> {
    if (!this.storage) return;
    const cfg = human.settings!.backup!;
    const intervalMs = cfg.interval_ms ?? 3_600_000;
    const maxBackups = cfg.max_backups ?? 24;
    const lastBackup = cfg.last_backup ? new Date(cfg.last_backup).getTime() : 0;

    if (now - lastBackup < intervalMs) return;

    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        backup: { ...cfg, last_backup: new Date(now).toISOString() },
      },
    });

    const state = this.stateManager.getStorageState();
    try {
      await this.storage.saveRollingBackup(state, maxBackups);
      console.log(`[Processor] Rolling backup saved (max=${maxBackups})`);
    } catch (err) {
      console.warn(`[Processor] Rolling backup failed:`, err);
    }
  }

  private async checkAndSyncOpenCode(human: HumanEntity, now: number): Promise<void> {
    if (this.openCodeImportInProgress) {
      return;
    }

    const opencode = human.settings?.opencode;
    const pollingInterval = opencode?.polling_interval_ms ?? DEFAULT_OPENCODE_POLLING_MS;
    const lastSync = opencode?.last_sync ? new Date(opencode.last_sync).getTime() : 0;
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
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] OpenCode sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.messagesImported} messages imported, ` +
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

  private async checkAndSyncClaudeCode(human: HumanEntity, now: number): Promise<void> {
    if (this.claudeCodeImportInProgress) {
      return;
    }

    const claudeCode = human.settings?.claudeCode;
    const pollingInterval = claudeCode?.polling_interval_ms ?? DEFAULT_CLAUDE_CODE_POLLING_MS;
    const lastSync = claudeCode?.last_sync ? new Date(claudeCode.last_sync).getTime() : 0;
    const timeSinceSync = now - lastSync;

    if (timeSinceSync < pollingInterval && this.lastClaudeCodeSync > 0) {
      return;
    }

    this.lastClaudeCodeSync = now;
    const syncTimestamp = new Date().toISOString();
    this.stateManager.setHuman({
      ...this.stateManager.getHuman(),
      settings: {
        ...this.stateManager.getHuman().settings,
        claudeCode: {
          ...claudeCode,
          last_sync: syncTimestamp,
        },
      },
    });

    this.claudeCodeImportInProgress = true;
    import("../integrations/claude-code/importer.js")
      .then(({ importClaudeCodeSessions }) =>
        importClaudeCodeSessions({
          stateManager: this.stateManager,
          interface: this.interface,
          signal: this.importAbortController.signal,
        })
      )
      .then((result) => {
        if (result.sessionsProcessed > 0) {
          console.log(
            `[Processor] Claude Code sync complete: ${result.sessionsProcessed} sessions, ` +
              `${result.topicsCreated} topics created, ${result.messagesImported} messages imported, ` +
              `${result.extractionScansQueued} extraction scans queued`
          );
        }
      })
      .catch((err) => {
        console.warn(`[Processor] Claude Code sync failed:`, err);
      })
      .finally(() => {
        this.claudeCodeImportInProgress = false;
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
        if (response.request.next_step === LLMNextStep.HandleOneShot) {
          const guid = response.request.data.guid as string;
          this.interface.onOneShotReturned?.(guid, "");
        }
      }

      this.interface.onError?.({ code, message });
      return;
    }

    if (response.finish_reason === "tool_calls_enqueued") {
      console.log(
        `[Processor] tool_calls_enqueued for ${response.request.next_step} — awaiting HandleToolSynthesis`
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
        response.request.next_step === LLMNextStep.HandleToolSynthesis
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

      if (
        response.request.next_step === LLMNextStep.HandleHeartbeatCheck ||
        response.request.next_step === LLMNextStep.HandleEiHeartbeat
      ) {
        const personaId = (response.request.data.personaId as string) ?? "ei";
        if (response.content) {
          this.interface.onMessageAdded?.(personaId);
        }
      }

      if (response.request.next_step === LLMNextStep.HandleHumanItemUpdate) {
        this.interface.onHumanUpdated?.();
        this.interface.onQuoteAdded?.();
      }

      if (response.request.next_step === LLMNextStep.HandleRewriteRewrite) {
        this.interface.onHumanUpdated?.();
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

  async sendMessage(personaId: string, content: string): Promise<void> {
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
      (id) => this.interface.onMessageQueued?.(id)
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

  async upsertTrait(trait: Trait): Promise<void> {
    await upsertTrait(this.stateManager, trait);
    this.interface.onHumanUpdated?.();
  }

  async upsertTopic(topic: Topic): Promise<void> {
    await upsertTopic(this.stateManager, topic);
    this.interface.onHumanUpdated?.();
  }

  async upsertPerson(person: Person): Promise<void> {
    await upsertPerson(this.stateManager, person);
    this.interface.onHumanUpdated?.();
  }

  async removeDataItem(
    type: "fact" | "trait" | "topic" | "person",
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
    options: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number } = {}
  ): Promise<{
    facts: Fact[];
    traits: Trait[];
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

  async clearQueue(): Promise<number> {
    return clearQueue(this.stateManager, this.queueProcessor);
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
