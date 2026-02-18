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
      Object.entries(personas).map(([id, data]) => [
        id,
        { entity: data.entity, messages: data.messages },
      ])
    );
  }

  export(): Record<string, { entity: PersonaEntity; messages: Message[] }> {
    const result: Record<string, { entity: PersonaEntity; messages: Message[] }> = {};
    for (const [id, data] of this.personas) {
      result[id] = { entity: data.entity, messages: data.messages };
    }
    return result;
  }

  getAll(): PersonaEntity[] {
    return Array.from(this.personas.values()).map((p) => p.entity);
  }

  getById(id: string): PersonaEntity | null {
    return this.personas.get(id)?.entity ?? null;
  }

  getByName(nameOrAlias: string): PersonaEntity | null {
    const searchTerm = nameOrAlias.toLowerCase();
    
    // Priority 1: Exact display_name match
    for (const data of this.personas.values()) {
      if (data.entity.display_name.toLowerCase() === searchTerm) {
        return data.entity;
      }
    }
    
    // Priority 2: Exact alias match
    for (const data of this.personas.values()) {
      if (data.entity.aliases?.some(alias => alias.toLowerCase() === searchTerm)) {
        return data.entity;
      }
    }
    
    // Priority 3: Unambiguous partial match
    const partialMatches: PersonaEntity[] = [];
    for (const data of this.personas.values()) {
      const displayNameLower = data.entity.display_name.toLowerCase();
      const aliasesLower = data.entity.aliases?.map(a => a.toLowerCase()) ?? [];
      
      const matchesDisplayName = displayNameLower.includes(searchTerm);
      const matchesAlias = aliasesLower.some(alias => alias.includes(searchTerm));
      
      if (matchesDisplayName || matchesAlias) {
        partialMatches.push(data.entity);
      }
    }
    
    return partialMatches.length === 1 ? partialMatches[0] : null;
  }

  add(entity: PersonaEntity): void {
    this.personas.set(entity.id, { entity, messages: [] });
  }

  update(personaId: string, updates: Partial<PersonaEntity>): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity = { ...data.entity, ...updates, last_updated: new Date().toISOString() };
    return true;
  }

  archive(personaId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity.is_archived = true;
    data.entity.archived_at = new Date().toISOString();
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  unarchive(personaId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity.is_archived = false;
    data.entity.archived_at = undefined;
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  delete(personaId: string): boolean {
    return this.personas.delete(personaId);
  }

  messages_get(personaId: string): Message[] {
    const messages = this.personas.get(personaId)?.messages ?? [];
    return messages.map(m => ({ ...m }));
  }

  messages_append(personaId: string, message: Message): void {
    const data = this.personas.get(personaId);
    if (!data) return;
    data.messages.push(message);
    data.entity.last_activity = message.timestamp;
    data.entity.last_updated = new Date().toISOString();
  }

  messages_setContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.context_status = status;
    return true;
  }

  messages_markRead(personaId: string, messageId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.read = true;
    return true;
  }

  messages_markPendingAsRead(personaId: string): number {
    const data = this.personas.get(personaId);
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

  messages_countUnread(personaId: string): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    return data.messages.filter(m => m.role === "system" && !m.read).length;
  }

  messages_markAllRead(personaId: string): number {
    const data = this.personas.get(personaId);
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

  messages_remove(personaId: string, messageIds: string[]): Message[] {
    const data = this.personas.get(personaId);
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

  messages_getUnextracted(personaId: string, flag: "f" | "r" | "p" | "o", limit?: number): Message[] {
    const data = this.personas.get(personaId);
    if (!data) return [];
    const unextracted = data.messages.filter(m => m[flag] !== true);
    if (limit && unextracted.length > limit) {
      return unextracted.slice(0, limit).map(m => ({ ...m }));
    }
    return unextracted.map(m => ({ ...m }));
  }

  messages_markExtracted(personaId: string, messageIds: string[], flag: "f" | "r" | "p" | "o"): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    const idsSet = new Set(messageIds);
    let count = 0;
    for (const msg of data.messages) {
      if (idsSet.has(msg.id) && msg[flag] !== true) {
        msg[flag] = true;
        count++;
      }
    }
    return count;
  }
}
