import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBlessedMock } from '../helpers/blessed-mocks.js';

vi.mock('blessed', () => createBlessedMock());

const mockPersonas = [
  { name: 'ei', aliases: ['default', 'core'] },
  { name: 'claude', aliases: ['assistant'] },
  { name: 'assistant', aliases: [] }
];

const mockConceptMaps = new Map<string, any>();
mockConceptMaps.set('ei:system', { entity: 'system', aliases: ['default', 'core'], last_updated: null, concepts: [] });
mockConceptMaps.set('claude:system', { entity: 'system', aliases: ['assistant'], last_updated: null, concepts: [] });
mockConceptMaps.set('assistant:system', { entity: 'system', aliases: [], last_updated: null, concepts: [] });

vi.mock('../../src/storage.js', () => ({
  loadHistory: vi.fn(() => Promise.resolve({ messages: [] })),
  listPersonas: vi.fn(() => Promise.resolve(mockPersonas)),
  findPersonaByNameOrAlias: vi.fn(async (name, options) => {
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
  loadConceptMap: vi.fn((entity, persona) => {
    const key = `${persona}:${entity}`;
    return Promise.resolve(mockConceptMaps.get(key) || {
      entity,
      aliases: [],
      last_updated: new Date().toISOString(),
      concepts: [],
    });
  }),
  saveConceptMap: vi.fn((conceptMap, persona) => {
    const key = `${persona}:${conceptMap.entity}`;
    mockConceptMaps.set(key, conceptMap);
    const p = mockPersonas.find(p => p.name === persona);
    if (p && conceptMap.aliases) {
      p.aliases = [...conceptMap.aliases];
    }
    return Promise.resolve();
  }),
  findPersonaByAlias: vi.fn(async (alias) => {
    const lower = alias.toLowerCase();
    for (const p of mockPersonas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        return { personaName: p.name, alias: matchedAlias };
      }
    }
    return null;
  }),
  addPersonaAlias: vi.fn(async (personaName, alias) => {
    const existing = await vi.mocked((await import('../../src/storage.js')).findPersonaByAlias)(alias);
    if (existing) {
      throw new Error(`Alias "${alias}" already exists on persona "${existing.personaName}"`);
    }
    const conceptMap = mockConceptMaps.get(`${personaName}:system`);
    if (!conceptMap) throw new Error(`Persona ${personaName} not found`);
    if (!conceptMap.aliases) conceptMap.aliases = [];
    const lower = alias.toLowerCase();
    if (conceptMap.aliases.some((a: string) => a.toLowerCase() === lower)) {
      throw new Error(`Alias "${alias}" already exists on this persona`);
    }
    conceptMap.aliases.push(alias);
    conceptMap.last_updated = new Date().toISOString();
    const p = mockPersonas.find(p => p.name === personaName);
    if (p) p.aliases = [...conceptMap.aliases];
  }),
  removePersonaAlias: vi.fn(async (personaName, pattern) => {
    const conceptMap = mockConceptMaps.get(`${personaName}:system`);
    if (!conceptMap || !conceptMap.aliases || conceptMap.aliases.length === 0) {
      throw new Error(`No aliases found for persona "${personaName}"`);
    }
    const lower = pattern.toLowerCase();
    const matches = conceptMap.aliases.filter((a: string) => a.toLowerCase().includes(lower));
    if (matches.length === 0) {
      throw new Error(`No aliases matching "${pattern}" found on persona "${personaName}"`);
    }
    if (matches.length > 1) {
      throw new Error(`Ambiguous: multiple aliases match "${pattern}": ${matches.join(", ")}`);
    }
    const removedAlias = matches[0];
    conceptMap.aliases = conceptMap.aliases.filter((a: string) => a !== removedAlias);
    conceptMap.last_updated = new Date().toISOString();
    const p = mockPersonas.find(p => p.name === personaName);
    if (p) p.aliases = [...conceptMap.aliases];
    return [removedAlias];
  }),
  findArchivedPersonaByNameOrAlias: vi.fn(() => Promise.resolve(null)),
  getArchivedPersonas: vi.fn(() => Promise.resolve([])),
  loadArchiveState: vi.fn(() => Promise.resolve({ isArchived: false })),
  saveArchiveState: vi.fn(() => Promise.resolve()),
  initializeDataDirectory: vi.fn(() => Promise.resolve()),
  initializeDebugLog: vi.fn(),
  appendDebugLog: vi.fn(),
  getPendingMessages: vi.fn(() => Promise.resolve([])),
  replacePendingMessages: vi.fn(() => Promise.resolve()),
  appendHumanMessage: vi.fn(() => Promise.resolve()),
  getUnprocessedMessages: vi.fn(() => Promise.resolve([])),
  markSystemMessagesAsRead: vi.fn(() => Promise.resolve()),
  getUnreadSystemMessageCount: vi.fn(() => Promise.resolve(0)),
  loadPauseState: vi.fn(() => Promise.resolve({ isPaused: false })),
  savePauseState: vi.fn(() => Promise.resolve()),
  setStateManager: vi.fn(),
  getDataPath: vi.fn(() => "/tmp/ei-test"),
}));

vi.mock('../../src/processor.js', () => ({
  processEvent: vi.fn(() => Promise.resolve({
    response: 'Test response from LLM',
    aborted: false,
    humanConceptsUpdated: false,
    systemConceptsUpdated: false
  })),
}));

vi.mock('../../src/llm.js', () => ({
  LLMAbortedError: class extends Error {
    name = 'LLMAbortedError';
    constructor(message: string) {
      super(message);
      this.name = 'LLMAbortedError';
    }
  },
}));

vi.mock('../../src/concept-queue.js', () => ({
  ConceptQueue: {
    getInstance: vi.fn(() => ({
      enqueue: vi.fn(() => 'mock-task-id'),
      getQueueLength: vi.fn(() => 0),
      isProcessing: vi.fn(() => false),
    })),
  },
}));

import { EIApp } from '../../src/blessed/app.js';
import { processEvent } from '../../src/processor.js';
import { findPersonaByNameOrAlias } from '../../src/storage.js';

// Test wrapper class to access private methods for testing business logic
class TestableEIApp extends EIApp {
  // Expose private methods for testing
  public async testHandleCommand(input: string): Promise<void> {
    return (this as any).handleCommand(input);
  }
  
  public async testHandleSubmit(text: string): Promise<void> {
    return (this as any).handleSubmit(text);
  }
  
  public getTestStatusMessage(): string | null {
    return (this as any).statusMessage;
  }
  
  public getTestMessages(): any[] {
    return (this as any).messages;
  }
  
  public getTestActivePersona(): string {
    return (this as any).activePersona;
  }
  
  public testCleanup(): void {
    try {
      (this as any).cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  }
}

describe('Command Flow Integration Tests', () => {
  let app: TestableEIApp;

  beforeEach(async () => {
    vi.resetAllMocks();
    
    mockConceptMaps.clear();
    mockConceptMaps.set('ei:system', { entity: 'system', aliases: ['default', 'core'], last_updated: null, concepts: [] });
    mockConceptMaps.set('claude:system', { entity: 'system', aliases: ['assistant'], last_updated: null, concepts: [] });
    mockConceptMaps.set('assistant:system', { entity: 'system', aliases: [], last_updated: null, concepts: [] });
    
    mockPersonas.length = 0;
    mockPersonas.push(
      { name: 'ei', aliases: ['default', 'core'] },
      { name: 'claude', aliases: ['assistant'] },
      { name: 'assistant', aliases: [] }
    );
    
    app = new TestableEIApp();
    await app.init();
  });

  afterEach(() => {
    if (app) {
      app.testCleanup();
    }
  });

  describe('Persona Command Flow', () => {
    test('persona command with valid name triggers persona switch', async () => {
      await app.testHandleCommand('/persona claude');

      expect(findPersonaByNameOrAlias).toHaveBeenCalledWith('claude');
      
      expect(app.getTestStatusMessage()).toContain('Switched to persona: claude');
    });

    test('persona command with unknown name prompts for creation', async () => {
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue(null);

      await app.testHandleCommand('/persona nonexistent');

      expect(app.getTestStatusMessage()).toContain("Persona 'nonexistent' not found. Create it? (y/n)");
    });

    test('persona command without arguments lists available personas', async () => {
      // Execute persona command without arguments
      await app.testHandleCommand('/persona');

      // Verify status shows available personas
      expect(app.getTestStatusMessage()).toContain('Available personas:');
      expect(app.getTestStatusMessage()).toContain('ei');
    });

    test('persona command with partial alias match switches persona', async () => {
      await app.testHandleCommand('/nick add "Test Master"');
      await app.testHandleCommand('/persona claude');
      
      await app.testHandleCommand('/persona Test');
      
      expect(app.getTestStatusMessage()).toContain('Switched to persona: ei');
    });

    test('persona command with ambiguous partial alias shows error', async () => {
      await app.testHandleCommand('/nick add "Test Master"');
      await app.testHandleCommand('/persona claude');
      await app.testHandleCommand('/nick add "Test Helper"');
      await app.testHandleCommand('/persona assistant');
      
      await app.testHandleCommand('/persona Test');
      
      const status = app.getTestStatusMessage();
      expect(status).toContain('Ambiguous');
      expect(status).toContain('Test Master');
      expect(status).toContain('Test Helper');
    });

    test('persona command with unquoted multi-word input uses first word only', async () => {
      await app.testHandleCommand('/persona Test Master');
      
      const status = app.getTestStatusMessage();
      expect(status).toContain("Persona 'Test' not found");
    });

    test('persona command alias /p works identically', async () => {
      await app.testHandleCommand('/p claude');

      expect(findPersonaByNameOrAlias).toHaveBeenCalledWith('claude');
      expect(app.getTestStatusMessage()).toContain('Switched to persona: claude');
    });
  });

  describe('Help Command Flow', () => {
    test('help command displays command information', async () => {
      await app.testHandleCommand('/help');

      expect(app.getTestStatusMessage()).toBeNull();
    });

    test('help command alias /h works identically', async () => {
      await app.testHandleCommand('/h');

      expect(app.getTestStatusMessage()).toBeNull();
    });
  });

  describe('Refresh Command Flow', () => {
    test('refresh command shows status message', async () => {
      // Execute refresh command
      await app.testHandleCommand('/refresh');

      // Verify status message indicates refresh was attempted
      // Note: The actual UI refresh may fail in test environment due to mocked blessed,
      // but we can verify the command was processed and status was set
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage).toBeTruthy();
      expect(statusMessage).toContain('UI refreshed');
    });

    test('refresh command alias /r works identically', async () => {
      // Execute using /r alias
      await app.testHandleCommand('/r');

      // Verify same behavior as /refresh - status message should be set
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage).toBeTruthy();
      expect(statusMessage).toContain('UI refreshed');
    });
  });

  describe('Quit Command Flow', () => {
    test('quit command with --force bypasses safety checks', async () => {
      // Mock process.exit to prevent actual exit
      const originalExit = process.exit;
      const mockExit = vi.fn();
      process.exit = mockExit as any;

      try {
        // Execute force quit
        await app.testHandleCommand('/quit --force');

        // Verify exit was called
        expect(mockExit).toHaveBeenCalledWith(0);
      } finally {
        process.exit = originalExit;
      }
    });

    test('quit command with invalid arguments shows error', async () => {
      // Test various invalid arguments
      const invalidArgs = ['--invalid', '-f', 'force', 'random'];

      for (const arg of invalidArgs) {
        // Execute quit with invalid argument
        await app.testHandleCommand(`/quit ${arg}`);

        // Verify error message
        expect(app.getTestStatusMessage()).toContain('Usage: /quit [--force]');
      }
    });

    test('quit command alias /q works identically', async () => {
      const originalExit = process.exit;
      const mockExit = vi.fn();
      process.exit = mockExit as any;

      try {
        // Execute using /q alias
        await app.testHandleCommand('/q --force');

        // Verify same behavior as /quit
        expect(mockExit).toHaveBeenCalledWith(0);
      } finally {
        process.exit = originalExit;
      }
    });
  });

  describe('Nick Command Flow', () => {
    test('/nick lists aliases for active persona', async () => {
      await app.testHandleCommand('/nick');

      const status = app.getTestStatusMessage();
      expect(status).toContain('ei');
      expect(status).toContain('default');
      expect(status).toContain('core');
    });

    test('/nick list works identically to /nick', async () => {
      await app.testHandleCommand('/nick list');

      const status = app.getTestStatusMessage();
      expect(status).toContain('ei');
      expect(status).toContain('default');
    });

    test('/nick shows message when no aliases exist', async () => {
      (app as any).activePersona = 'assistant';
      await app.testHandleCommand('/nick');

      const status = app.getTestStatusMessage();
      expect(status).toContain('assistant has no aliases');
    });

    test('/nick add adds single-word alias', async () => {
      await app.testHandleCommand('/nick add newAlias');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Added alias "newAlias"');
      expect(status).toContain('ei');
    });

    test('/nick add adds quoted multi-word alias', async () => {
      await app.testHandleCommand('/nick add "Alice the Great"');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Added alias "Alice the Great"');
    });

    test('/nick add with unquoted multi-word shows usage error', async () => {
      await app.testHandleCommand('/nick add Bob the Builder');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Usage');
    });

    test('/nick add shows error for duplicate alias on same persona', async () => {
      await app.testHandleCommand('/nick add default');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Error');
      expect(status).toContain('already exists');
    });

    test('/nick add shows error for duplicate alias across personas', async () => {
      await app.testHandleCommand('/nick add assistant');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Error');
      expect(status).toContain('already exists on persona "claude"');
    });

    test('/nick add shows usage when no alias provided', async () => {
      await app.testHandleCommand('/nick add');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Usage');
      expect(status).toContain('/nick add');
    });

    test('/nick remove removes alias by exact match', async () => {
      await app.testHandleCommand('/nick remove default');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Removed alias "default"');
    });

    test('/nick remove removes alias by partial match', async () => {
      await app.testHandleCommand('/nick remove "def"');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Removed alias "default"');
    });

    test('/nick remove shows error when no aliases exist', async () => {
      (app as any).activePersona = 'assistant';
      await app.testHandleCommand('/nick remove test');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Error');
      expect(status).toContain('No aliases found');
    });

    test('/nick remove shows error when pattern matches no aliases', async () => {
      await app.testHandleCommand('/nick remove nonexistent');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Error');
      expect(status).toContain('No aliases matching');
    });

    test('/nick remove shows usage when no pattern provided', async () => {
      await app.testHandleCommand('/nick remove');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Usage');
      expect(status).toContain('/nick remove');
    });

    test('/nick with invalid subcommand shows error', async () => {
      await app.testHandleCommand('/nick invalid');

      const status = app.getTestStatusMessage();
      expect(status).toContain('Unknown subcommand');
      expect(status).toContain('invalid');
    });

    test('/nick alias /n works identically', async () => {
      await app.testHandleCommand('/n');

      const status = app.getTestStatusMessage();
      expect(status).toContain('ei');
      expect(status).toContain('default');
    });
  });

  describe('Unknown Command Flow', () => {
    test('unknown command shows error message', async () => {
      // Execute unknown command
      await app.testHandleCommand('/unknown');

      // Verify error message
      expect(app.getTestStatusMessage()).toContain('Unknown command: /unknown');
    });

    test('command with special characters handled gracefully', async () => {
      // Execute command with special characters
      await app.testHandleCommand('/test@#$%');

      // Verify error message (not crash)
      expect(app.getTestStatusMessage()).toContain('Unknown command: /test@#$%');
    });
  });

  describe('Message Processing Flow', () => {
    test('regular message triggers LLM processing', async () => {
      // Mock successful LLM response
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Test LLM response',
        aborted: false,
        humanConceptsUpdated: false,
        systemConceptsUpdated: false
      });

      // Submit regular message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Hello, how are you? This is a longer message to trigger processing');

      // Verify processEvent was called
      expect(processEvent).toHaveBeenCalledWith(
        'Hello, how are you? This is a longer message to trigger processing',
        'ei', // default persona
        expect.any(Boolean), // debug flag
        expect.any(Object) // abort signal
      );

      // Verify message was added to chat
      expect(app.getTestMessages()).toHaveLength(2); // human message + system response
      expect(app.getTestMessages()[0].role).toBe('human');
      expect(app.getTestMessages()[0].content).toBe('Hello, how are you? This is a longer message to trigger processing');
      expect(app.getTestMessages()[1].role).toBe('system');
      expect(app.getTestMessages()[1].content).toBe('Test LLM response');
    });

    test('empty message submission is ignored', async () => {
      const initialMessageCount = app.getTestMessages().length;

      // Submit empty message
      await app.testHandleSubmit('');

      // Verify no processing occurred
      expect(processEvent).not.toHaveBeenCalled();
      expect(app.getTestMessages()).toHaveLength(initialMessageCount);
    });

    test('whitespace-only message is ignored', async () => {
      const initialMessageCount = app.getTestMessages().length;

      // Submit whitespace-only message
      await app.testHandleSubmit('   \n\t   ');

      // Verify no processing occurred
      expect(processEvent).not.toHaveBeenCalled();
      expect(app.getTestMessages()).toHaveLength(initialMessageCount);
    });
  });

  describe('Command vs Message Distinction', () => {
    test('text starting with / is treated as command', async () => {
      // Submit text that looks like command
      await app.testHandleSubmit('/help');

      expect(processEvent).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toBeNull();
    });

    test('text not starting with / is treated as message', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
        humanConceptsUpdated: false,
        systemConceptsUpdated: false
      });

      // Submit regular text (long enough to trigger immediate processing)
      await app.testHandleSubmit('This is a regular message that is long enough to trigger immediate processing');

      // Verify it was processed as message, not command
      expect(processEvent).toHaveBeenCalled();
      
      // Verify no error status was set (status should be null for successful processing)
      const statusMessage = app.getTestStatusMessage();
      if (statusMessage !== null) {
        expect(statusMessage).not.toContain('Unknown command');
      }
    });

    test('text with / in middle is treated as message', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
        humanConceptsUpdated: false,
        systemConceptsUpdated: false
      });

      // Submit text with / in middle (long enough to trigger immediate processing)
      await app.testHandleSubmit('This has a / in the middle and is long enough to trigger processing');

      // Verify it was processed as message
      expect(processEvent).toHaveBeenCalled();
    });
  });
});
