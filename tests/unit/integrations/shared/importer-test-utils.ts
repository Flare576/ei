import { vi } from "vitest";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { ContextStatus, Ei_Interface, HumanEntity, Message } from "../../../../src/core/types.js";

export function buildPersonaEntity(id: string, displayName: string, archived = false) {
  return {
    id,
    display_name: displayName,
    entity: "system" as const,
    aliases: [] as string[],
    traits: [] as never[],
    topics: [] as never[],
    is_paused: false,
    is_archived: archived,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
  };
}

export function buildMockHuman(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: "2026-01-01T00:00:00.000Z",
  };
}

export function buildMockInterface(): Partial<Ei_Interface> {
  return {
    onPersonaAdded: vi.fn(),
    onMessageAdded: vi.fn(),
    onHumanUpdated: vi.fn(),
  };
}

export function buildMockStateManager(
  getPersonaByName: (name: string) => ReturnType<typeof buildPersonaEntity> | null,
  getPersonaById: (id: string) => ReturnType<typeof buildPersonaEntity> | null,
  onPersonaAdd: (entity: { id?: string; display_name: string }) => string,
  onPersonaArchive: (id: string) => boolean,
  messageStore: Map<string, Message[]>,
  getHuman: () => HumanEntity,
  setHuman: (h: HumanEntity) => void
): Partial<StateManager> {
  return {
    getHuman: vi.fn(getHuman),
    setHuman: vi.fn(setHuman),
    persona_getById: vi.fn(getPersonaById),
    persona_getByName: vi.fn(getPersonaByName),
    persona_add: vi.fn(onPersonaAdd),
    persona_update: vi.fn(),
    persona_archive: vi.fn(onPersonaArchive),
    messages_get: vi.fn((personaId: string) => messageStore.get(personaId) ?? []),
    messages_append: vi.fn((personaId: string, msg: Message) => {
      const existing = messageStore.get(personaId) ?? [];
      existing.push(msg);
      messageStore.set(personaId, existing);
    }),
    messages_remove: vi.fn((personaId: string, ids: string[]) => {
      const existing = messageStore.get(personaId) ?? [];
      const idSet = new Set(ids);
      const removed = existing.filter((m) => idSet.has(m.id));
      messageStore.set(personaId, existing.filter((m) => !idSet.has(m.id)));
      return removed;
    }),
    messages_sort: vi.fn(),
    messages_markExtracted: vi.fn(),
    messages_getUnextracted: vi.fn().mockReturnValue([]),
    human_topic_upsert: vi.fn(),
    queue_enqueue: vi.fn(),
  };
}

export function buildExternalMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: "external session import",
    timestamp: "2025-01-01T00:00:00.000Z",
    read: true,
    context_status: "default" as ContextStatus,
    external: true,
  };
}

export function buildChatMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: "regular chat message",
    timestamp: "2025-01-01T00:01:00.000Z",
    read: true,
    context_status: "default" as ContextStatus,
  };
}
