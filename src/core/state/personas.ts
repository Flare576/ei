import type { PersonaEntity, Message, ContextStatus } from "../types.js";

export interface PersonaData {
  entity: PersonaEntity;
  messages: Message[];
  contextWindow?: { start: string; end: string };
}

export class PersonaState {
  private personas: Map<string, PersonaData> = new Map();

  load(personas: Record<string, { entity: PersonaEntity; messages: Message[] }>): void {
    this.personas = new Map(
      Object.entries(personas).map(([name, data]) => [
        name,
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
    return this.personas.get(name)?.entity ?? null;
  }

  add(name: string, entity: PersonaEntity): void {
    this.personas.set(name, { entity, messages: [] });
  }

  update(name: string, updates: Partial<PersonaEntity>): boolean {
    const data = this.personas.get(name);
    if (!data) return false;
    data.entity = { ...data.entity, ...updates, last_updated: new Date().toISOString() };
    return true;
  }

  archive(name: string): boolean {
    const data = this.personas.get(name);
    if (!data) return false;
    data.entity.is_archived = true;
    data.entity.archived_at = new Date().toISOString();
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  unarchive(name: string): boolean {
    const data = this.personas.get(name);
    if (!data) return false;
    data.entity.is_archived = false;
    data.entity.archived_at = undefined;
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  delete(name: string): boolean {
    return this.personas.delete(name);
  }

  messages_get(personaName: string): Message[] {
    return this.personas.get(personaName)?.messages ?? [];
  }

  messages_append(personaName: string, message: Message): void {
    const data = this.personas.get(personaName);
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
    const data = this.personas.get(personaName);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.context_status = status;
    return true;
  }

  messages_getContextWindow(
    personaName: string
  ): { start: string; end: string } | null {
    return this.personas.get(personaName)?.contextWindow ?? null;
  }

  messages_setContextWindow(personaName: string, start: string, end: string): void {
    const data = this.personas.get(personaName);
    if (data) {
      data.contextWindow = { start, end };
    }
  }
}
