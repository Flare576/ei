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
  QueueFailResult,
  ToolDefinition,
  ToolProvider,
  RoomEntity,
  RoomMessage,
  RoomSummary,
  RoomCreationInput,
  HumanSettings,
  ProviderAccount,
} from "./types.js";
import { RoomMode, RESERVED_PERSONA_IDS, ContextStatus } from "./types.js";
import { BUILT_IN_FACT_NAMES } from './constants/built-in-facts.js';
import { qualifyEiMessage } from './utils/message-id.js';
import { guardPersonaLinks, removePersonaLinksToId, type PersonaLinkRefusal } from './utils/identifier-utils.js';
import type { ThemeDefinition } from './types/entities.js';
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
  private queueChangeListener?: () => void;

  setQueueChangeListener(listener: () => void): void {
    this.queueChangeListener = listener;
  }
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
    this.migrateThemes();
    this.migrateFfaParentIds();
    this.migrateDocumentSettings();
    this.migrateModelSplit();
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
          learned_on: fact.last_updated,
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

      for (const m of account.models) {
        if (m.name === "(default)") {
          m.name = "default";
          if (m.model_id === "(default)") m.model_id = undefined;
        }
      }

      // If still no models, create a placeholder
      if (account.models.length === 0) {
        const model = { id: crypto.randomUUID(), name: "default" };
        account.models.push(model);
        modelLookup.set(`${account.name}:default`, model.id);
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
   * Returns true if value looks like a persona ID (UUID or a reserved persona ID, e.g. "ei", "emmet").
   * Display names are free-form strings that won't match UUID format.
   */
  private isPersonaId(value: string): boolean {
    if ((RESERVED_PERSONA_IDS as readonly string[]).includes(value)) return true;
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
      .sort((a, b) => {
        const lastMsg = (room: typeof a) => {
          const msgs = room.messages;
          return msgs.length > 0 ? new Date(msgs[msgs.length - 1].timestamp).getTime() : 0;
        };
        return lastMsg(b) - lastMsg(a);
      })
      .map(r => this.roomState.getSummary(r.id)!);
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
      id: qualifyEiMessage(crypto.randomUUID()),
      parent_id: null,
      role: "human",
      content: input.initial_message,
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

  getRoomUnextractedMessagesForPersona(roomId: string, shortId: string): RoomMessage[] {
    return this.roomState.messages_getUnextractedForPersona(roomId, shortId);
  }

  markRoomMessagesPersonaExtracted(roomId: string, messageIds: string[], shortId: string): number {
    const count = this.roomState.messages_markPersonaExtracted(roomId, messageIds, shortId);
    if (count > 0) this.scheduleSave();
    return count;
  }

  private scheduleSave(): void {
    this.persistenceState.scheduleSave(this.buildStorageState());
  }

  private migrateThemes(): void {
    const human = this.humanState.get();
    if (!human.settings) return;
    if (human.settings.custom_themes !== undefined) return;
    human.settings.custom_themes = [];
    this.humanState.set(human);
  }

  private migrateFfaParentIds(): void {
    const rooms = this.roomState.getAll(true);
    let migratedCount = 0;

    for (const room of rooms) {
      if (room.mode !== RoomMode.FreeForAll) continue;
      const rootMsg = room.messages.find(m => m.parent_id === null);
      if (!rootMsg) continue;

      for (const msg of room.messages) {
        if (msg.role !== "human") continue;
        if (msg.id === rootMsg.id) continue;
        if (msg.parent_id === rootMsg.id) continue;
        msg.parent_id = rootMsg.id;
        migratedCount++;
      }
    }

    if (migratedCount > 0) {
      this.scheduleSave();
      console.log(`[StateManager] Migrated ${migratedCount} FFA human messages to root parent_id`);
    }
  }

  private migrateDocumentSettings(): void {
    const human = this.humanState.get();
    const doc = human.settings?.document;
    if (!doc) return;

    let migrated = false;

    const existing = doc.processed_documents ?? {};
    for (const [key, value] of Object.entries(existing)) {
      if (typeof value === "string") {
        (existing as Record<string, unknown>)[key] = { created_at: value, type: "imported" };
        migrated = true;
      }
    }

    const legacy = (doc as Record<string, unknown>).generated_documents as
      | Record<string, { subject: string; created_at: string }>
      | undefined;
    if (legacy) {
      for (const [slug, record] of Object.entries(legacy)) {
        existing[slug] = { created_at: record.created_at, type: "generated", subject: record.subject };
      }
      delete (doc as Record<string, unknown>).generated_documents;
      migrated = true;
    }

    if (migrated) {
      doc.processed_documents = existing as import("./types/entities.js").DocumentSettings["processed_documents"];
      this.humanState.set(human);
      this.scheduleSave();
      console.log("[StateManager] Migrated document settings to unified processed_documents schema");
    }
  }

  /**
   * Migration: split the legacy default_model into conversation_model + extraction_model.
   * Must run after migrateProviderModel so default_model is already a GUID.
   * Idempotent on conversation_model's absence: once either field is set, it is never
   * overwritten. default_model itself is left untouched (read-only, deprecated).
   */
  private migrateModelSplit(): void {
    const human = this.humanState.get();
    const settings = human.settings;
    if (!settings?.default_model) return;

    let migrated = false;

    if (!settings.conversation_model) {
      settings.conversation_model = settings.default_model;
      migrated = true;
    }
    if (!settings.extraction_model) {
      settings.extraction_model = settings.default_model;
      migrated = true;
    }

    if (migrated) {
      this.humanState.set(human);
      this.scheduleSave();
      console.log("[StateManager] Migrated default_model to conversation_model/extraction_model");
    }
  }

  getHuman(): HumanEntity {
    return this.humanState.get();
  }

  setHuman(entity: HumanEntity): void {
    this.humanState.set(entity);
    this.scheduleSave();
  }

  human_theme_getActive(): string | undefined {
    return this.getHuman().settings?.active_theme;
  }

  human_theme_setActive(id: string | undefined): void {
    const human = this.getHuman();
    human.settings ??= {};
    human.settings.active_theme = id;
    this.setHuman(human);
  }

  human_theme_getAll(): ThemeDefinition[] {
    return this.getHuman().settings?.custom_themes ?? [];
  }

  human_theme_upsert(theme: ThemeDefinition): void {
    const human = this.getHuman();
    human.settings ??= {};
    human.settings.custom_themes ??= [];
    const idx = human.settings.custom_themes.findIndex(t => t.id === theme.id);
    if (idx >= 0) {
      human.settings.custom_themes[idx] = theme;
    } else {
      human.settings.custom_themes.push(theme);
    }
    this.setHuman(human);
  }

  human_theme_remove(id: string): boolean {
    const human = this.getHuman();
    const themes = human.settings?.custom_themes ?? [];
    const idx = themes.findIndex(t => t.id === id);
    if (idx < 0) return false;
    themes.splice(idx, 1);
    this.setHuman(human);
    return true;
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

  /**
   * The ADR-010 clause 3/4 report for a write-time persona-link refusal —
   * same shape as the ceremony reflection phase's existing "ei" warning
   * (src/core/orchestrators/ceremony.ts), reused rather than duplicated
   * with new machinery. One message per guard invocation, naming every
   * link that write declined to create.
   */
  private buildPersonaLinkRefusalMessage(refusals: PersonaLinkRefusal[]): Message {
    const describe = (r: PersonaLinkRefusal): string => {
      const who = r.personName ? `"${r.personName}"` : `person ${r.personId}`;
      return `${who} → Persona ${r.value} (${r.reason})`;
    };
    const content = refusals.length === 1
      ? `A write just tried to link ${describe(refusals[0])}, but that would break the one-Persona-per-Person rule (ADR-006). The link was not created; everything else in the write was saved.`
      : `A write just tried to create Persona links that would break the one-Persona-per-Person rule (ADR-006). None of these were created; everything else in the write was saved:\n${refusals.map((r) => `- ${describe(r)}`).join("\n")}`;
    return {
      id: qualifyEiMessage(crypto.randomUUID()),
      role: "system",
      content,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: ContextStatus.Always,
    };
  }

  /**
   * ADR-006/ADR-010 write-time guard: runs before every person upsert that
   * reaches StateManager — the LLM person-update handler, dedup's
   * update/add phases, and the live Processor's corrections drain all
   * funnel through here, none of them with a synchronous caller left to
   * answer, so a refusal is reported through the `ei` persona thread
   * rather than returned. `excludeIds` is dedup's departing-donor list —
   * see guardPersonaLinks's own doc comment.
   *
   * The `ei` persona thread may not exist yet (a nonempty state can have
   * other Personas but bypass first-run Ei bootstrap, see
   * src/core/processor.ts) — `messages_append`'s return value is checked
   * rather than assumed, and a failed delivery is logged loudly (I3) so
   * the refusal is discoverable even though it could not be made durable
   * through the normal `ei` thread.
   */
  human_person_upsert(person: Person, excludeIds?: readonly string[]): void {
    const priorStored = this.getHuman().people.find((p) => p.id === person.id);
    const { person: guarded, refusals } = guardPersonaLinks(person, priorStored, this.getHuman().people, excludeIds);
    this.humanState.person_upsert(guarded);
    this.scheduleSave();
    if (refusals.length > 0) {
      const message = this.buildPersonaLinkRefusalMessage(refusals);
      const delivered = this.messages_append("ei", message);
      if (!delivered) {
        console.warn(
          `[StateManager] Persona-link refusal report could not be delivered: the "ei" persona does not exist in this state yet. Lost report: ${message.content}`
        );
      }
    }
  }

  human_person_remove(id: string): boolean {
    const result = this.humanState.person_remove(id);
    this.scheduleSave();
    return result;
  }

  human_person_getByIdentifier(type: string | null, value: string): Person | undefined {
    const typeLower = type?.toLowerCase();
    return this.getHuman().people.find(p =>
      p.identifiers?.some(i => (!typeLower || i.type.toLowerCase() === typeLower) && i.value === value)
    );
  }

  human_quote_add(quote: Quote): void {
    this.humanState.quote_add(quote);
    this.scheduleSave();
  }

  human_quote_upsert(quote: Quote): void {
    this.humanState.quote_upsert(quote);
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

  persona_replace(personaId: string, entity: PersonaEntity): boolean {
    const result = this.personaState.replace(personaId, entity);
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

  /** ADR-010 clause 5: deleting a Persona removes its links from Person records going forward — pre-existing orphaned links are left alone (never migrated). */
  persona_delete(personaId: string): boolean {
    const result = this.personaState.delete(personaId);
    if (result) {
      removePersonaLinksToId(this.getHuman().people, personaId);
    }
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

  messages_getAlways(personaId: string): Message[] {
    return this.personaState.messages_getAlways(personaId);
  }

  /**
   * Returns the timestamp (epoch ms) of the last internal Ei message for a persona.
   * Always excludes external=true messages (imported from OpenCode, Cursor, Claude Code).
   *
   * @param personaId - The persona to query
   * @param mode - Optional filter:
   *   omitted  → latest message in either direction (human or persona)
   *   'self'   → latest message from the persona (role='system'), silence counts
   *   'human'  → latest message from the human (role='human')
   * @returns epoch ms, or 0 if no matching messages found
   */
  messages_getLastActivity(personaId: string, mode?: 'self' | 'human'): number {
    const messages = this.personaState.messages_get(personaId);
    const filtered = messages.filter(m => {
      if (m.external === true) return false;
      if (mode === 'self') return m.role === 'system';
      if (mode === 'human') return m.role === 'human';
      return true;
    });
    if (filtered.length === 0) return 0;
    const last = filtered[filtered.length - 1];
    return new Date(last.timestamp).getTime();
  }

  /** Returns whether the message was actually appended -- false when `personaId` names a Persona that doesn't exist (I3): a caller reporting a diagnostic through a persona thread must not assume delivery just because this returned. */
  messages_append(personaId: string, message: Message): boolean {
    const delivered = this.personaState.messages_append(personaId, message);
    if (delivered) this.scheduleSave();
    return delivered;
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

  messages_getUnextractedForPersona(personaId: string, shortId: string): Message[] {
    return this.personaState.messages_getUnextractedForPersona(personaId, shortId);
  }

  messages_markPersonaExtracted(personaId: string, messageIds: string[], shortId: string): number {
    const result = this.personaState.messages_markPersonaExtracted(personaId, messageIds, shortId);
    if (result > 0) this.scheduleSave();
    return result;
  }

  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts" | "state">): string {
    const settings = this.humanState.get().settings;
    const requestWithModel = {
      ...request,
      model: request.model ?? settings?.conversation_model ?? settings?.default_model,
    };
    const id = this.queueState.enqueue(requestWithModel);
    this.scheduleSave();
    this.queueChangeListener?.();
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

  queue_hasPendingDocumentSegments(batchId: string): boolean {
    return this.queueState.hasPendingDocumentSegments(batchId);
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
      console.debug(`[Tools] tools_getForPersona(${personaId}): persona has no assigned tools`);
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
        if (!tool) { console.debug(`[Tools] tools_getForPersona: assigned tool id=${id} not found in registry`); continue; }
        if (!tool.enabled) { console.debug(`[Tools] tools_getForPersona: tool "${tool.name}" is disabled`); continue; }
        if (!enabledProviderIds.has(tool.provider_id)) { console.debug(`[Tools] tools_getForPersona: tool "${tool.name}" provider is disabled`); continue; }
        if (!(tool.runtime === "any" || (tool.runtime === "node" && isTUI))) { console.debug(`[Tools] tools_getForPersona: tool "${tool.name}" runtime "${tool.runtime}" not available (isTUI=${isTUI})`); continue; }
      }
    }
    console.debug(`[Tools] tools_getForPersona(${personaId}): resolved ${result.length}/${assignedIds.size} tools: [${result.map(t => t.name).join(", ")}]`);
    return result;
  }

  private sweepModelReferences(settings: HumanSettings, modelIds: Set<string>): { cleared: string[]; affectedPersonaIds: string[] } {
    const cleared: string[] = [];
    const affectedPersonaIds: string[] = [];

    if (settings.default_model !== undefined && modelIds.has(settings.default_model)) {
      settings.default_model = undefined;
      cleared.push("settings.default_model");
    }
    if (settings.oneshot_model !== undefined && modelIds.has(settings.oneshot_model)) {
      settings.oneshot_model = undefined;
      cleared.push("settings.oneshot_model");
    }
    if (settings.rewrite_model !== undefined && modelIds.has(settings.rewrite_model)) {
      settings.rewrite_model = undefined;
      cleared.push("settings.rewrite_model");
    }
    if (settings.conversation_model !== undefined && modelIds.has(settings.conversation_model)) {
      settings.conversation_model = undefined;
      cleared.push("settings.conversation_model");
    }
    if (settings.extraction_model !== undefined && modelIds.has(settings.extraction_model)) {
      settings.extraction_model = undefined;
      cleared.push("settings.extraction_model");
    }
    if (settings.opencode?.extraction_model !== undefined && modelIds.has(settings.opencode.extraction_model)) {
      settings.opencode.extraction_model = undefined;
      cleared.push("settings.opencode.extraction_model");
    }
    if (settings.claudeCode?.extraction_model !== undefined && modelIds.has(settings.claudeCode.extraction_model)) {
      settings.claudeCode.extraction_model = undefined;
      cleared.push("settings.claudeCode.extraction_model");
    }

    for (const persona of this.personaState.getAll()) {
      if (persona.model !== undefined && modelIds.has(persona.model)) {
        this.personaState.update(persona.id, { model: undefined });
        cleared.push(`persona:${persona.display_name}`);
        affectedPersonaIds.push(persona.id);
      }
    }

    return { cleared, affectedPersonaIds };
  }

  deleteModel(providerId: string, modelId: string): { success: boolean; error?: string; cleared: string[]; affectedPersonaIds: string[] } {
    const human = this.humanState.get();
    const settings = human.settings;
    if (!settings?.accounts?.length) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [], affectedPersonaIds: [] };
    }

    const provider = settings.accounts.find(a => a.id === providerId);
    if (!provider) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [], affectedPersonaIds: [] };
    }

    if (!provider.models?.find(m => m.id === modelId)) {
      return { success: false, error: `Model not found: ${modelId}`, cleared: [], affectedPersonaIds: [] };
    }

    if ((provider.models?.length ?? 0) <= 1) {
      return { success: false, error: `Cannot delete the last model on a provider`, cleared: [], affectedPersonaIds: [] };
    }

    const { cleared, affectedPersonaIds } = this.sweepModelReferences(settings, new Set([modelId]));

    if (provider.default_model === modelId) {
      provider.default_model = undefined;
      cleared.push("provider.default_model");
    }

    provider.models = provider.models!.filter(m => m.id !== modelId);
    this.humanState.set(human);

    this.scheduleSave();
    return { success: true, cleared, affectedPersonaIds };
  }

  deleteProvider(providerId: string): { success: boolean; error?: string; cleared: string[]; affectedPersonaIds: string[] } {
    const human = this.humanState.get();
    const settings = human.settings;
    if (!settings?.accounts?.length) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [], affectedPersonaIds: [] };
    }

    const provider = settings.accounts.find(a => a.id === providerId);
    if (!provider) {
      return { success: false, error: `Provider not found: ${providerId}`, cleared: [], affectedPersonaIds: [] };
    }

    const modelIds = new Set((provider.models ?? []).map(m => m.id));
    const { cleared, affectedPersonaIds } = this.sweepModelReferences(settings, modelIds);

    settings.accounts = settings.accounts.filter(a => a.id !== providerId);
    this.humanState.set(human);

    this.scheduleSave();
    return { success: true, cleared, affectedPersonaIds };
  }

  upsertProviderAccount(account: ProviderAccount): { success: boolean; error?: string; cleared: string[]; affectedPersonaIds: string[] } {
    if (account.models !== undefined && account.models.length === 0) {
      return { success: false, error: "Provider must have at least one model", cleared: [], affectedPersonaIds: [] };
    }

    const human = this.humanState.get();
    const settings: HumanSettings = human.settings ?? (human.settings = {});
    const accounts = settings.accounts ?? (settings.accounts = []);

    const existing = accounts.find(a => a.id === account.id);
    const existingModelIds = new Set((existing?.models ?? []).map(m => m.id));
    const updatedModelIds = new Set((account.models ?? []).map(m => m.id));
    const removedModelIds = new Set([...existingModelIds].filter(id => !updatedModelIds.has(id)));

    const { cleared, affectedPersonaIds } = this.sweepModelReferences(settings, removedModelIds);

    if (account.default_model !== undefined && removedModelIds.has(account.default_model)) {
      account.default_model = undefined;
      cleared.push("provider.default_model");
    }

    if (existing) {
      accounts[accounts.indexOf(existing)] = account;
    } else {
      accounts.push(account);
    }

    this.humanState.set(human);

    this.scheduleSave();
    return { success: true, cleared, affectedPersonaIds };
  }

  model_update_usage(modelId: string, delta: { calls: number; tokens_in: number; tokens_out: number }): void {
    const human = this.humanState.get();
    const accounts = human.settings?.accounts;
    if (!accounts) return;

    for (const account of accounts) {
      const model = account.models?.find(m => m.id === modelId);
      if (model) {
        model.total_calls = (model.total_calls ?? 0) + delta.calls;
        model.total_tokens_in = (model.total_tokens_in ?? 0) + delta.tokens_in;
        model.total_tokens_out = (model.total_tokens_out ?? 0) + delta.tokens_out;
        model.last_used = new Date().toISOString();
        this.scheduleSave();
        return;
      }
    }
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
