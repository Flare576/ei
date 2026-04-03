import type {
  HumanEntity,
  PersonaEntity,
  Message,
  Fact,
  Topic,
  Person,
  Quote,
  LLMRequest,
  StorageState,
  ContextStatus,
  QueueFailResult,
  ToolDefinition,
  ToolProvider,
  RoomEntity,
  RoomMessage,
  RoomSummary,
  RoomCreationInput,
} from "./types.js";
import { BUILT_IN_FACT_NAMES } from './constants/built-in-facts.js';
import type { Storage } from "../storage/interface.js";
import {
  HumanState,
  PersonaState,
  QueueState,
  PersistenceState,
  RoomState,
  createDefaultHumanEntity,
} from "./state/index.js";

export class StateManager {
  private humanState = new HumanState();
  private personaState = new PersonaState();
  private roomState = new RoomState();
  private queueState = new QueueState();
  private persistenceState = new PersistenceState();
  private providers: ToolProvider[] = [];
  private tools: ToolDefinition[] = [];
  private embeddingWarning = false;

  async initialize(storage: Storage): Promise<void> {
    this.persistenceState.setStorage(storage);

    const state = await this.persistenceState.load();

    if (state) {
      this.humanState.load(state.human);
      this.personaState.load(state.personas);
      this.roomState.load(state.rooms);
      this.queueState.load(state.queue);
      this.tools = state.tools ?? [];
      this.providers = state.providers ?? [];
      this.runMigrations();
    } else {
      this.humanState.load(createDefaultHumanEntity());
    }
  }

  private runMigrations(): void {
    this.migrateLearnedByToIds();
    this.migrateFactValidation();
    this.migrateMessageFlags();
    this.migrateInterestedPersonas();
    this.migrateProviderModel();
  }

  /**
   * Migration: learned_by used to store display names; now stores persona IDs.
   * On load, attempt to resolve display names -> IDs using current persona map.
   * Unresolvable values (renamed/deleted personas) are cleared to avoid stale display.
   * No-op for already-migrated data (UUIDs or "ei" won't match display names).
   */
  private migrateLearnedByToIds(): void {
    const personas = this.personaState.getAll();
    const nameToId = new Map<string, string>();
    for (const p of personas) {
      nameToId.set(p.display_name.toLowerCase(), p.id);
      for (const alias of p.aliases ?? []) {
        nameToId.set(alias.toLowerCase(), p.id);
      }
    }
    // "Ei" display name -> "ei" id (hardcoded, always valid)
    nameToId.set("ei", "ei");

    const human = this.humanState.get();
    let dirty = false;
    const migrateItem = (item: { learned_by?: string; last_changed_by?: string }) => {
      if (item.learned_by && !this.isPersonaId(item.learned_by)) {
        const resolved = nameToId.get(item.learned_by.toLowerCase());
        item.learned_by = resolved ?? undefined;  // clear if unresolvable
        dirty = true;
      }
      if (item.last_changed_by && !this.isPersonaId(item.last_changed_by)) {
        const resolved = nameToId.get(item.last_changed_by.toLowerCase());
        item.last_changed_by = resolved ?? undefined;
        dirty = true;
      }
    };
    [...human.facts, ...human.topics, ...human.people].forEach(migrateItem);
    if (dirty) {
      this.humanState.set(human);
      console.log("[StateManager] Migrated learned_by fields from display names to persona IDs");
    }
  }

  /**
   * Migration: Facts used to have a 'validated' field (now removed).
   * Now, only 25 built-in facts remain; others are converted to Topics with category='Fact'.
   * - Facts with 'validated' field whose name is NOT in BUILT_IN_FACT_NAMES → move to Topics
   * - Facts with 'validated' field whose name IS in BUILT_IN_FACT_NAMES → strip 'validated'
   * No-op for already-migrated data (no 'validated' field present).
   */
  private migrateFactValidation(): void {
    const human = this.humanState.get();
    
    // Check if any fact has 'validated' property (old format detection)
    const hasOldFormat = human.facts.some((f) => 'validated' in f);
    if (!hasOldFormat) return;

    let dirty = false;
    const newFacts: Fact[] = [];
    let movedCount = 0;
    let strippedCount = 0;
    // Define legacy fact interface for type-safe migration
    interface LegacyFact extends Fact {
      validated?: boolean;
    }

    for (const fact of human.facts) {
      if (!('validated' in fact)) {
        // Already migrated fact, keep as-is
        newFacts.push(fact);
        continue;
      }
      
      if (BUILT_IN_FACT_NAMES.has(fact.name)) {
        // Matching built-in: strip 'validated' field, preserve description
        const { validated, ...cleanedFact } = fact as LegacyFact;
        newFacts.push(cleanedFact);
        strippedCount++;
        dirty = true;
      } else {
        // Non-matching: move to Topics
        const newTopic: Topic = {
          id: crypto.randomUUID(),
          name: fact.name,
          description: fact.description,
          category: 'Fact',
          sentiment: fact.sentiment,
          exposure_current: 0.3,
          exposure_desired: 0.3,
          last_updated: fact.last_updated,
          learned_by: fact.learned_by,
          last_changed_by: fact.last_changed_by,
          persona_groups: fact.persona_groups,
          embedding: fact.embedding,
        };
        human.topics.push(newTopic);
        movedCount++;
        dirty = true;
      }
    }

    if (dirty) {
      human.facts = newFacts;
      this.humanState.set(human);
      console.log(
        `[StateManager] Migrated fact validation: moved ${movedCount} non-matching facts to Topics, stripped 'validated' from ${strippedCount} built-in facts`
      );
    }
  }

  /**
   * Migration: Message extraction flags were incorrectly named.
   * Old: p=Topics, o=People, r=Traits (dead)
   * New: t=Topics, p=People (r and o removed)
   * Detects old format by presence of 'o' flag on any message.
   */
  private migrateMessageFlags(): void {
    const personas = this.personaState.getAll();
    let migratedCount = 0;

    for (const persona of personas) {
      // Access raw message objects to detect and remap old flags
      const rawMessages = (this.personaState as unknown as { personas: Map<string, { messages: Array<Record<string, unknown>> }> }).personas.get(persona.id)?.messages ?? [];
      const hasOldFormat = rawMessages.some(m => 'o' in m || 'r' in m);
      if (!hasOldFormat) continue;

      for (const msg of rawMessages) {
        // Remap: old p (topics) → new t; old o (people) → new p
        const oldP = msg['p'];  // was topics
        const oldO = msg['o'];  // was people
        msg['t'] = oldP;        // topics: old p → new t
        msg['p'] = oldO;        // people: old o → new p
        delete msg['r'];        // trait flag dead
        delete msg['o'];        // old people flag dead
        migratedCount++;
      }
    }

    if (migratedCount > 0) {
      this.scheduleSave();
      console.log(`[StateManager] Migrated message flags (p→t, o→p, removed r/o) for ${migratedCount} messages`);
    }
  }

  /**
   * Migration: interested_personas was added to DataItemBase.
   * On load, backfill from learned_by + last_changed_by for any item missing the field.
   */
  private migrateInterestedPersonas(): void {
    const human = this.humanState.get();
    let dirty = false;

    const migrateItem = (item: { learned_by?: string; last_changed_by?: string; interested_personas?: string[] }) => {
      if (item.interested_personas === undefined || item.interested_personas === null) {
        item.interested_personas = [...new Set([item.learned_by, item.last_changed_by].filter(Boolean) as string[])];
        dirty = true;
      }
    };

    [...human.facts, ...human.topics, ...human.people].forEach(migrateItem);

    if (dirty) {
      this.humanState.set(human);
      console.log("[StateManager] Migrated interested_personas fields from learned_by + last_changed_by");
    }
  }

  private migrateProviderModel(): void {
    const human = this.humanState.get();
    const settings = human.settings;
    if (!settings?.accounts?.length) return;

    const modelLookup = new Map<string, string>();

    // Helper: ensure a model exists in an account and register it in modelLookup.
    // ref must be in "ProviderName:model-name" format.
    const ensureModelInAccount = (ref: string): void => {
      const colonIdx = ref.indexOf(":");
      if (colonIdx === -1) return;
      const providerName = ref.substring(0, colonIdx);
      const modelName = ref.substring(colonIdx + 1);
      const account = settings.accounts!.find((a) => a.name === providerName);
      if (!account) return;

      if (!account.models) account.models = [];

      const existing = account.models.find((m) => m.name === modelName);
      if (existing) {
        modelLookup.set(ref, existing.id);
      } else {
        const newModel = {
          id: crypto.randomUUID(),
          name: modelName,
        };
        account.models.push(newModel);
        modelLookup.set(ref, newModel.id);
      }
    };

    const isProviderRef = (val: string): boolean => {
      const colonIdx = val.indexOf(":");
      if (colonIdx === -1) return false;
      const providerName = val.substring(0, colonIdx);
      return settings.accounts!.some((a) => a.name === providerName);
    };

    // Phase 1: Collect ALL model refs from everywhere they can appear.
    const allRefs: string[] = [];
    const pushRef = (ref: string | undefined): void => {
      if (ref && isProviderRef(ref)) allRefs.push(ref);
    };

    pushRef(settings.default_model);
    pushRef(settings.oneshot_model);
    pushRef(settings.rewrite_model);
    pushRef(settings.opencode?.extraction_model);
    pushRef(settings.claudeCode?.extraction_model);

    const personas = this.personaState.getAll();
    for (const persona of personas) {
      pushRef(persona.model);
    }

    // Also include account.default_model values (legacy strings, not yet GUIDs)
    for (const account of settings.accounts) {
      if (account.default_model && isProviderRef(account.default_model)) {
        allRefs.push(account.default_model);
      }
    }

    // Phase 2: For each ref, ensure model exists in the matching account.
    for (const ref of allRefs) {
      ensureModelInAccount(ref);
    }

    // Helper: check if a value looks like a UUID (already migrated)
    const isUUID = (val: string): boolean =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // Phase 3: Ensure every account has a models array and default_model is a GUID.
    for (const account of settings.accounts) {
      if (!account.models) {
        account.models = [];
      }

      // Handle account.default_model - could be:
      // 1. Already a GUID (already migrated) - leave it
      // 2. A "Provider:model" ref - look up in modelLookup
      // 3. A plain model name like "claude-haiku-4-5-20251001" - add to models[] and convert
      if (account.default_model) {
        if (isUUID(account.default_model)) {
          // Already migrated, nothing to do
        } else if (isProviderRef(account.default_model)) {
          // It's a "Provider:model" ref - should be in modelLookup from Phase 2
          const guid = modelLookup.get(account.default_model);
          if (guid) account.default_model = guid;
        } else {
          // Plain model name - check if it exists in models[], add if not, convert to GUID
          const existing = account.models.find((m) => m.name === account.default_model);
          if (existing) {
            account.default_model = existing.id;
          } else {
            const model = {
              id: crypto.randomUUID(),
              name: account.default_model,
              token_limit: (account as any).token_limit as number | undefined,
              max_output_tokens: undefined as number | undefined,
            };
            account.models.push(model);
            modelLookup.set(`${account.name}:${model.name}`, model.id);
            account.default_model = model.id;
          }
        }
      }

      // If still no models, create a placeholder
      if (account.models.length === 0) {
        const model = { id: crypto.randomUUID(), name: "(default)" };
        account.models.push(model);
        modelLookup.set(`${account.name}:(default)`, model.id);
        account.default_model = model.id;
      }

      delete (account as any).token_limit;
    }

    const resolveRef = (ref: string | undefined): string | undefined => {
      if (!ref) return ref;
      const guid = modelLookup.get(ref);
      if (guid) return guid;
      const colonIdx = ref.indexOf(":");
      if (colonIdx === -1) return ref;
      return undefined;
    };

    settings.default_model = resolveRef(settings.default_model);
    settings.oneshot_model = resolveRef(settings.oneshot_model);
    settings.rewrite_model = resolveRef(settings.rewrite_model);

    if (settings.opencode) {
      settings.opencode.extraction_model = resolveRef(settings.opencode.extraction_model);
      delete (settings.opencode as any).extraction_token_limit;
    }

    if (settings.claudeCode) {
      settings.claudeCode.extraction_model = resolveRef(settings.claudeCode.extraction_model);
      delete (settings.claudeCode as any).extraction_token_limit;
    }

    for (const persona of personas) {
      if (persona.model) {
        const resolved = resolveRef(persona.model);
        const colonIdx = (resolved ?? persona.model).indexOf(":");
        const finalModel = colonIdx !== -1 ? undefined : (resolved ?? persona.model);
        this.personaState.update(persona.id, { model: finalModel });
      }
    }

    this.humanState.set(human);
    this.scheduleSave();
    console.log("[StateManager] Migrated provider/model references to GUID-based ModelConfig system");
  }

  /**
   * Returns true if value looks like a persona ID (UUID or the special "ei" id).
   * Display names are free-form strings that won't match UUID format.
   */
  private isPersonaId(value: string): boolean {
    if (value === "ei") return true;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private buildStorageState(): StorageState {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      human: this.humanState.get(),
      personas: this.personaState.export(),
      rooms: this.roomState.export(),
      queue: this.queueState.export(),
      providers: this.providers,
      tools: this.tools,
    };
  }

  getRoomList(includeArchived = false): RoomSummary[] {
    return this.roomState.getAll(includeArchived)
      .map(r => this.roomState.getSummary(r.id)!)
      .sort((a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime());
  }

  getRoom(roomId: string): RoomEntity | null {
    return this.roomState.getById(roomId);
  }

  getRoomByName(name: string): RoomEntity | null {
    return this.roomState.getByName(name);
  }

  addRoom(input: RoomCreationInput): RoomEntity {
    const now = new Date().toISOString();
    const initialMessage: RoomMessage = {
      id: crypto.randomUUID(),
      parent_id: null,
      role: "human",
      verbal_response: input.initial_message,
      timestamp: now,
      read: true,
      context_status: "default" as import("./types.js").ContextStatus,
    };
    const room: RoomEntity = {
      id: crypto.randomUUID(),
      display_name: input.display_name,
      entity: "room",
      mode: input.mode,
      persona_ids: input.persona_ids,
      judge_persona_id: input.judge_persona_id,
      active_node_id: initialMessage.id,
      is_archived: false,
      created_at: now,
      last_updated: now,
      last_activity: now,
      messages: [initialMessage],
    };
    this.roomState.add(room);
    this.scheduleSave();
    return room;
  }

  updateRoom(roomId: string, updates: Partial<RoomEntity>): boolean {
    const ok = this.roomState.update(roomId, updates);
    if (ok) this.scheduleSave();
    return ok;
  }

  archiveRoom(roomId: string): boolean {
    const ok = this.roomState.archive(roomId);
    if (ok) this.scheduleSave();
    return ok;
  }

  deleteRoom(roomId: string): boolean {
    const ok = this.roomState.delete(roomId);
    if (ok) this.scheduleSave();
    return ok;
  }

  getRoomMessages(roomId: string): RoomMessage[] {
    return this.roomState.messages_get(roomId);
  }

  getRoomActivePath(roomId: string): RoomMessage[] {
    return this.roomState.messages_getActivePath(roomId);
  }

  getRoomChildren(roomId: string, parentId: string | null): RoomMessage[] {
    return this.roomState.messages_getChildren(roomId, parentId);
  }

  appendRoomMessage(roomId: string, message: RoomMessage): void {
    this.roomState.messages_append(roomId, message);
    this.scheduleSave();
  }

  updateRoomMessage(roomId: string, messageId: string, updates: Partial<RoomMessage>): boolean {
    const ok = this.roomState.messages_update(roomId, messageId, updates);
    if (ok) this.scheduleSave();
    return ok;
  }

  setRoomActiveNode(roomId: string, messageId: string): boolean {
    const ok = this.roomState.messages_setActiveNode(roomId, messageId);
    if (ok) this.scheduleSave();
    return ok;
  }

  removeRoomMessages(roomId: string, messageIds: string[]): void {
    if (messageIds.length === 0) return;
    this.roomState.messages_remove(roomId, messageIds);
    this.scheduleSave();
  }

  markAllRoomMessagesRead(roomId: string): number {
    const count = this.roomState.messages_markAllRead(roomId);
    if (count > 0) this.scheduleSave();
    return count;
  }

  getRoomUnextractedMessages(roomId: string, flag: "f" | "t" | "p" | "e"): RoomMessage[] {
    return this.roomState.messages_getUnextracted(roomId, flag);
  }

  markRoomMessagesExtracted(roomId: string, messageIds: string[], flag: "f" | "t" | "p" | "e"): number {
    const count = this.roomState.messages_markExtracted(roomId, messageIds, flag);
    if (count > 0) this.scheduleSave();
    return count;
  }

  private scheduleSave(): void {
    this.persistenceState.scheduleSave(this.buildStorageState());
  }

  getHuman(): HumanEntity {
    return this.humanState.get();
  }

  setHuman(entity: HumanEntity): void {
    this.humanState.set(entity);
    this.scheduleSave();
  }

  human_fact_upsert(fact: Fact): void {
    this.humanState.fact_upsert(fact);
    this.scheduleSave();
  }

  human_fact_remove(id: string): boolean {
    const result = this.humanState.fact_remove(id);
    this.scheduleSave();
    return result;
  }


  human_topic_upsert(topic: Topic): void {
    this.humanState.topic_upsert(topic);
    this.scheduleSave();
  }

  human_topic_remove(id: string): boolean {
    const result = this.humanState.topic_remove(id);
    this.scheduleSave();
    return result;
  }

  human_person_upsert(person: Person): void {
    this.humanState.person_upsert(person);
    this.scheduleSave();
  }

  human_person_remove(id: string): boolean {
    const result = this.humanState.person_remove(id);
    this.scheduleSave();
    return result;
  }

  human_quote_add(quote: Quote): void {
    this.humanState.quote_add(quote);
    this.scheduleSave();
  }

  human_quote_update(id: string, updates: Partial<Quote>): boolean {
    const result = this.humanState.quote_update(id, updates);
    this.scheduleSave();
    return result;
  }

  human_quote_remove(id: string): boolean {
    const result = this.humanState.quote_remove(id);
    this.scheduleSave();
    return result;
  }

  human_quote_getForMessage(messageId: string): Quote[] {
    return this.humanState.quote_getForMessage(messageId);
  }

  human_quote_getForDataItem(dataItemId: string): Quote[] {
    return this.humanState.quote_getForDataItem(dataItemId);
  }

  persona_getAll(): PersonaEntity[] {
    return this.personaState.getAll();
  }

  persona_getById(personaId: string): PersonaEntity | null {
    return this.personaState.getById(personaId);
  }

  persona_getByName(nameOrAlias: string): PersonaEntity | null {
    return this.personaState.getByName(nameOrAlias);
  }

  persona_add(entity: PersonaEntity): void {
    this.personaState.add(entity);
    this.scheduleSave();
  }

  persona_update(personaId: string, updates: Partial<PersonaEntity>): boolean {
    const result = this.personaState.update(personaId, updates);
    this.scheduleSave();
    return result;
  }

  persona_archive(personaId: string): boolean {
    const result = this.personaState.archive(personaId);
    this.scheduleSave();
    return result;
  }

  persona_unarchive(personaId: string): boolean {
    const result = this.personaState.unarchive(personaId);
    this.scheduleSave();
    return result;
  }

  persona_delete(personaId: string): boolean {
    const result = this.personaState.delete(personaId);
    this.scheduleSave();
    return result;
  }

  persona_setContextBoundary(personaId: string, timestamp: string | null): void {
    this.personaState.update(personaId, {
      context_boundary: timestamp ?? undefined,
    });
    this.scheduleSave();
  }

  messages_get(personaId: string): Message[] {
    return this.personaState.messages_get(personaId);
  }

  messages_append(personaId: string, message: Message): void {
    this.personaState.messages_append(personaId, message);
    this.scheduleSave();
  }

  messages_update(personaId: string, messageId: string, updates: Partial<Message>): boolean {
    const result = this.personaState.messages_update(personaId, messageId, updates);
    this.scheduleSave();
    return result;
  }

  messages_sort(personaId: string): void {
    this.personaState.messages_sort(personaId);
    this.scheduleSave();
  }

  messages_setContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    const result = this.personaState.messages_setContextStatus(personaId, messageId, status);
    this.scheduleSave();
    return result;
  }

  messages_markRead(personaId: string, messageId: string): boolean {
    const result = this.personaState.messages_markRead(personaId, messageId);
    this.scheduleSave();
    return result;
  }

  messages_markPendingAsRead(personaId: string): number {
    const result = this.personaState.messages_markPendingAsRead(personaId);
    this.scheduleSave();
    return result;
  }

  messages_countUnread(personaId: string): number {
    return this.personaState.messages_countUnread(personaId);
  }

  messages_markAllRead(personaId: string): number {
    const result = this.personaState.messages_markAllRead(personaId);
    this.scheduleSave();
    return result;
  }

  messages_remove(personaId: string, messageIds: string[]): Message[] {
    const result = this.personaState.messages_remove(personaId, messageIds);
    const removedIds = new Set(result.map(m => m.id));
    const quotes = this.humanState.get().quotes ?? [];
    for (const quote of quotes) {
      if (quote.message_id && removedIds.has(quote.message_id)) {
        quote.message_id = null;
      }
    }
    this.scheduleSave();
    return result;
  }

  messages_getUnextracted(personaId: string, flag: "f" | "t" | "p" | "e", limit?: number, external_filter?: "include" | "exclude" | "only"): Message[] {
    return this.personaState.messages_getUnextracted(personaId, flag, limit, external_filter);
  }

  messages_markExtracted(personaId: string, messageIds: string[], flag: "f" | "t" | "p" | "e"): number {
    const result = this.personaState.messages_markExtracted(personaId, messageIds, flag);
    this.scheduleSave();
    return result;
  }

  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts" | "state">): string {
    const requestWithModel = {
      ...request,
      model: request.model ?? this.humanState.get().settings?.default_model,
    };
    const id = this.queueState.enqueue(requestWithModel);
    this.scheduleSave();
    return id;
  }

  queue_claimHighest(): LLMRequest | null {
    return this.queueState.claimHighest();
  }

  queue_complete(id: string): void {
    this.queueState.complete(id);
    this.scheduleSave();
  }

  queue_fail(id: string, error?: string, permanent?: boolean): QueueFailResult {
    const result = this.queueState.fail(id, error, permanent);
    this.scheduleSave();
    return result;
  }



  queue_clearPersonaResponses(personaId: string, nextStep: string): string[] {
    const result = this.queueState.clearPersonaResponses(personaId, nextStep);
    this.scheduleSave();
    return result;
  }

  queue_length(): number {
    return this.queueState.length();
  }

  queue_hasProcessingItem(): boolean {
    return this.queueState.hasProcessingItem();
  }

  queue_nextItemRetryAfter(): string | null {
    return this.queueState.nextItemRetryAfter();
  }

  queue_pause(): void {
    this.queueState.pause();
    this.scheduleSave();
  }

  queue_resume(): void {
    this.queueState.resume();
    this.scheduleSave();
  }

  queue_isPaused(): boolean {
    return this.queueState.isPaused();
  }

  queue_hasPendingCeremonies(): boolean {
    return this.queueState.hasPendingCeremonies();
  }

  queue_clear(): number {
    const result = this.queueState.clear();
    this.scheduleSave();
    return result;
  }

  queue_deleteItems(ids: string[]): number {
    const result = this.queueState.deleteItems(ids);
    if (result > 0) this.scheduleSave();
    return result;
  }

  queue_dlqLength(): number {
    return this.queueState.dlqLength();
  }

  embedding_setWarning(warned: boolean): void {
    this.embeddingWarning = warned;
  }

  embedding_getWarning(): boolean {
    return this.embeddingWarning;
  }

  queue_getDLQItems(): LLMRequest[] {
    return this.queueState.getDLQItems();
  }

  queue_getAllActiveItems(): LLMRequest[] {
    return this.queueState.getAllActiveItems();
  }

  queue_updateItem(id: string, updates: Partial<LLMRequest>): boolean {
    const result = this.queueState.updateItem(id, updates);
    if (result) this.scheduleSave();
    return result;
  }

  queue_trimDLQ(): number {
    const result = this.queueState.trimDLQ();
    if (result > 0) this.scheduleSave();
    return result;
  }

  // === Tool Providers ===

  tools_getProviders(): ToolProvider[] {
    return this.providers;
  }

  tools_getProviderById(id: string): ToolProvider | null {
    return this.providers.find(p => p.id === id) ?? null;
  }

  tools_addProvider(provider: ToolProvider): void {
    this.providers.push(provider);
    this.scheduleSave();
  }

  tools_updateProvider(id: string, updates: Partial<ToolProvider>): boolean {
    const idx = this.providers.findIndex(p => p.id === id);
    if (idx === -1) return false;
    this.providers[idx] = { ...this.providers[idx], ...updates };
    this.scheduleSave();
    return true;
  }

  tools_removeProvider(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter(p => p.id !== id);
    // Also remove all tools belonging to this provider
    const toolsBefore = this.tools.length;
    this.tools = this.tools.filter(t => t.provider_id !== id);
    const changed = this.providers.length !== before || this.tools.length !== toolsBefore;
    if (changed) this.scheduleSave();
    return this.providers.length !== before;
  }

  // === Tools ===

  tools_getAll(): ToolDefinition[] {
    return this.tools;
  }

  tools_getById(id: string): ToolDefinition | null {
    return this.tools.find(t => t.id === id) ?? null;
  }

  tools_getByName(name: string): ToolDefinition | null {
    return this.tools.find(t => t.name === name) ?? null;
  }

  tools_add(tool: ToolDefinition): void {
    this.tools.push(tool);
    this.scheduleSave();
  }

  tools_upsertBuiltin(tool: ToolDefinition): void {
    const existing = this.tools.find(t => t.name === tool.name);
    if (!existing) {
      this.tools.push(tool);
    } else if (existing.builtin) {
      const idx = this.tools.indexOf(existing);
      this.tools[idx] = { ...tool, id: existing.id, enabled: existing.enabled, created_at: existing.created_at };
    }
    this.scheduleSave();
  }

  tools_update(id: string, updates: Partial<ToolDefinition>): boolean {
    const idx = this.tools.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.tools[idx] = { ...this.tools[idx], ...updates };
    this.scheduleSave();
    return true;
  }

  tools_remove(id: string): boolean {
    const before = this.tools.length;
    this.tools = this.tools.filter(t => t.id !== id);
    if (this.tools.length !== before) {
      this.scheduleSave();
      return true;
    }
    return false;
  }

  /**
   * Returns tools assigned to a persona, filtered by runtime and provider enabled state.
   * Config is merged: { ...provider.config, ...tool.config } (tool overrides win).
   */
  tools_getForPersona(personaId: string, isTUI: boolean): ToolDefinition[] {
    const persona = this.personaState.getById(personaId);
    if (!persona?.tools?.length) {
      console.log(`[Tools] tools_getForPersona(${personaId}): persona has no assigned tools`);
      return [];
    }
    const assignedIds = new Set(persona.tools);
    const enabledProviderIds = new Set(
      this.providers.filter(p => p.enabled).map(p => p.id)
    );
    const result = this.tools.filter(t =>
        assignedIds.has(t.id) &&
        t.enabled &&
        enabledProviderIds.has(t.provider_id) &&
        (t.runtime === "any" || (t.runtime === "node" && isTUI))
      )
      .map(t => {
        const provider = this.providers.find(p => p.id === t.provider_id);
        if (!provider?.config || Object.keys(provider.config).length === 0) return t;
        // Merge: provider config is base, tool config overrides
        return { ...t, config: { ...provider.config, ...(t.config ?? {}) } };
      });
    // Diagnostic: log why any assigned tools were filtered out
    if (result.length < assignedIds.size) {
      for (const id of assignedIds) {
        const tool = this.tools.find(t => t.id === id);
        if (!tool) { console.log(`[Tools] tools_getForPersona: assigned tool id=${id} not found in registry`); continue; }
        if (!tool.enabled) { console.log(`[Tools] tools_getForPersona: tool "${tool.name}" is disabled`); continue; }
        if (!enabledProviderIds.has(tool.provider_id)) { console.log(`[Tools] tools_getForPersona: tool "${tool.name}" provider is disabled`); continue; }
        if (!(tool.runtime === "any" || (tool.runtime === "node" && isTUI))) { console.log(`[Tools] tools_getForPersona: tool "${tool.name}" runtime "${tool.runtime}" not available (isTUI=${isTUI})`); continue; }
      }
    }
    console.log(`[Tools] tools_getForPersona(${personaId}): resolved ${result.length}/${assignedIds.size} tools: [${result.map(t => t.name).join(", ")}]`);
    return result;
  }

  deleteModel(providerId: string, modelId: string): { success: boolean; error?: string; cleared: string[] } {
    const human = this.humanState.get();
    const settings = human.settings;
    if (!settings?.accounts?.length) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [] };
    }

    const provider = settings.accounts.find(a => a.id === providerId);
    if (!provider) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [] };
    }

    if (!provider.models?.find(m => m.id === modelId)) {
      return { success: false, error: `Model not found: ${modelId}`, cleared: [] };
    }

    if ((provider.models?.length ?? 0) <= 1) {
      return { success: false, error: `Cannot delete the last model on a provider`, cleared: [] };
    }

    const cleared: string[] = [];

    if (settings.default_model === modelId) {
      settings.default_model = undefined;
      cleared.push("settings.default_model");
    }
    if (settings.oneshot_model === modelId) {
      settings.oneshot_model = undefined;
      cleared.push("settings.oneshot_model");
    }
    if (settings.rewrite_model === modelId) {
      settings.rewrite_model = undefined;
      cleared.push("settings.rewrite_model");
    }
    if (settings.opencode?.extraction_model === modelId) {
      settings.opencode.extraction_model = undefined;
      cleared.push("settings.opencode.extraction_model");
    }
    if (settings.claudeCode?.extraction_model === modelId) {
      settings.claudeCode.extraction_model = undefined;
      cleared.push("settings.claudeCode.extraction_model");
    }
    if (provider.default_model === modelId) {
      provider.default_model = undefined;
      cleared.push("provider.default_model");
    }

    provider.models = provider.models!.filter(m => m.id !== modelId);
    this.humanState.set(human);

    for (const persona of this.personaState.getAll()) {
      if (persona.model === modelId) {
        this.personaState.update(persona.id, { model: undefined });
        cleared.push(`persona:${persona.display_name}`);
      }
    }

    this.scheduleSave();
    return { success: true, cleared };
  }

  async flush(): Promise<void> {
    await this.persistenceState.flush();
  }

  async moveToBackup(): Promise<void> {
    await this.persistenceState.moveToBackup();
  }

  async loadBackup(): Promise<StorageState | null> {
    return this.persistenceState.loadBackup();
  }

  hasExistingData(): boolean {
    return this.persistenceState.hasExistingData();
  }

  restoreFromState(state: StorageState): void {
    this.humanState.load(state.human);
    this.personaState.load(state.personas);
    this.roomState.load(state.rooms);
    this.queueState.load(state.queue);
    this.providers = state.providers ?? [];
    this.tools = state.tools ?? [];
    this.persistenceState.markExistingData();
    this.runMigrations();
    this.scheduleSave();
  }

  getStorageState(): StorageState {
    return this.buildStorageState();
  }
}
