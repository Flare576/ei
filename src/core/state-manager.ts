import type {
  HumanEntity,
  PersonaEntity,
  Message,
  Fact,
  Trait,
  Topic,
  Person,
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
  private settings: Map<string, unknown> = new Map();

  async initialize(storage: Storage): Promise<void> {
    this.checkpointState.setStorage(storage);

    const state = await this.checkpointState.loadNewest();

    if (state) {
      this.humanState.load(state.human);
      this.personaState.load(state.personas);
      this.queueState.load(state.queue);
      this.settings = new Map(Object.entries(state.settings));
    } else {
      this.humanState.load(createDefaultHumanEntity());
      this.settings = new Map();
    }
  }

  private buildStorageState(): StorageState {
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      human: this.humanState.get(),
      personas: this.personaState.export(),
      queue: this.queueState.export(),
      settings: Object.fromEntries(this.settings),
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

  persona_getAll(): PersonaEntity[] {
    return this.personaState.getAll();
  }

  persona_get(name: string): PersonaEntity | null {
    return this.personaState.get(name);
  }

  persona_add(name: string, entity: PersonaEntity): void {
    this.personaState.add(name, entity);
  }

  persona_update(name: string, updates: Partial<PersonaEntity>): boolean {
    return this.personaState.update(name, updates);
  }

  persona_archive(name: string): boolean {
    return this.personaState.archive(name);
  }

  persona_unarchive(name: string): boolean {
    return this.personaState.unarchive(name);
  }

  persona_delete(name: string): boolean {
    return this.personaState.delete(name);
  }

  persona_setContextBoundary(name: string, timestamp: string | null): void {
    this.personaState.update(name, {
      context_boundary: timestamp ?? undefined,
    });
  }

  messages_get(personaName: string): Message[] {
    return this.personaState.messages_get(personaName);
  }

  messages_append(personaName: string, message: Message): void {
    this.personaState.messages_append(personaName, message);
  }

  messages_setContextStatus(
    personaName: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    return this.personaState.messages_setContextStatus(personaName, messageId, status);
  }

  messages_getContextWindow(personaName: string): { start: string; end: string } | null {
    return this.personaState.messages_getContextWindow(personaName);
  }

  messages_setContextWindow(personaName: string, start: string, end: string): void {
    this.personaState.messages_setContextWindow(personaName, start, end);
  }

  messages_markRead(personaName: string, messageId: string): boolean {
    return this.personaState.messages_markRead(personaName, messageId);
  }

  messages_markPendingAsRead(personaName: string): number {
    return this.personaState.messages_markPendingAsRead(personaName);
  }

  messages_countUnread(personaName: string): number {
    return this.personaState.messages_countUnread(personaName);
  }

  messages_markAllRead(personaName: string): number {
    return this.personaState.messages_markAllRead(personaName);
  }

  messages_remove(personaName: string, messageIds: string[]): Message[] {
    return this.personaState.messages_remove(personaName, messageIds);
  }

  queue_enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts">): string {
    return this.queueState.enqueue(request);
  }

  queue_peekHighest(): LLMRequest | null {
    return this.queueState.peekHighest();
  }

  queue_complete(id: string): void {
    this.queueState.complete(id);
  }

  queue_fail(id: string, error?: string): void {
    this.queueState.fail(id, error);
  }

  queue_getValidations(): LLMRequest[] {
    return this.queueState.getValidations();
  }

  queue_clearValidations(ids: string[]): void {
    this.queueState.clearValidations(ids);
  }

  queue_clearPersonaResponses(personaName: string, nextStep: string): string[] {
    return this.queueState.clearPersonaResponses(personaName, nextStep);
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

  private restoreFromState(state: StorageState): void {
    this.humanState.load(state.human);
    this.personaState.load(state.personas);
    this.queueState.load(state.queue);
    this.settings = new Map(Object.entries(state.settings));
  }

  settings_get<T>(key: string): T | null {
    return (this.settings.get(key) as T) ?? null;
  }

  settings_set<T>(key: string, value: T): void {
    this.settings.set(key, value);
  }
}
