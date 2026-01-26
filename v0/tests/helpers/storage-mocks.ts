import { vi, beforeEach } from 'vitest';
import type { HumanEntity, PersonaEntity } from '../../src/types.js';

/**
 * Creates mock storage functions for integration tests.
 * Maintains in-memory state for personas and entities to support test flows.
 */
export function createStorageMocks() {
  const initialPersonasState = [
    { name: 'ei', aliases: ['default', 'core'] },
    { name: 'claude', aliases: ['assistant'] },
    { name: 'assistant', aliases: [] }
  ];

  const mockPersonas = JSON.parse(JSON.stringify(initialPersonasState));

  const createDefaultPersonaEntity = (name: string, aliases: string[]): PersonaEntity => ({
    entity: 'system',
    aliases: [...aliases],
    group_primary: null,
    groups_visible: name === 'ei' ? ['*'] : [],
    traits: name === 'ei' ? [{
      name: "Warm but Direct",
      description: "Test trait",
      sentiment: 0.3,
      strength: 0.7,
      last_updated: new Date().toISOString()
    }] : [],
    topics: [],
    last_updated: null
  });

  const mockPersonaEntities = new Map<string, PersonaEntity>();
  mockPersonaEntities.set('ei', createDefaultPersonaEntity('ei', ['default', 'core']));
  mockPersonaEntities.set('claude', createDefaultPersonaEntity('claude', ['assistant']));
  mockPersonaEntities.set('assistant', createDefaultPersonaEntity('assistant', []));

  const createDefaultHumanEntity = (): HumanEntity => ({
    entity: 'human',
    facts: [],
    traits: [],
    topics: [],
    people: [],
    last_updated: null,
    ceremony_config: {
      enabled: true,
      time: "09:00",
      timezone: undefined
    }
  });

  const mockHumanEntity: HumanEntity = createDefaultHumanEntity();

  const resetMocks = () => {
    mockPersonas.length = 0;
    mockPersonas.push(...JSON.parse(JSON.stringify(initialPersonasState)));
    
    mockPersonaEntities.clear();
    mockPersonaEntities.set('ei', createDefaultPersonaEntity('ei', ['default', 'core']));
    mockPersonaEntities.set('claude', createDefaultPersonaEntity('claude', ['assistant']));
    mockPersonaEntities.set('assistant', createDefaultPersonaEntity('assistant', []));
    
    Object.assign(mockHumanEntity, createDefaultHumanEntity());
  };

  beforeEach(() => {
    resetMocks();
  });

  return {
    // Entity functions (NEW architecture)
    loadHumanEntity: vi.fn(() => Promise.resolve({ ...mockHumanEntity })),
    saveHumanEntity: vi.fn((entity: HumanEntity) => {
      Object.assign(mockHumanEntity, entity);
      return Promise.resolve();
    }),
    loadPersonaEntity: vi.fn((persona?: string) => {
      const personaName = persona || 'ei';
      const entity = mockPersonaEntities.get(personaName);
      if (!entity) {
        throw new Error(`Persona ${personaName} not found`);
      }
      return Promise.resolve({ ...entity });
    }),
    savePersonaEntity: vi.fn((entity: PersonaEntity, persona?: string) => {
      const personaName = persona || 'ei';
      mockPersonaEntities.set(personaName, { ...entity });
      
      // Also update mockPersonas aliases
      const p = mockPersonas.find(p => p.name === personaName);
      if (p && entity.aliases) {
        p.aliases = [...entity.aliases];
      }
      return Promise.resolve();
    }),

    // Persona management
    loadHistory: vi.fn(() => Promise.resolve({ messages: [] })),
    listPersonas: vi.fn(() => Promise.resolve(mockPersonas)),
    findPersonaByNameOrAlias: vi.fn(async (name: string, options?: { allowPartialMatch?: boolean }) => {
      const lower = name.toLowerCase();
      
      for (const p of mockPersonas) {
        if (p.name.toLowerCase() === lower) return p.name;
        if (p.aliases.some(a => a.toLowerCase() === lower)) return p.name;
      }
      
      if (options?.allowPartialMatch) {
        const matches = mockPersonas.filter(p =>
          p.aliases.some(a => a.toLowerCase().includes(lower))
        );
        
        if (matches.length === 1) {
          return matches[0].name;
        }
        
        if (matches.length > 1) {
          const matchedAliases = matches.flatMap(p => 
            p.aliases.filter(a => a.toLowerCase().includes(lower))
          );
          throw new Error(
            `Ambiguous: multiple aliases match "${name}": ${matchedAliases.join(", ")}`
          );
        }
      }
      
      return null;
    }),
    findPersonaByAlias: vi.fn(async (alias: string) => {
      const lower = alias.toLowerCase();
      for (const p of mockPersonas) {
        const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
        if (matchedAlias) {
          return { personaName: p.name, alias: matchedAlias };
        }
      }
      return null;
    }),
    addPersonaAlias: vi.fn(async (personaName: string, alias: string) => {
      // Check if alias already exists
      const lower = alias.toLowerCase();
      for (const p of mockPersonas) {
        if (p.aliases.some((a: string) => a.toLowerCase() === lower)) {
          throw new Error(`Alias "${alias}" already exists on persona "${p.name}"`);
        }
      }
      
      const entity = mockPersonaEntities.get(personaName);
      if (!entity) throw new Error(`Persona ${personaName} not found`);
      
      if (!entity.aliases) entity.aliases = [];
      if (entity.aliases.some((a: string) => a.toLowerCase() === lower)) {
        throw new Error(`Alias "${alias}" already exists on this persona`);
      }
      
      entity.aliases.push(alias);
      entity.last_updated = new Date().toISOString();
      
      const p = mockPersonas.find(p => p.name === personaName);
      if (p) p.aliases = [...entity.aliases];
    }),
    removePersonaAlias: vi.fn(async (personaName: string, pattern: string) => {
      const entity = mockPersonaEntities.get(personaName);
      if (!entity || !entity.aliases || entity.aliases.length === 0) {
        throw new Error(`No aliases found for persona "${personaName}"`);
      }
      
      const lower = pattern.toLowerCase();
      const matches = entity.aliases.filter((a: string) => a.toLowerCase().includes(lower));
      
      if (matches.length === 0) {
        throw new Error(`No aliases matching "${pattern}" found on persona "${personaName}"`);
      }
      if (matches.length > 1) {
        throw new Error(`Ambiguous: multiple aliases match "${pattern}": ${matches.join(", ")}`);
      }
      
      const removedAlias = matches[0];
      entity.aliases = entity.aliases.filter((a: string) => a !== removedAlias);
      entity.last_updated = new Date().toISOString();
      
      const p = mockPersonas.find(p => p.name === personaName);
      if (p) p.aliases = [...entity.aliases];
      
      return [removedAlias];
    }),

    // Archive management
    findArchivedPersonaByNameOrAlias: vi.fn(() => Promise.resolve(null)),
    getArchivedPersonas: vi.fn(() => Promise.resolve([])),
    loadArchiveState: vi.fn(() => Promise.resolve({ isArchived: false })),
    saveArchiveState: vi.fn(() => Promise.resolve()),

    // Pause management
    loadPauseState: vi.fn(() => Promise.resolve({ isPaused: false })),
    savePauseState: vi.fn(() => Promise.resolve()),

    // Message management
    appendHumanMessage: vi.fn(() => Promise.resolve()),
    appendMessage: vi.fn(() => Promise.resolve()),
    getPendingMessages: vi.fn(() => Promise.resolve([])),
    replacePendingMessages: vi.fn(() => Promise.resolve()),
    getUnprocessedMessages: vi.fn(() => Promise.resolve([])),
    markSystemMessagesAsRead: vi.fn(() => Promise.resolve()),
    getUnreadSystemMessageCount: vi.fn(() => Promise.resolve(0)),

    // System utilities
    initializeDataDirectory: vi.fn(() => Promise.resolve()),
    initializeDebugLog: vi.fn(),
    appendDebugLog: vi.fn(),
    setStateManager: vi.fn(),
    getDataPath: vi.fn(() => "/tmp/ei-test"),
    
    _mockState: {
      personas: mockPersonas,
      personaEntities: mockPersonaEntities,
      humanEntity: mockHumanEntity,
      reset: resetMocks
    }
  };
}
