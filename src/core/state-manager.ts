import type {
  HumanEntity,
  PersonaEntity,
  Message,
  Fact,
  Trait,
  Topic,
  Person,
  Quote,
  LLMRequest,
  StorageState,
  ContextStatus,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import {
  HumanState,
  PersonaState,
  QueueState,
  PersistenceState,
  createDefaultHumanEntity,
} from "./state/index.js";

export class StateManager {
  private humanState = new HumanState();
  private personaState = new PersonaState();
  private queueState = new QueueState();
  private persistenceState = new PersistenceState();

  async initialize(storage: Storage): Promise<void> {
    this.persistenceState.setStorage(storage);

    const state = await this.persistenceState.load();

    if (state) {
      this.humanState.load(state.human);
      this.personaState.load(state.personas);
      this.queueState.load(state.queue);
    } else {
      this.humanState.load(createDefaultHumanEntity());
    }
  }

  private buildStorageState(): StorageState {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      human: this.humanState.get(),
      personas: this.personaState.export(),
      queue: this.queueState.export(),
    };
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

  human_trait_upsert(trait: Trait): void {
    this.humanState.trait_upsert(trait);
    this.scheduleSave();
  }

  human_trait_remove(id: string): boolean {
    const result = this.humanState.trait_remove(id);
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

  messages_getUnextracted(personaId: string, flag: "f" | "r" | "p" | "o", limit?: number): Message[] {
    return this.personaState.messages_getUnextracted(personaId, flag, limit);
  }

  messages_markExtracted(personaId: string, messageIds: string[], flag: "f" | "r" | "p" | "o"): number {
    const result = this.personaState.messages_markExtracted(personaId, messageIds, flag);
    this.scheduleSave();
    return result;
  }

  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts">): string {
    const requestWithModel = {
      ...request,
      model: request.model ?? this.humanState.get().settings?.default_model,
    };
    const id = this.queueState.enqueue(requestWithModel);
    this.scheduleSave();
    return id;
  }

  queue_peekHighest(): LLMRequest | null {
    return this.queueState.peekHighest();
  }

  queue_complete(id: string): void {
    this.queueState.complete(id);
    this.scheduleSave();
  }

  queue_fail(id: string, error?: string): boolean {
    const result = this.queueState.fail(id, error);
    this.scheduleSave();
    return result;
  }

  queue_getValidations(): LLMRequest[] {
    return this.queueState.getValidations();
  }

  queue_clearValidations(ids: string[]): void {
    this.queueState.clearValidations(ids);
    this.scheduleSave();
  }

  queue_clearPersonaResponses(personaId: string, nextStep: string): string[] {
    const result = this.queueState.clearPersonaResponses(personaId, nextStep);
    this.scheduleSave();
    return result;
  }

  queue_length(): number {
    return this.queueState.length();
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

  queue_clear(): number {
    const result = this.queueState.clear();
    this.scheduleSave();
    return result;
  }

  async flush(): Promise<void> {
    await this.persistenceState.flush();
  }

  async moveToBackup(): Promise<void> {
    await this.persistenceState.moveToBackup();
  }

  hasExistingData(): boolean {
    return this.persistenceState.hasExistingData();
  }

  restoreFromState(state: StorageState): void {
    this.humanState.load(state.human);
    this.personaState.load(state.personas);
    this.queueState.load(state.queue);
    this.scheduleSave();
  }

  getStorageState(): StorageState {
    return this.buildStorageState();
  }
}
