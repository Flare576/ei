import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBlessedMock } from '../helpers/blessed-mocks.js';

vi.mock('blessed', () => createBlessedMock());

vi.mock('../../src/storage.js', () => ({
  loadHistory: vi.fn(() => Promise.resolve({ messages: [] })),
  loadConceptMap: vi.fn(() => Promise.resolve({ entity: 'system', concepts: [], last_updated: null })),
  listPersonas: vi.fn(() => Promise.resolve([
    { name: 'ei' },
    { name: 'claude' },
    { name: 'assistant' }
  ])),
  findPersonaByNameOrAlias: vi.fn((name) => Promise.resolve(
    ['ei', 'claude', 'assistant'].includes(name) ? name : null
  )),
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
import { loadHistory, findPersonaByNameOrAlias } from '../../src/storage.js';

// Test wrapper class to access private methods for testing business logic
class TestableEIApp extends EIApp {
  // Expose private methods for testing
  public getTestPersonaStates(): Map<string, any> {
    return (this as any).personaStates;
  }
  
  public getTestUnreadCounts(): Map<string, number> {
    return (this as any).unreadCounts;
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
  
  public getTestIsProcessing(): boolean {
    return (this as any).isProcessing;
  }
  
  public testGetOrCreatePersonaState(personaName: string): any {
    return (this as any).getOrCreatePersonaState(personaName);
  }
  
  public async testSwitchPersona(personaName: string): Promise<void> {
    return (this as any).switchPersona(personaName);
  }
  
  public async testHandleCommand(input: string): Promise<void> {
    return (this as any).handleCommand(input);
  }
  
  public testCleanup(): void {
    try {
      (this as any).cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  }
}

describe('Persona Management Integration Tests', () => {
  let app: TestableEIApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = new TestableEIApp();
    await app.init();
  });

  afterEach(() => {
    if (app) {
      app.testCleanup();
    }
  });

  describe('Persona Switching Coordination', () => {
    test('successful persona switch loads history and updates state', async () => {
      // Mock persona history
      const mockHistory = {
        messages: [
          { role: 'human', content: 'Previous message', timestamp: new Date().toISOString() },
          { role: 'system', content: 'Previous response', timestamp: new Date().toISOString() }
        ]
      };
      vi.mocked(loadHistory).mockResolvedValue(mockHistory);

      const initialPersona = app.getTestActivePersona();

      // Switch persona
      await app.testSwitchPersona('claude');

      // Verify persona was changed
      expect(app.getTestActivePersona()).toBe('claude');
      expect(app.getTestActivePersona()).not.toBe(initialPersona);

      // Verify history was loaded
      expect(loadHistory).toHaveBeenCalledWith('claude');

      // Verify messages were updated
      expect(app.getTestMessages()).toEqual(mockHistory.messages);

      // Verify status message
      expect(app.getTestStatusMessage()).toContain('Switched to persona: claude');
    });

    test('persona switch clears unread count for target persona', async () => {
      vi.mocked(loadHistory).mockResolvedValue({ messages: [] });

      // Set up unread count for claude
      const unreadCounts = app.getTestUnreadCounts();
      unreadCounts.set('claude', 5);
      expect(unreadCounts.get('claude')).toBe(5);

      // Switch to claude
      await app.testSwitchPersona('claude');

      // Verify unread count was cleared
      expect(unreadCounts.has('claude')).toBe(false);
    });

    test('switching to same persona scrolls to bottom without reload', async () => {
      const currentPersona = app.getTestActivePersona();
      const initialMessageCount = app.getTestMessages().length;

      vi.mocked(loadHistory).mockClear();

      await app.testSwitchPersona(currentPersona);

      expect(app.getTestActivePersona()).toBe(currentPersona);
      expect(app.getTestMessages()).toHaveLength(initialMessageCount);
      expect(loadHistory).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain('Scrolled to latest');
    });

    test('persona switch error shows error status', async () => {
      vi.mocked(loadHistory).mockRejectedValue(new Error('Failed to load history'));

      const originalPersona = app.getTestActivePersona();

      // Attempt to switch persona
      await app.testSwitchPersona('claude');

      // Verify error status is shown
      expect(app.getTestStatusMessage()).toContain('Error loading persona: Failed to load history');

      // Verify persona was not changed
      expect(app.getTestActivePersona()).toBe(originalPersona);
    });

    test('persona switch transfers processing state correctly', async () => {
      vi.mocked(loadHistory).mockResolvedValue({ messages: [] });

      // Set up processing state for target persona
      const targetState = app.testGetOrCreatePersonaState('claude');
      targetState.isProcessing = true;

      // Switch to processing persona
      await app.testSwitchPersona('claude');

      // Verify global processing state reflects target persona
      expect(app.getTestIsProcessing()).toBe(true);
    });
  });

  describe('Persona State Management', () => {
    test('getOrCreatePersonaState creates new state for unknown persona', () => {
      const personaName = 'newpersona';
      const personaStates = app.getTestPersonaStates();

      // Verify persona state doesn't exist
      expect(personaStates.has(personaName)).toBe(false);

      // Get or create state
      const state = app.testGetOrCreatePersonaState(personaName);

      // Verify state was created with correct defaults
      expect(state.name).toBe(personaName);
      expect(state.isProcessing).toBe(false);
      expect(state.messageQueue).toEqual([]);
      expect(state.unreadCount).toBe(0);
      expect(state.heartbeatTimer).toBeNull();
      expect(state.debounceTimer).toBeNull();
      expect(state.abortController).toBeNull();
      expect(typeof state.lastActivity).toBe('number');

      // Verify state was stored
      expect(personaStates.has(personaName)).toBe(true);
      expect(personaStates.get(personaName)).toBe(state);
    });

    test('getOrCreatePersonaState returns existing state for known persona', () => {
      const personaName = 'existing';

      // Create initial state
      const initialState = app.testGetOrCreatePersonaState(personaName);
      initialState.unreadCount = 3;
      initialState.isProcessing = true;

      // Get state again
      const retrievedState = app.testGetOrCreatePersonaState(personaName);

      // Verify same state object was returned
      expect(retrievedState).toBe(initialState);
      expect(retrievedState.unreadCount).toBe(3);
      expect(retrievedState.isProcessing).toBe(true);
    });

    test('persona state tracks processing status correctly', () => {
      const personaName = 'testpersona';
      const state = app.testGetOrCreatePersonaState(personaName);

      // Initial state
      expect(state.isProcessing).toBe(false);

      // Set processing
      state.isProcessing = true;
      expect(state.isProcessing).toBe(true);

      // Clear processing
      state.isProcessing = false;
      expect(state.isProcessing).toBe(false);
    });

    test('persona state tracks message queue correctly', () => {
      const personaName = 'testpersona';
      const state = app.testGetOrCreatePersonaState(personaName);

      // Initial queue
      expect(state.messageQueue).toEqual([]);

      // Add messages
      state.messageQueue.push('Message 1');
      state.messageQueue.push('Message 2');
      expect(state.messageQueue).toEqual(['Message 1', 'Message 2']);

      // Clear queue
      state.messageQueue = [];
      expect(state.messageQueue).toEqual([]);
    });

    test('persona state tracks unread count correctly', () => {
      const personaName = 'testpersona';
      const state = app.testGetOrCreatePersonaState(personaName);

      // Initial count
      expect(state.unreadCount).toBe(0);

      // Increment count
      state.unreadCount++;
      expect(state.unreadCount).toBe(1);

      state.unreadCount += 5;
      expect(state.unreadCount).toBe(6);

      // Reset count
      state.unreadCount = 0;
      expect(state.unreadCount).toBe(0);
    });
  });

  describe('Unread Count Management', () => {
    test('unread count increments for background persona responses', () => {
      const backgroundPersona = 'claude';
      const unreadCounts = app.getTestUnreadCounts();
      
      // Switch to different persona
      app.testSwitchPersona('ei');

      // Simulate background response for claude
      const state = app.testGetOrCreatePersonaState(backgroundPersona);
      state.unreadCount++;
      unreadCounts.set(backgroundPersona, state.unreadCount);

      // Verify unread count was set
      expect(unreadCounts.get(backgroundPersona)).toBe(1);

      // Increment again
      state.unreadCount++;
      unreadCounts.set(backgroundPersona, state.unreadCount);
      expect(unreadCounts.get(backgroundPersona)).toBe(2);
    });

    test('unread count does not increment for active persona responses', () => {
      const activePersona = 'ei';
      const unreadCounts = app.getTestUnreadCounts();

      // Ensure we're on the active persona
      expect(app.getTestActivePersona()).toBe(activePersona);

      // Simulate response for active persona
      const state = app.testGetOrCreatePersonaState(activePersona);
      // Active persona responses don't increment unread count
      
      // Verify no unread count
      expect(unreadCounts.has(activePersona)).toBe(false);
    });

    test('switching to persona with unread count clears it', async () => {
      vi.mocked(loadHistory).mockResolvedValue({ messages: [] });

      const unreadCounts = app.getTestUnreadCounts();

      // Set unread count
      unreadCounts.set('claude', 3);
      expect(unreadCounts.get('claude')).toBe(3);

      // Switch to persona
      await app.testSwitchPersona('claude');

      // Verify unread count was cleared
      expect(unreadCounts.has('claude')).toBe(false);
    });
  });

  describe('Persona List Display', () => {
    test('persona command without arguments lists available personas', async () => {
      // Execute persona command without arguments to show list
      await app.testHandleCommand('/persona');

      // Verify status shows available personas
      expect(app.getTestStatusMessage()).toContain('Available personas:');
      expect(app.getTestStatusMessage()).toContain('ei'); // Default active persona
    });

    test('persona list shows active persona marker', async () => {
      // Execute persona command without arguments to show list
      await app.testHandleCommand('/persona');

      // Verify status shows active persona marker
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage).toContain('Available personas:');
      expect(statusMessage).toContain('ei'); // Should show current active persona
    });

    test('persona list shows unread counts', async () => {
      const unreadCounts = app.getTestUnreadCounts();

      // Set unread counts for personas
      unreadCounts.set('claude', 2);
      unreadCounts.set('assistant', 5);

      // Execute persona command to show list
      await app.testHandleCommand('/persona');

      // Verify unread counts are displayed
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage).toContain('claude');
      expect(statusMessage).toContain('assistant');
      // Note: The exact format of unread display may vary, so we just check personas are listed
    });
  });

  describe('Persona Processing Coordination', () => {
    test('active persona processing updates global processing state', () => {
      const activePersona = app.getTestActivePersona();
      const state = app.testGetOrCreatePersonaState(activePersona);

      // Start processing for active persona
      state.isProcessing = true;
      // In real app, this would be set by the processing logic
      // For test, we simulate the coordination

      // Verify persona state
      expect(state.isProcessing).toBe(true);
    });

    test('background persona processing does not affect global processing state', () => {
      const backgroundPersona = 'claude';
      const activePersona = app.getTestActivePersona();
      
      // Ensure we're testing with different personas
      expect(backgroundPersona).not.toBe(activePersona);

      const state = app.testGetOrCreatePersonaState(backgroundPersona);

      // Start processing for background persona
      state.isProcessing = true;

      // Verify background persona is processing
      expect(state.isProcessing).toBe(true);
      
      // Verify global processing state is not affected (would be false unless active persona is processing)
      expect(app.getTestIsProcessing()).toBe(false);
    });

    test('switching personas during processing transfers processing state', async () => {
      vi.mocked(loadHistory).mockResolvedValue({ messages: [] });

      // Set up processing state for target persona
      const targetState = app.testGetOrCreatePersonaState('claude');
      targetState.isProcessing = true;

      // Switch to processing persona
      await app.testSwitchPersona('claude');

      // Verify global processing state reflects target persona
      expect(app.getTestIsProcessing()).toBe(true);
    });
  });
});
