import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies
vi.mock('../../src/storage.js', () => ({
  loadHistory: vi.fn(() => Promise.resolve({ messages: [] })),
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

// Minimal blessed stubs - just prevent initialization errors
vi.mock('blessed', () => ({
  default: {
    screen: vi.fn(() => ({
      width: 100,
      height: 30,
      render: vi.fn(),
      destroy: vi.fn(),
      key: vi.fn(),
      on: vi.fn(),
      append: vi.fn(),
      remove: vi.fn(),
      alloc: vi.fn(),
      realloc: vi.fn(),
      clearRegion: vi.fn(),
      options: { smartCSR: true, fullUnicode: true },
      focused: null,
    })),
    box: vi.fn(() => ({
      setContent: vi.fn(),
      setLabel: vi.fn(),
      focus: vi.fn(),
      scroll: vi.fn(),
      scrollTo: vi.fn(),
      getScroll: vi.fn(() => 0),
      getScrollHeight: vi.fn(() => 100),
      on: vi.fn(),
      key: vi.fn(),
      removeAllListeners: vi.fn(),
      type: 'box',
    })),
    textbox: vi.fn(() => ({
      focus: vi.fn(),
      clearValue: vi.fn(),
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      on: vi.fn(),
      key: vi.fn(),
      unkey: vi.fn(),
      removeAllListeners: vi.fn(),
      type: 'textbox',
    })),
  }
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
    vi.clearAllMocks();
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
      // Mock finding a valid persona
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue('claude');

      // Execute persona command
      await app.testHandleCommand('/persona claude');

      // Verify persona lookup was called
      expect(findPersonaByNameOrAlias).toHaveBeenCalledWith('claude');
      
      // Verify status message indicates success
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

    test('persona command alias /p works identically', async () => {
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue('claude');

      // Execute using /p alias
      await app.testHandleCommand('/p claude');

      // Verify same behavior as /persona
      expect(findPersonaByNameOrAlias).toHaveBeenCalledWith('claude');
      expect(app.getTestStatusMessage()).toContain('Switched to persona: claude');
    });
  });

  describe('Help Command Flow', () => {
    test('help command displays command information', async () => {
      // Execute help command
      await app.testHandleCommand('/help');

      // Verify help text is displayed
      expect(app.getTestStatusMessage()).toContain('Commands:');
      expect(app.getTestStatusMessage()).toContain('/persona');
      expect(app.getTestStatusMessage()).toContain('/quit');
      expect(app.getTestStatusMessage()).toContain('/refresh');
      expect(app.getTestStatusMessage()).toContain('/help');
    });

    test('help command alias /h works identically', async () => {
      // Execute using /h alias
      await app.testHandleCommand('/h');

      // Verify same help text is displayed
      expect(app.getTestStatusMessage()).toContain('Commands:');
      expect(app.getTestStatusMessage()).toContain('/persona');
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

      // Verify it was processed as command, not message
      expect(processEvent).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain('Commands:');
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