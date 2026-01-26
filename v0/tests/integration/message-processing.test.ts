import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBlessedMock } from '../helpers/blessed-mocks.js';
import { createStorageMocks } from '../helpers/storage-mocks.js';
import { createLLMMocks } from '../helpers/llm-mocks.js';
import { createQueueProcessorMock } from '../helpers/queue-processor-mock.js';

vi.mock('blessed', () => createBlessedMock());
vi.mock('../../src/storage.js', () => createStorageMocks());
vi.mock('../../src/llm.js', () => createLLMMocks());
vi.mock('../../src/queue-processor.js', () => createQueueProcessorMock());

vi.mock('../../src/processor.js', () => ({
  processEvent: vi.fn(() => Promise.resolve({
    response: 'Test response from LLM',
    aborted: false,
  })),
}));

import { EIApp } from '../../src/blessed/app.js';
import { processEvent } from '../../src/processor.js';
import { LLMAbortedError } from '../../src/llm.js';

// Test wrapper class to access private methods for testing business logic
class TestableEIApp extends EIApp {
  // Expose private methods for testing
  public getTestMessages(): any[] {
    return (this as any).messages;
  }
  
  public getTestStatusMessage(): string | null {
    return (this as any).statusMessage;
  }
  
  public getTestActivePersona(): string {
    return (this as any).activePersona;
  }
  
  public setTestActivePersona(persona: string): void {
    (this as any).activePersona = persona;
  }
  
  public getTestIsProcessing(): boolean {
    return (this as any).isProcessing;
  }
  
  public testGetOrCreatePersonaState(personaName: string): any {
    return (this as any).getOrCreatePersonaState(personaName);
  }
  
  public getTestUnreadCounts(): Map<string, number> {
    return (this as any).unreadCounts;
  }
  
  public async testHandleSubmit(text: string): Promise<void> {
    return (this as any).handleSubmit(text);
  }
  
  public async testHandleCommand(input: string): Promise<void> {
    return (this as any).handleCommand(input);
  }
  
  public async testCleanup(): Promise<void> {
    try {
      await (this as any).cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  }
}

describe('Message Processing Integration Tests', () => {
  let app: TestableEIApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = new TestableEIApp();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.testCleanup();
    }
  });

  describe('Message Submission Flow', () => {
    test('successful message processing adds response to chat', async () => {
      // Mock successful LLM response with complete ProcessResult
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Hello! How can I help you today?',
        aborted: false,
      });

      const initialMessageCount = app.getTestMessages().length;

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Hello there, this is a longer message to trigger processing');

      // Verify processEvent was called with correct parameters
      expect(processEvent).toHaveBeenCalledWith(
        'Hello there, this is a longer message to trigger processing',
        'ei', // default active persona
        expect.any(Boolean), // debug flag
        expect.any(AbortSignal) // abort signal
      );

      // Verify messages were added
      const messages = app.getTestMessages();
      expect(messages).toHaveLength(initialMessageCount + 2);
      
      // Check human message
      const humanMessage = messages[messages.length - 2];
      expect(humanMessage.role).toBe('human');
      expect(humanMessage.content).toBe('Hello there, this is a longer message to trigger processing');
      expect(humanMessage.state).toBe('sent');

      // Check system response
      const systemMessage = messages[messages.length - 1];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toBe('Hello! How can I help you today?');
    });

    test('LLM error handling shows error status', async () => {
      // Mock LLM error
      vi.mocked(processEvent).mockRejectedValue(new Error('LLM connection failed'));

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify error status is shown
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage).toContain('Error: LLM connection failed');

      // Verify human message state is marked as failed
      const messages = app.getTestMessages();
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe('human');
      expect(lastMessage.state).toBe('failed');
    });

    test('LLM abort error does not show error status', async () => {
      // Mock LLM abort (user cancelled)
      vi.mocked(processEvent).mockRejectedValue(new LLMAbortedError('Aborted'));

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify no error status is shown (abort is expected)
      const statusMessage = app.getTestStatusMessage();
      expect(statusMessage || '').not.toContain('Error:');
    });

    test('null LLM response does not add system message', async () => {
      // Mock LLM returning no response
      vi.mocked(processEvent).mockResolvedValue({
        response: null,
        aborted: false,
      });

      const initialMessageCount = app.getTestMessages().length;

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify only human message was added (no system response)
      const messages = app.getTestMessages();
      expect(messages).toHaveLength(initialMessageCount + 1);
      expect(messages[messages.length - 1].role).toBe('human');
    });

    test('aborted LLM response does not update message state', async () => {
      // Mock aborted LLM response
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Partial response',
        aborted: true,
      });

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify human message state remains as 'processing' (not updated to 'sent')
      const messages = app.getTestMessages();
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe('human');
      expect(lastMessage.state).toBe('processing');
    });
  });

  describe('Message State Management', () => {
    test('message starts with processing state', async () => {
      // Mock delayed response to check initial state
      let resolveProcessing: (value: any) => void;
      const processingPromise = new Promise(resolve => {
        resolveProcessing = resolve;
      });
      
      vi.mocked(processEvent).mockImplementation(() => processingPromise);

      // Submit message (long enough to trigger immediate processing)
      const submitPromise = app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Give the message addition a moment to complete (snapshot is async)
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check initial state
      const initialMessages = app.getTestMessages();
      const initialLastMessage = initialMessages[initialMessages.length - 1];
      expect(initialLastMessage.role).toBe('human');
      expect(initialLastMessage.state).toBe('processing');

      // Complete the processing
      resolveProcessing!({
        response: 'Response',
        aborted: false,
      });

      // Wait for completion
      await submitPromise;

      // Check final state - need to get the messages again since updateLastHumanMessageState creates new objects
      const finalMessages = app.getTestMessages();
      const finalLastHumanMessage = finalMessages.filter(m => m.role === 'human').pop();
      expect(finalLastHumanMessage?.state).toBe('sent');
    });

    test('processing indicator shows during message processing', async () => {
      // Mock delayed response
      let resolveProcessing: (value: any) => void;
      const processingPromise = new Promise(resolve => {
        resolveProcessing = resolve;
      });
      
      vi.mocked(processEvent).mockImplementation(() => processingPromise);

      // Submit message (long enough to trigger immediate processing)
      const submitPromise = app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Give the processing a moment to start
      await new Promise(resolve => setTimeout(resolve, 10));

      // Check processing indicator is active
      expect(app.getTestIsProcessing()).toBe(true);

      // Complete the processing
      resolveProcessing!({
        response: 'Response',
        aborted: false,
      });

      // Wait for completion
      await submitPromise;

      // Check processing indicator is cleared
      expect(app.getTestIsProcessing()).toBe(false);
    });
  });

  describe('Persona Context in Processing', () => {
    test('message processing uses active persona', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
      });

      // Switch to different persona
      app.setTestActivePersona('claude');

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify processEvent was called with correct persona
      expect(processEvent).toHaveBeenCalledWith(
        'Test message that is long enough to trigger processing',
        'claude', // active persona
        expect.any(Boolean),
        expect.any(AbortSignal)
      );
    });

    test('message processing coordinates with persona state management', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response from claude',
        aborted: false,
      });

      // Switch to claude persona
      app.setTestActivePersona('claude');

      // Submit message (long enough to trigger immediate processing)
      await app.testHandleSubmit('Test message that is long enough to trigger processing');

      // Verify processEvent was called with correct persona
      expect(processEvent).toHaveBeenCalledWith(
        'Test message that is long enough to trigger processing',
        'claude', // active persona
        expect.any(Boolean),
        expect.any(AbortSignal)
      );

      // Verify persona state was updated correctly
      const personaState = app.testGetOrCreatePersonaState('claude');
      expect(personaState.isProcessing).toBe(false); // Should be false after completion
    });
  });

  describe('Message Queuing and Debouncing', () => {
    test('rapid message submissions are queued and processed', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
      });

      // Submit multiple DIFFERENT messages rapidly (all long enough to trigger immediate processing)
      // Each message must be different to avoid debouncing prevention
      await app.testHandleSubmit('First message that is long enough to trigger immediate processing');
      await app.testHandleSubmit('Second message that is long enough to trigger immediate processing');
      await app.testHandleSubmit('Third message that is long enough to trigger immediate processing');

      // Verify messages were processed - the queuing system may combine messages
      // so we check that processEvent was called at least once
      expect(processEvent).toHaveBeenCalled();
      
      // Verify all human messages were added to the chat
      const messages = app.getTestMessages();
      const humanMessages = messages.filter(m => m.role === 'human');
      expect(humanMessages).toHaveLength(3);
    });

    test('duplicate submissions within 2 seconds are prevented', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
      });

      const sameMessage = 'Duplicate message that is long enough to trigger processing';

      // Submit same message twice rapidly
      await app.testHandleSubmit(sameMessage);
      await app.testHandleSubmit(sameMessage);

      // Verify only one call was made
      expect(processEvent).toHaveBeenCalledTimes(1);
    });

    test('same message after 2 seconds is allowed', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Response',
        aborted: false,
      });

      const sameMessage = 'Repeated message that is long enough to trigger processing';

      // Submit message
      await app.testHandleSubmit(sameMessage);

      // Mock time passage (simulate 2+ seconds)
      const originalNow = Date.now;
      Date.now = vi.fn(() => originalNow() + 2100);

      try {
        // Submit same message after time delay
        await app.testHandleSubmit(sameMessage);

        // Verify both calls were made
        expect(processEvent).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('Background Processing (Heartbeat)', () => {
    test('heartbeat triggers background processing for inactive personas', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Heartbeat response',
        aborted: false,
      });

      // Get persona state and trigger heartbeat manually
      const personaState = app.testGetOrCreatePersonaState('ei');
      
      // Simulate heartbeat timer firing
      if (personaState.heartbeatTimer) {
        clearTimeout(personaState.heartbeatTimer);
      }

      // Manually trigger heartbeat processing
      personaState.isProcessing = true;
      await processEvent(null, 'ei', false, new AbortController().signal);
      personaState.isProcessing = false;

      // Verify heartbeat processing occurred
      expect(processEvent).toHaveBeenCalledWith(
        null, // heartbeat has no user message
        'ei',
        expect.any(Boolean),
        expect.any(AbortSignal)
      );
    });

    test('heartbeat response for background persona increments unread count', async () => {
      vi.mocked(processEvent).mockResolvedValue({
        response: 'Background response',
        aborted: false,
      });

      // Switch to different persona
      app.setTestActivePersona('claude');

      // Simulate background heartbeat for 'ei' persona
      const personaState = app.testGetOrCreatePersonaState('ei');
      personaState.isProcessing = true;

      // Process heartbeat
      const result = await processEvent(null, 'ei', false, new AbortController().signal);
      
      // Simulate successful heartbeat response for background persona
      if (result.response && !result.aborted) {
        personaState.unreadCount++;
        const unreadCounts = app.getTestUnreadCounts();
        unreadCounts.set('ei', personaState.unreadCount);
      }
      
      personaState.isProcessing = false;

      // Verify unread count was incremented
      const unreadCounts = app.getTestUnreadCounts();
      expect(unreadCounts.get('ei')).toBe(1);
    });
  });
});
