/**
 * EI V1 Room State
 * Source of truth: CONTRACTS.md
 */

import type { RoomEntity, RoomMessage, RoomSummary } from "../types.js";

export class RoomState {
  private rooms: Map<string, RoomEntity> = new Map();

  load(rooms: Record<string, RoomEntity> | undefined): void {
    if (!rooms) return;
    this.rooms = new Map(Object.entries(rooms));
  }

  export(): Record<string, RoomEntity> {
    const result: Record<string, RoomEntity> = {};
    for (const [id, room] of this.rooms) {
      result[id] = room;
    }
    return result;
  }

  getAll(includeArchived = false): RoomEntity[] {
    const all = Array.from(this.rooms.values());
    return includeArchived ? all : all.filter(r => !r.is_archived);
  }

  getById(id: string): RoomEntity | null {
    return this.rooms.get(id) ?? null;
  }

  getByName(nameOrAlias: string): RoomEntity | null {
    const search = nameOrAlias.toLowerCase();
    for (const room of this.rooms.values()) {
      if (room.display_name.toLowerCase() === search) return room;
    }
    const partial: RoomEntity[] = [];
    for (const room of this.rooms.values()) {
      if (room.display_name.toLowerCase().includes(search)) partial.push(room);
    }
    return partial.length === 1 ? partial[0] : null;
  }

  add(room: RoomEntity): void {
    this.rooms.set(room.id, room);
  }

  update(roomId: string, updates: Partial<RoomEntity>): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    Object.assign(room, updates, { last_updated: new Date().toISOString() });
    return true;
  }

  archive(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.is_archived = true;
    room.last_updated = new Date().toISOString();
    return true;
  }

  delete(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  getSummary(roomId: string): RoomSummary | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      id: room.id,
      display_name: room.display_name,
      mode: room.mode,
      persona_ids: room.persona_ids,
      active_node_id: room.active_node_id,
      is_archived: room.is_archived,
      unread_count: this.messages_countUnread(roomId),
    };
  }

  messages_get(roomId: string): RoomMessage[] {
    return this.rooms.get(roomId)?.messages ?? [];
  }

  messages_getActivePath(roomId: string): RoomMessage[] {
    const room = this.rooms.get(roomId);
    if (!room || !room.active_node_id) return [];

    const byId = new Map(room.messages.map(m => [m.id, m]));
    const path: RoomMessage[] = [];
    let current: RoomMessage | undefined = byId.get(room.active_node_id);
    while (current) {
      path.unshift(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return path;
  }

  messages_getChildren(roomId: string, parentId: string | null): RoomMessage[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.messages.filter(m => m.parent_id === parentId);
  }

  messages_append(roomId: string, message: RoomMessage): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.messages.push(message);
    room.last_updated = new Date().toISOString();
  }

  messages_update(roomId: string, messageId: string, updates: Partial<RoomMessage>): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const msg = room.messages.find(m => m.id === messageId);
    if (!msg) return false;
    Object.assign(msg, updates);
    room.last_updated = new Date().toISOString();
    return true;
  }

  messages_remove(roomId: string, messageIds: string[]): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const idsSet = new Set(messageIds);
    room.messages = room.messages.filter(m => !idsSet.has(m.id));
    room.last_updated = new Date().toISOString();
  }

  messages_setActiveNode(roomId: string, messageId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const exists = room.messages.some(m => m.id === messageId);
    if (!exists) return false;
    room.active_node_id = messageId;
    room.last_updated = new Date().toISOString();
    return true;
  }

  messages_countUnread(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const activePath = new Set(this.messages_getActivePath(roomId).map(m => m.id));
    return room.messages.filter(m =>
      m.role === "persona" && !m.read && activePath.has(m.id)
    ).length;
  }

  messages_markAllRead(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    let count = 0;
    for (const msg of room.messages) {
      if (!msg.read) { msg.read = true; count++; }
    }
    return count;
  }

  messages_getUnextracted(roomId: string, flag: "f" | "t" | "p" | "e"): RoomMessage[] {
    const activePath = new Set(this.messages_getActivePath(roomId).map(m => m.id));
    return (this.rooms.get(roomId)?.messages ?? [])
      .filter(m => activePath.has(m.id) && m[flag] !== true)
      .map(m => ({ ...m }));
  }

  messages_markExtracted(roomId: string, messageIds: string[], flag: "f" | "t" | "p" | "e"): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const ids = new Set(messageIds);
    let count = 0;
    for (const msg of room.messages) {
      if (ids.has(msg.id) && msg[flag] !== true) {
        msg[flag] = true;
        count++;
      }
    }
    return count;
  }

  messages_getUnextractedForPersona(roomId: string, shortId: string): RoomMessage[] {
    const activePath = new Set(this.messages_getActivePath(roomId).map(m => m.id));
    return (this.rooms.get(roomId)?.messages ?? [])
      .filter(m => activePath.has(m.id) && !m.persona_extracted?.[shortId])
      .map(m => ({ ...m }));
  }

  messages_markPersonaExtracted(roomId: string, messageIds: string[], shortId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) return 0;
    const ids = new Set(messageIds);
    let count = 0;
    for (const msg of room.messages) {
      if (ids.has(msg.id) && !msg.persona_extracted?.[shortId]) {
        msg.persona_extracted = { ...msg.persona_extracted, [shortId]: true };
        count++;
      }
    }
    return count;
  }
}
