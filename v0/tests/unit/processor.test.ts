import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { processEvent } from '../../src/processor.js';
import type { HumanEntity, PersonaEntity } from '../../src/types.js';

vi.mock('../../src/llm.js', () => ({
  callLLMWithHistory: vi.fn(),
  LLMAbortedError: class extends Error { 
    name = 'LLMAbortedError';
    constructor(message: string) {
      super(message);
      this.name = 'LLMAbortedError';
    }
  },
  LLMTruncatedError: class extends Error {
    name = 'LLMTruncatedError';
    constructor(message: string) {
      super(message);
      this.name = 'LLMTruncatedError';
    }
  }
}));

vi.mock('../../src/storage.js', () => ({
  loadHumanEntity: vi.fn(),
  loadPersonaEntity: vi.fn(),
  loadHistory: vi.fn(),
  appendMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  getLastMessageTime: vi.fn(),
  appendDebugLog: vi.fn(),
  markMessagesAsRead: vi.fn(),
  loadAllPersonasWithEntities: vi.fn(),
  setStateManager: vi.fn(),
  getDataPath: vi.fn(() => "/tmp/ei-test"),
}));

vi.mock('../../src/prompts/index.js', () => ({
  buildResponseSystemPrompt: vi.fn(),
  buildResponseUserPrompt: vi.fn(),
  getVisiblePersonas: vi.fn(),
}));

vi.mock('../../src/extraction-frequency.js', () => ({
  triggerExtraction: vi.fn().mockResolvedValue(undefined),
}));

import { callLLMWithHistory, LLMAbortedError } from '../../src/llm.js';
import { 
  loadHumanEntity,
  loadPersonaEntity,
  loadHistory, 
  appendMessage,
  getRecentMessages,
  getLastMessageTime,
  loadAllPersonasWithEntities,
} from '../../src/storage.js';
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  getVisiblePersonas,
} from '../../src/prompts/index.js';
import { triggerExtraction } from '../../src/extraction-frequency.js';

describe('processor.ts', () => {
  const mockHumanEntity: HumanEntity = {
    entity: 'human',
    facts: [],
    traits: [],
    topics: [],
    people: [],
    last_updated: null,
  };

  const mockPersonaEntity: PersonaEntity = {
    entity: 'system',
    aliases: [],
    traits: [],
    topics: [],
    last_updated: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(loadHumanEntity).mockResolvedValue(mockHumanEntity);
    vi.mocked(loadPersonaEntity).mockResolvedValue(mockPersonaEntity);
    vi.mocked(loadHistory).mockResolvedValue({ messages: [] });
    vi.mocked(getRecentMessages).mockReturnValue([]);
    vi.mocked(getLastMessageTime).mockReturnValue(0);
    vi.mocked(loadAllPersonasWithEntities).mockResolvedValue([]);
    vi.mocked(getVisiblePersonas).mockReturnValue([]);
    vi.mocked(buildResponseSystemPrompt).mockResolvedValue('system prompt');
    vi.mocked(buildResponseUserPrompt).mockReturnValue('user prompt');
    vi.mocked(callLLMWithHistory).mockResolvedValue('LLM response');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processEvent', () => {
    test('handles successful message processing', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue('Test response');

      const result = await processEvent('Hello world', 'test-persona', false);

      expect(result.response).toBe('Test response');
      expect(result.aborted).toBe(false);
      
      expect(appendMessage).toHaveBeenCalledTimes(1);
      expect(triggerExtraction).toHaveBeenCalledTimes(2);
    });

    test('only calls callLLMWithHistory once for response generation', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue('Test response');

      await processEvent('Hello world', 'test-persona', false);

      expect(callLLMWithHistory).toHaveBeenCalledTimes(1);
    });

    test('handles abort signal correctly', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await processEvent('Hello', 'test-persona', false, abortController.signal);

      expect(result.aborted).toBe(true);
      expect(result.response).toBe(null);
      
      expect(appendMessage).not.toHaveBeenCalled();
    });

    test('handles LLM abort error gracefully', async () => {
      vi.mocked(callLLMWithHistory).mockRejectedValue(new LLMAbortedError());

      await expect(processEvent('Hello', 'test-persona', false)).rejects.toThrow(LLMAbortedError);
    });

    test('handles null human message (heartbeat)', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue('Heartbeat response');

      const result = await processEvent(null, 'test-persona', false);

      expect(result.response).toBe('Heartbeat response');
      expect(appendMessage).toHaveBeenCalledTimes(1);
    });

    test('handles empty LLM response', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue(null);

      const result = await processEvent('Hello', 'test-persona', false);

      expect(result.response).toBe(null);
      expect(appendMessage).not.toHaveBeenCalled();
    });

    test('triggers extraction for both human and persona', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue('Test response');

      await processEvent('Hello', 'test-persona', false);

      expect(triggerExtraction).toHaveBeenCalledTimes(2);
      expect(triggerExtraction).toHaveBeenCalledWith('human', 'test-persona', expect.anything());
      expect(triggerExtraction).toHaveBeenCalledWith('system', 'test-persona', expect.anything());
    });

    test('does not trigger extraction when no response', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue(null);

      await processEvent('Hello', 'test-persona', false);

      expect(triggerExtraction).not.toHaveBeenCalled();
    });

    test('does not trigger extraction when no human message', async () => {
      vi.mocked(callLLMWithHistory).mockResolvedValue('Response');

      await processEvent(null, 'test-persona', false);

      expect(triggerExtraction).not.toHaveBeenCalled();
    });
  });
});

describe('stripEcho function (via processEvent)', () => {
  const mockHumanEntity: HumanEntity = {
    entity: 'human',
    facts: [],
    traits: [],
    topics: [],
    people: [],
    last_updated: null,
  };

  const mockPersonaEntity: PersonaEntity = {
    entity: 'system',
    aliases: [],
    traits: [],
    topics: [],
    last_updated: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(loadHumanEntity).mockResolvedValue(mockHumanEntity);
    vi.mocked(loadPersonaEntity).mockResolvedValue(mockPersonaEntity);
    vi.mocked(loadHistory).mockResolvedValue({ messages: [] });
    vi.mocked(getRecentMessages).mockReturnValue([]);
    vi.mocked(getLastMessageTime).mockReturnValue(0);
    vi.mocked(loadAllPersonasWithEntities).mockResolvedValue([]);
    vi.mocked(getVisiblePersonas).mockReturnValue([]);
    vi.mocked(buildResponseSystemPrompt).mockResolvedValue('system prompt');
    vi.mocked(buildResponseUserPrompt).mockReturnValue('user prompt');
  });

  test('strips exact prefix echo', async () => {
    const userMessage = 'Hello world';
    const echoedResponse = 'Hello world\n\nThis is my actual response.';
    
    vi.mocked(callLLMWithHistory).mockResolvedValue(echoedResponse);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe('This is my actual response.');
  });

  test('strips first line echo', async () => {
    const userMessage = 'Hello';
    const echoedResponse = 'Hello\nThis is my response.';
    
    vi.mocked(callLLMWithHistory).mockResolvedValue(echoedResponse);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe('This is my response.');
  });

  test('preserves intentional quotes', async () => {
    const userMessage = 'Hello';
    const responseWithQuote = 'You said "Hello" and I think that\'s nice.';
    
    vi.mocked(callLLMWithHistory).mockResolvedValue(responseWithQuote);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe(responseWithQuote);
  });

  test('handles null user message safely', async () => {
    const response = 'This is a heartbeat response.';
    
    vi.mocked(callLLMWithHistory).mockResolvedValue(response);

    const result = await processEvent(null, 'test-persona', false);

    expect(result.response).toBe(response);
  });

  test('handles empty response safely', async () => {
    vi.mocked(callLLMWithHistory).mockResolvedValue('');

    const result = await processEvent('Hello', 'test-persona', false);

    expect(result.response).toBe(null);
  });
});
