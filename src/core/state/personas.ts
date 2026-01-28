import type { PersonaEntity, Message, ContextStatus } from "../types.js";

export interface PersonaData {
  entity: PersonaEntity;
  messages: Message[];
  contextWindow?: { start: string; end: string };
}

export class PersonaState {
  private personas: Map<string, PersonaData> = new Map();

  private normalizeKey(name: string): string {
    return name.toLowerCase();
  }

  load(personas: Record<string, { entity: PersonaEntity; messages: Message[] }>): void {
    this.personas = new Map(
      Object.entries(personas).map(([name, data]) => [
        this.normalizeKey(name),
        { entity: data.entity, messages: data.messages },
      ])
    );
  }

  export(): Record<string, { entity: PersonaEntity; messages: Message[] }> {
    const result: Record<string, { entity: PersonaEntity; messages: Message[] }> = {};
    for (const [name, data] of this.personas) {
      result[name] = { entity: data.entity, messages: data.messages };
    }
    return result;
  }

  getAll(): PersonaEntity[] {
    return Array.from(this.personas.values()).map((p) => p.entity);
  }

  get(name: string): PersonaEntity | null {
    return this.personas.get(this.normalizeKey(name))?.entity ?? null;
  }

  add(name: string, entity: PersonaEntity): void {
    this.personas.set(this.normalizeKey(name), { entity, messages: [] });
  }

  update(name: string, updates: Partial<PersonaEntity>): boolean {
    const data = this.personas.get(this.normalizeKey(name));
    if (!data) return false;
    data.entity = { ...data.entity, ...updates, last_updated: new Date().toISOString() };
    return true;
  }

  archive(name: string): boolean {
    const data = this.personas.get(this.normalizeKey(name));
    if (!data) return false;
    data.entity.is_archived = true;
    data.entity.archived_at = new Date().toISOString();
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  unarchive(name: string): boolean {
    const data = this.personas.get(this.normalizeKey(name));
    if (!data) return false;
    data.entity.is_archived = false;
    data.entity.archived_at = undefined;
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  delete(name: string): boolean {
    return this.personas.delete(this.normalizeKey(name));
  }

  messages_get(personaName: string): Message[] {
    return this.personas.get(this.normalizeKey(personaName))?.messages ?? [];
  }

  messages_append(personaName: string, message: Message): void {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return;
    data.messages.push(message);
    data.entity.last_activity = message.timestamp;
    data.entity.last_updated = new Date().toISOString();
  }

  messages_setContextStatus(
    personaName: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.context_status = status;
    return true;
  }

  messages_getContextWindow(
    personaName: string
  ): { start: string; end: string } | null {
    return this.personas.get(this.normalizeKey(personaName))?.contextWindow ?? null;
  }

  messages_setContextWindow(personaName: string, start: string, end: string): void {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (data) {
      data.contextWindow = { start, end };
    }
  }
}
