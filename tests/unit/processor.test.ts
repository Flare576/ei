import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { processEvent, updateConceptsForMessages } from '../../src/processor.js';
import type { Concept, ConceptMap, Message } from '../../src/types.js';

vi.mock('../../src/llm.js', () => ({
  callLLM: vi.fn(),
  callLLMForJSON: vi.fn(),
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
  loadConceptMap: vi.fn(),
  saveConceptMap: vi.fn(),
  loadHistory: vi.fn(),
  appendMessage: vi.fn(),
  getRecentMessages: vi.fn(),
  getLastMessageTime: vi.fn(),
  appendDebugLog: vi.fn(),
  markMessagesAsRead: vi.fn(),
  loadAllPersonasWithConceptMaps: vi.fn(),
}));

vi.mock('../../src/prompts.js', () => ({
  buildResponseSystemPrompt: vi.fn(),
  buildResponseUserPrompt: vi.fn(),
  buildConceptUpdateSystemPrompt: vi.fn(),
  buildConceptUpdateUserPrompt: vi.fn(),
  getVisiblePersonas: vi.fn(),
}));

vi.mock('../../src/validate.js', () => ({
  validateSystemConcepts: vi.fn(),
  mergeWithOriginalStatics: vi.fn(),
}));

vi.mock('../../src/persona-creator.js', () => ({
  generatePersonaDescriptions: vi.fn(),
}));

import { callLLM, callLLMForJSON, LLMAbortedError } from '../../src/llm.js';
import { 
  loadConceptMap, 
  saveConceptMap, 
  loadHistory, 
  appendMessage,
  getRecentMessages,
  getLastMessageTime,
  loadAllPersonasWithConceptMaps,
} from '../../src/storage.js';
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  buildConceptUpdateSystemPrompt,
  buildConceptUpdateUserPrompt,
  getVisiblePersonas,
} from '../../src/prompts.js';
import { validateSystemConcepts, mergeWithOriginalStatics } from '../../src/validate.js';
import { generatePersonaDescriptions } from '../../src/persona-creator.js';

describe('processor.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(loadConceptMap).mockResolvedValue({
      entity: 'system',
      aliases: [],
      last_updated: null,
      concepts: []
    } as ConceptMap);
    
    vi.mocked(loadHistory).mockResolvedValue({ messages: [] });
    vi.mocked(getRecentMessages).mockReturnValue([]);
    vi.mocked(getLastMessageTime).mockReturnValue(0);
    vi.mocked(loadAllPersonasWithConceptMaps).mockResolvedValue([]);
    vi.mocked(getVisiblePersonas).mockReturnValue([]);
    vi.mocked(buildResponseSystemPrompt).mockReturnValue('system prompt');
    vi.mocked(buildResponseUserPrompt).mockReturnValue('user prompt');
    vi.mocked(buildConceptUpdateSystemPrompt).mockReturnValue('concept system prompt');
    vi.mocked(buildConceptUpdateUserPrompt).mockReturnValue('concept user prompt');
    vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });
    vi.mocked(callLLM).mockResolvedValue('LLM response');
    vi.mocked(callLLMForJSON).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processEvent', () => {
    test('handles successful message processing', async () => {
      vi.mocked(callLLM).mockResolvedValue('Test response');

      const result = await processEvent('Hello world', 'test-persona', false);

      expect(result.response).toBe('Test response');
      expect(result.aborted).toBe(false);
      expect(result.humanConceptsUpdated).toBe(false);
      expect(result.systemConceptsUpdated).toBe(false);
      
      expect(appendMessage).toHaveBeenCalledTimes(1);
      expect(saveConceptMap).not.toHaveBeenCalled();
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('only calls callLLM once for response generation', async () => {
      vi.mocked(callLLM).mockResolvedValue('Test response');

      await processEvent('Hello world', 'test-persona', false);

      expect(callLLM).toHaveBeenCalledTimes(1);
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('handles abort signal correctly', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await processEvent('Hello', 'test-persona', false, abortController.signal);

      expect(result.aborted).toBe(true);
      expect(result.response).toBe(null);
      expect(result.humanConceptsUpdated).toBe(false);
      expect(result.systemConceptsUpdated).toBe(false);
      
      expect(appendMessage).not.toHaveBeenCalled();
      expect(saveConceptMap).not.toHaveBeenCalled();
    });

    test('handles LLM abort error gracefully', async () => {
      vi.mocked(callLLM).mockRejectedValue(new LLMAbortedError());

      await expect(processEvent('Hello', 'test-persona', false)).rejects.toThrow(LLMAbortedError);
    });

    test('handles null human message (heartbeat)', async () => {
      vi.mocked(callLLM).mockResolvedValue('Heartbeat response');

      const result = await processEvent(null, 'test-persona', false);

      expect(result.response).toBe('Heartbeat response');
      expect(appendMessage).toHaveBeenCalledTimes(1);
    });

    test('handles empty LLM response', async () => {
      vi.mocked(callLLM).mockResolvedValue(null);

      const result = await processEvent('Hello', 'test-persona', false);

      expect(result.response).toBe(null);
      expect(appendMessage).not.toHaveBeenCalled();
    });

    test('does not call concept update functions', async () => {
      vi.mocked(callLLM).mockResolvedValue('Test response');

      await processEvent('Hello', 'test-persona', false);

      expect(callLLMForJSON).not.toHaveBeenCalled();
      expect(generatePersonaDescriptions).not.toHaveBeenCalled();
      expect(saveConceptMap).not.toHaveBeenCalled();
    });
  });

  describe('updateConceptsForMessages', () => {
    const mockMessages: Message[] = [
      {
        role: 'human',
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
        read: true,
        concept_processed: false
      },
      {
        role: 'system',
        content: 'Hi there!',
        timestamp: '2024-01-01T00:00:01Z',
        read: true,
        concept_processed: false
      }
    ];

    test('returns false for empty messages array', async () => {
      const result = await updateConceptsForMessages([], 'system', 'test-persona');
      
      expect(result).toBe(false);
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('updates system concepts successfully', async () => {
      const newConcepts: Concept[] = [
        {
          name: 'test concept',
          description: 'test description',
          level_current: 0.5,
          level_ideal: 0.7,
          sentiment: 0.0,
          type: 'persona'
        }
      ];

      vi.mocked(callLLMForJSON).mockResolvedValue(newConcepts);
      vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });

      const result = await updateConceptsForMessages(mockMessages, 'system', 'test-persona');

      expect(result).toBe(true);
      expect(callLLMForJSON).toHaveBeenCalledTimes(1);
      expect(saveConceptMap).toHaveBeenCalledTimes(1);
      expect(saveConceptMap).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'system' }),
        'test-persona'
      );
    });

    test('updates human concepts successfully', async () => {
      const newConcepts: Concept[] = [
        {
          name: 'human trait',
          description: 'a human trait',
          level_current: 0.5,
          level_ideal: 0.5,
          sentiment: 0.0,
          type: 'topic'
        }
      ];

      vi.mocked(callLLMForJSON).mockResolvedValue(newConcepts);

      const result = await updateConceptsForMessages(mockMessages, 'human', 'test-persona');

      expect(result).toBe(true);
      expect(callLLMForJSON).toHaveBeenCalledTimes(1);
      expect(saveConceptMap).toHaveBeenCalledTimes(1);
      expect(saveConceptMap).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'human' })
      );
    });

    test('returns false when LLM returns null', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue(null);

      const result = await updateConceptsForMessages(mockMessages, 'system', 'test-persona');

      expect(result).toBe(false);
      expect(saveConceptMap).not.toHaveBeenCalled();
    });

    test('handles abort signal', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await updateConceptsForMessages(
        mockMessages,
        'system',
        'test-persona',
        false,
        abortController.signal
      );

      expect(result).toBe(false);
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('handles concept validation failure for system concepts', async () => {
      const invalidConcepts: Concept[] = [
        {
          name: 'invalid concept',
          description: 'invalid description',
          level_current: 0.5,
          level_ideal: 0.7,
          sentiment: 0.0,
          type: 'persona'
        }
      ];

      const mergedMap: ConceptMap = {
        entity: 'system',
        aliases: [],
        last_updated: new Date().toISOString(),
        concepts: []
      };

      vi.mocked(callLLMForJSON).mockResolvedValue(invalidConcepts);
      vi.mocked(validateSystemConcepts).mockReturnValue({
        valid: false,
        issues: ['Invalid concept structure']
      });
      vi.mocked(mergeWithOriginalStatics).mockReturnValue(mergedMap);

      const result = await updateConceptsForMessages(mockMessages, 'system', 'test-persona', true);

      expect(result).toBe(true);
      expect(validateSystemConcepts).toHaveBeenCalled();
      expect(mergeWithOriginalStatics).toHaveBeenCalled();
      expect(saveConceptMap).toHaveBeenCalledWith(mergedMap, 'test-persona');
    });

    test('regenerates descriptions when concepts change', async () => {
      const oldConcepts: Concept[] = [];
      const newConcepts: Concept[] = [
        {
          name: 'new concept',
          description: 'new description',
          level_current: 0.5,
          level_ideal: 0.7,
          sentiment: 0.0,
          type: 'persona'
        }
      ];

      vi.mocked(loadConceptMap).mockResolvedValue({
        entity: 'system',
        aliases: [],
        last_updated: null,
        concepts: oldConcepts
      } as ConceptMap);

      vi.mocked(callLLMForJSON).mockResolvedValue(newConcepts);
      vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });
      vi.mocked(generatePersonaDescriptions).mockResolvedValue({
        short_description: 'Updated short',
        long_description: 'Updated long'
      });

      const result = await updateConceptsForMessages(mockMessages, 'system', 'test-persona');

      expect(result).toBe(true);
      expect(generatePersonaDescriptions).toHaveBeenCalled();
      expect(saveConceptMap).toHaveBeenCalledWith(
        expect.objectContaining({
          short_description: 'Updated short',
          long_description: 'Updated long'
        }),
        'test-persona'
      );
    });

    test('does not regenerate descriptions when concepts unchanged', async () => {
      const concepts: Concept[] = [
        {
          name: 'test concept',
          description: 'same description',
          level_current: 0.5,
          level_ideal: 0.7,
          sentiment: 0.0,
          type: 'persona'
        }
      ];

      vi.mocked(loadConceptMap).mockResolvedValue({
        entity: 'system',
        aliases: [],
        last_updated: null,
        concepts: concepts
      } as ConceptMap);

      vi.mocked(callLLMForJSON).mockResolvedValue(concepts);
      vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });

      await updateConceptsForMessages(mockMessages, 'system', 'test-persona');

      expect(generatePersonaDescriptions).not.toHaveBeenCalled();
    });

    test('builds combined content from messages', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue([]);

      await updateConceptsForMessages(mockMessages, 'system', 'test-persona');

      expect(buildConceptUpdateUserPrompt).toHaveBeenCalledWith(
        '[human]: Hello\n\n[system]: Hi there!',
        null,
        'test-persona'
      );
    });
  });
});

describe('stripEcho function (via processEvent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(loadConceptMap).mockResolvedValue({
      entity: 'system',
      aliases: [],
      last_updated: null,
      concepts: []
    } as ConceptMap);
    
    vi.mocked(loadHistory).mockResolvedValue({ messages: [] });
    vi.mocked(getRecentMessages).mockReturnValue([]);
    vi.mocked(getLastMessageTime).mockReturnValue(0);
    vi.mocked(buildResponseSystemPrompt).mockReturnValue('system prompt');
    vi.mocked(buildResponseUserPrompt).mockReturnValue('user prompt');
  });

  test('strips exact prefix echo', async () => {
    const userMessage = 'Hello world';
    const echoedResponse = 'Hello world\n\nThis is my actual response.';
    
    vi.mocked(callLLM).mockResolvedValue(echoedResponse);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe('This is my actual response.');
  });

  test('strips first line echo', async () => {
    const userMessage = 'Hello';
    const echoedResponse = 'Hello\nThis is my response.';
    
    vi.mocked(callLLM).mockResolvedValue(echoedResponse);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe('This is my response.');
  });

  test('preserves intentional quotes', async () => {
    const userMessage = 'Hello';
    const responseWithQuote = 'You said "Hello" and I think that\'s nice.';
    
    vi.mocked(callLLM).mockResolvedValue(responseWithQuote);

    const result = await processEvent(userMessage, 'test-persona', false);

    expect(result.response).toBe(responseWithQuote);
  });

  test('handles null user message safely', async () => {
    const response = 'This is a heartbeat response.';
    
    vi.mocked(callLLM).mockResolvedValue(response);

    const result = await processEvent(null, 'test-persona', false);

    expect(result.response).toBe(response);
  });

  test('handles empty response safely', async () => {
    vi.mocked(callLLM).mockResolvedValue('');

    const result = await processEvent('Hello', 'test-persona', false);

    expect(result.response).toBe(null);
  });
});
