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
  Checkpoint,
  StorageState,
  ContextStatus,
} from "./types.js";
import type { Storage } from "../storage/interface.js";
import {
  HumanState,
  PersonaState,
  QueueState,
  CheckpointState,
  createDefaultHumanEntity,
} from "./state/index.js";

export class StateManager {
  private humanState = new HumanState();
  private personaState = new PersonaState();
  private queueState = new QueueState();
  private checkpointState = new CheckpointState();

  async initialize(storage: Storage): Promise<void> {
    this.checkpointState.setStorage(storage);

    const state = await this.checkpointState.loadNewest();

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

  getHuman(): HumanEntity {
    return this.humanState.get();
  }

  setHuman(entity: HumanEntity): void {
    this.humanState.set(entity);
  }

  human_fact_upsert(fact: Fact): void {
    this.humanState.fact_upsert(fact);
  }

  human_fact_remove(id: string): boolean {
    return this.humanState.fact_remove(id);
  }

  human_trait_upsert(trait: Trait): void {
    this.humanState.trait_upsert(trait);
  }

  human_trait_remove(id: string): boolean {
    return this.humanState.trait_remove(id);
  }

  human_topic_upsert(topic: Topic): void {
    this.humanState.topic_upsert(topic);
  }

  human_topic_remove(id: string): boolean {
    return this.humanState.topic_remove(id);
  }

  human_person_upsert(person: Person): void {
    this.humanState.person_upsert(person);
  }

   human_person_remove(id: string): boolean {
     return this.humanState.person_remove(id);
   }

   human_quote_add(quote: Quote): void {
     this.humanState.quote_add(quote);
   }

   human_quote_update(id: string, updates: Partial<Quote>): boolean {
     return this.humanState.quote_update(id, updates);
   }

   human_quote_remove(id: string): boolean {
     return this.humanState.quote_remove(id);
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
  }

  persona_update(personaId: string, updates: Partial<PersonaEntity>): boolean {
    return this.personaState.update(personaId, updates);
  }

  persona_archive(personaId: string): boolean {
    return this.personaState.archive(personaId);
  }

  persona_unarchive(personaId: string): boolean {
    return this.personaState.unarchive(personaId);
  }

  persona_delete(personaId: string): boolean {
    return this.personaState.delete(personaId);
  }

  persona_setContextBoundary(personaId: string, timestamp: string | null): void {
    this.personaState.update(personaId, {
      context_boundary: timestamp ?? undefined,
    });
  }

  messages_get(personaId: string): Message[] {
    return this.personaState.messages_get(personaId);
  }

  messages_append(personaId: string, message: Message): void {
    this.personaState.messages_append(personaId, message);
  }

  messages_setContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    return this.personaState.messages_setContextStatus(personaId, messageId, status);
  }

  messages_markRead(personaId: string, messageId: string): boolean {
    return this.personaState.messages_markRead(personaId, messageId);
  }

  messages_markPendingAsRead(personaId: string): number {
    return this.personaState.messages_markPendingAsRead(personaId);
  }

  messages_countUnread(personaId: string): number {
    return this.personaState.messages_countUnread(personaId);
  }

  messages_markAllRead(personaId: string): number {
    return this.personaState.messages_markAllRead(personaId);
  }

  messages_remove(personaId: string, messageIds: string[]): Message[] {
    return this.personaState.messages_remove(personaId, messageIds);
  }

  messages_getUnextracted(personaId: string, flag: "f" | "r" | "p" | "o", limit?: number): Message[] {
    return this.personaState.messages_getUnextracted(personaId, flag, limit);
  }

  messages_markExtracted(personaId: string, messageIds: string[], flag: "f" | "r" | "p" | "o"): number {
    return this.personaState.messages_markExtracted(personaId, messageIds, flag);
  }

  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts">): string {
    const requestWithModel = {
      ...request,
      model: request.model ?? this.humanState.get().settings?.default_model,
    };
    const id = this.queueState.enqueue(requestWithModel);
    return id;
  }

  queue_peekHighest(): LLMRequest | null {
    return this.queueState.peekHighest();
  }

  queue_complete(id: string): void {
    this.queueState.complete(id);
  }

  queue_fail(id: string, error?: string): boolean {
    return this.queueState.fail(id, error);
  }

  queue_getValidations(): LLMRequest[] {
    return this.queueState.getValidations();
  }

  queue_clearValidations(ids: string[]): void {
    this.queueState.clearValidations(ids);
  }

  queue_clearPersonaResponses(personaId: string, nextStep: string): string[] {
    return this.queueState.clearPersonaResponses(personaId, nextStep);
  }

  queue_length(): number {
    return this.queueState.length();
  }

  queue_pause(): void {
    this.queueState.pause();
  }

  queue_resume(): void {
    this.queueState.resume();
  }

  queue_isPaused(): boolean {
    return this.queueState.isPaused();
  }

  queue_clear(): number {
    return this.queueState.clear();
  }

  async checkpoint_saveAuto(): Promise<void> {
    await this.checkpointState.saveAuto(this.buildStorageState());
  }

  async checkpoint_saveManual(index: number, name: string): Promise<void> {
    await this.checkpointState.saveManual(index, name, this.buildStorageState());
  }

  async checkpoint_list(): Promise<Checkpoint[]> {
    return this.checkpointState.list();
  }

  async checkpoint_delete(index: number): Promise<boolean> {
    return this.checkpointState.delete(index);
  }

  async checkpoint_restore(index: number): Promise<boolean> {
    const state = await this.checkpointState.load(index);
    if (!state) return false;
    this.restoreFromState(state);
    return true;
  }

  restoreFromState(state: StorageState): void {
    this.humanState.load(state.human);
    this.personaState.load(state.personas);
    this.queueState.load(state.queue);
  }

  getStorageState(): StorageState {
    return this.buildStorageState();
  }
}
