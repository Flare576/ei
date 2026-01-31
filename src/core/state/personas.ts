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
    const messages = this.personas.get(this.normalizeKey(personaName))?.messages ?? [];
    return messages.map(m => ({ ...m }));
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

  messages_markRead(personaName: string, messageId: string): boolean {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.read = true;
    return true;
  }

  messages_markPendingAsRead(personaName: string): number {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return 0;
    let count = 0;
    for (const msg of data.messages) {
      if (msg.role === "human" && !msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  messages_countUnread(personaName: string): number {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return 0;
    return data.messages.filter(m => m.role === "system" && !m.read).length;
  }

  messages_markAllRead(personaName: string): number {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return 0;
    let count = 0;
    for (const msg of data.messages) {
      if (!msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  messages_remove(personaName: string, messageIds: string[]): Message[] {
    const data = this.personas.get(this.normalizeKey(personaName));
    if (!data) return [];
    const idsSet = new Set(messageIds);
    const removed: Message[] = [];
    data.messages = data.messages.filter((m) => {
      if (idsSet.has(m.id)) {
        removed.push(m);
        return false;
      }
      return true;
    });
    return removed;
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
