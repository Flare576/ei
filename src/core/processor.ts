import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  type Ei_Interface,
  type PersonaSummary,
  type PersonaEntity,
  type Message,
  type MessageQueryOptions,
  type HumanEntity,
  type Fact,
  type Trait,
  type Topic,
  type Person,
  type Checkpoint,
  type QueueStatus,
  type ContextStatus,
  type LLMResponse,
  type DataItemBase,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";
import { handlers } from "./handlers/index.js";
import { buildResponsePrompt, type ResponsePromptData } from "../prompts/index.js";
import { EI_WELCOME_MESSAGE, EI_PERSONA_DEFINITION } from "../templates/welcome.js";
import { ContextStatus as ContextStatusEnum } from "./types.js";

const DEFAULT_LOOP_INTERVAL_MS = 100;
const DEFAULT_AUTO_SAVE_INTERVAL_MS = 60000;

let processorInstanceCount = 0;

export class Processor {
  private stateManager = new StateManager();
  private queueProcessor = new QueueProcessor();
  private interface: Ei_Interface;
  private running = false;
  private stopped = false;
  private lastAutoSave = 0;
  private autoSaveInterval = DEFAULT_AUTO_SAVE_INTERVAL_MS;
  private instanceId: number;

  constructor(ei: Ei_Interface) {
    this.interface = ei;
    this.instanceId = ++processorInstanceCount;
    console.log(`[Processor ${this.instanceId}] CREATED`);
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

    const eiEntity: PersonaEntity = {
      ...EI_PERSONA_DEFINITION,
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    };
    this.stateManager.persona_add("ei", eiEntity);

    const welcomeMessage: Message = {
      id: crypto.randomUUID(),
      role: "system",
      content: EI_WELCOME_MESSAGE,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: ContextStatusEnum.Always,
    };
    this.stateManager.messages_append("ei", welcomeMessage);

    this.interface.onPersonaAdded?.();
    this.interface.onMessageAdded?.("ei");
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
        this.interface.onCheckpointStart?.();
        await this.stateManager.checkpoint_saveAuto();
        this.interface.onCheckpointCreated?.();
        this.lastAutoSave = Date.now();
      }

      await this.checkScheduledTasks();

      if (this.queueProcessor.getState() === "idle") {
        const request = this.stateManager.queue_peekHighest();
        if (request) {
          console.log(`[Processor ${this.instanceId}] processing request: ${request.next_step}`);
          this.interface.onQueueStateChanged?.("busy");

          const personaName = request.data.personaName as string | undefined;
          if (personaName && request.next_step === LLMNextStep.HandlePersonaResponse) {
            this.interface.onMessageProcessing?.(personaName);
          }

          this.queueProcessor.start(request, (response) => {
            this.handleResponse(response);
            this.interface.onQueueStateChanged?.("idle");
          });
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
    const DEFAULT_HEARTBEAT_DELAY_MS = 1800000;

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
          this.queueHeartbeatCheck(persona.aliases?.[0] ?? "Unknown");
        }
      }
    }
  }

  private queueHeartbeatCheck(personaName: string): void {
    this.stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: "",
      user: "",
      next_step: LLMNextStep.HandleHeartbeatCheck,
      data: { personaName },
    });
  }

  private handleResponse(response: LLMResponse): void {
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
      handler(response, this.stateManager);
      this.stateManager.queue_complete(response.request.id);

      if (response.request.next_step === LLMNextStep.HandlePersonaResponse && response.content) {
        const personaName = response.request.data.personaName as string;
        if (personaName) {
          this.interface.onMessageAdded?.(personaName);
        }
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
    return this.stateManager.persona_getAll().map((entity) => ({
      name: entity.aliases?.[0] ?? "Unknown",
      aliases: entity.aliases ?? [],
      short_description: entity.short_description,
      is_paused: entity.is_paused,
      is_archived: entity.is_archived,
      unread_count: 0,
      last_activity: entity.last_activity,
    }));
  }

  async getPersona(name: string): Promise<PersonaEntity | null> {
    return this.stateManager.persona_get(name);
  }

  async createPersona(name: string, description: string, model?: string): Promise<void> {
    const entity: PersonaEntity = {
      entity: "system",
      aliases: [name],
      short_description: description,
      model,
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    };
    this.stateManager.persona_add(name, entity);
    this.interface.onPersonaAdded?.();
  }

  async archivePersona(name: string): Promise<void> {
    this.stateManager.persona_archive(name);
    this.interface.onPersonaRemoved?.();
  }

  async unarchivePersona(name: string): Promise<void> {
    this.stateManager.persona_unarchive(name);
    this.interface.onPersonaAdded?.();
  }

  async deletePersona(name: string, _deleteHumanData: boolean): Promise<void> {
    this.stateManager.persona_delete(name);
    this.interface.onPersonaRemoved?.();
  }

  async updatePersona(name: string, updates: Partial<PersonaEntity>): Promise<void> {
    this.stateManager.persona_update(name, updates);
    this.interface.onPersonaUpdated?.(name);
  }

  async getMessages(personaName: string, _options?: MessageQueryOptions): Promise<Message[]> {
    return this.stateManager.messages_get(personaName);
  }

  async sendMessage(personaName: string, content: string): Promise<void> {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "human",
      content,
      timestamp: new Date().toISOString(),
      read: true,
      context_status: "default" as ContextStatus,
    };
    this.stateManager.messages_append(personaName, message);
    this.interface.onMessageAdded?.(personaName);

    const persona = this.stateManager.persona_get(personaName);
    if (!persona) {
      this.interface.onError?.({
        code: "PERSONA_NOT_FOUND",
        message: `Persona "${personaName}" not found`,
      });
      return;
    }

    const history = this.stateManager.messages_get(personaName);
    const chatMessages = history.map((m) => ({
      role: m.role === "human" ? "user" : "assistant",
      content: m.content,
    })) as import("./types.js").ChatMessage[];

    const promptData = this.buildResponsePromptData(personaName, persona);
    const prompt = buildResponsePrompt(promptData);

    this.stateManager.queue_enqueue({
      type: LLMRequestType.Response,
      priority: LLMPriority.Normal,
      system: prompt.system,
      user: prompt.user,
      messages: chatMessages,
      next_step: LLMNextStep.HandlePersonaResponse,
      data: { personaName },
    });
    this.interface.onMessageQueued?.(personaName);
  }

  private buildResponsePromptData(personaName: string, persona: PersonaEntity): ResponsePromptData {
    const human = this.stateManager.getHuman();
    const filteredHuman = this.filterHumanDataByVisibility(human, persona);
    const visiblePersonas = this.getVisiblePersonas(personaName, persona);
    const messages = this.stateManager.messages_get(personaName);
    const previousMessage = messages.length >= 2 ? messages[messages.length - 2] : null;
    const delayMs = previousMessage
      ? Date.now() - new Date(previousMessage.timestamp).getTime()
      : 0;

    return {
      persona: {
        name: personaName,
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
    const GLOBAL_GROUP = "*";

    if (persona.groups_visible?.includes(GLOBAL_GROUP)) {
      return {
        facts: human.facts,
        traits: human.traits,
        topics: human.topics,
        people: human.people,
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
        const isGlobal = itemGroups.length === 0 || itemGroups.includes(GLOBAL_GROUP);
        return isGlobal || itemGroups.some((g) => visibleGroups.has(g));
      });
    };

    return {
      facts: filterByGroup(human.facts),
      traits: filterByGroup(human.traits),
      topics: filterByGroup(human.topics),
      people: filterByGroup(human.people),
    };
  }

  private getVisiblePersonas(
    currentName: string,
    currentPersona: PersonaEntity
  ): Array<{ name: string; short_description?: string }> {
    const allPersonas = this.stateManager.persona_getAll();

    if (currentName.toLowerCase() === "ei") {
      return allPersonas
        .filter((p) => (p.aliases?.[0] ?? "").toLowerCase() !== "ei" && !p.is_archived)
        .map((p) => ({
          name: p.aliases?.[0] ?? "Unknown",
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
        const name = p.aliases?.[0] ?? "";
        if (name === currentName || name.toLowerCase() === "ei" || p.is_archived) {
          return false;
        }
        return p.group_primary && visibleGroups.has(p.group_primary);
      })
      .map((p) => ({
        name: p.aliases?.[0] ?? "Unknown",
        short_description: p.short_description,
      }));
  }

  async setContextWindow(personaName: string, start: string, end: string): Promise<void> {
    this.stateManager.messages_setContextWindow(personaName, start, end);
  }

  async setMessageContextStatus(
    personaName: string,
    messageId: string,
    status: ContextStatus
  ): Promise<void> {
    this.stateManager.messages_setContextStatus(personaName, messageId, status);
  }

  async getHuman(): Promise<HumanEntity> {
    return this.stateManager.getHuman();
  }

  async updateHuman(updates: Partial<HumanEntity>): Promise<void> {
    const current = this.stateManager.getHuman();
    this.stateManager.setHuman({ ...current, ...updates });
    this.interface.onHumanUpdated?.();
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
    return this.stateManager.checkpoint_restore(index);
  }

  async exportState(): Promise<string> {
    return JSON.stringify(this.stateManager.getHuman(), null, 2);
  }

  async getPersonaCreationTemplate(): Promise<string> {
    return "Describe your persona's personality, interests, and communication style.";
  }

  async abortCurrentOperation(): Promise<void> {
    this.queueProcessor.abort();
    this.stateManager.queue_pause();
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
}
