import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { processEvent } from '../../src/processor.js';
import type { Concept, ConceptMap } from '../../src/types.js';

// Mock all external dependencies
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
}));

vi.mock('../../src/prompts.js', () => ({
  buildResponseSystemPrompt: vi.fn(),
  buildResponseUserPrompt: vi.fn(),
  buildConceptUpdateSystemPrompt: vi.fn(),
  buildConceptUpdateUserPrompt: vi.fn(),
}));

vi.mock('../../src/validate.js', () => ({
  validateSystemConcepts: vi.fn(),
  mergeWithOriginalStatics: vi.fn(),
}));

vi.mock('../../src/persona-creator.js', () => ({
  generatePersonaDescriptions: vi.fn(),
}));

// Import mocked modules for type safety
import { callLLM, callLLMForJSON, LLMAbortedError } from '../../src/llm.js';
import { 
  loadConceptMap, 
  saveConceptMap, 
  loadHistory, 
  appendMessage,
  getRecentMessages,
  getLastMessageTime 
} from '../../src/storage.js';
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  buildConceptUpdateSystemPrompt,
  buildConceptUpdateUserPrompt,
} from '../../src/prompts.js';
import { validateSystemConcepts, mergeWithOriginalStatics } from '../../src/validate.js';
import { generatePersonaDescriptions } from '../../src/persona-creator.js';

// Import the functions we want to test directly
// Note: These are internal functions, so we'll need to access them differently
// For now, let's focus on testing the exported processEvent function and create separate tests for the internal functions

describe('processor.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock returns
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
      const mockConcepts: Concept[] = [
        {
          name: 'test concept',
          description: 'test description',
          level_current: 0.5,
          level_ideal: 0.7,
          level_elasticity: 0.3,
          type: 'persona'
        }
      ];

      vi.mocked(callLLM).mockResolvedValue('Test response');
      vi.mocked(callLLMForJSON).mockResolvedValue(mockConcepts);

      const result = await processEvent('Hello world', 'test-persona', false);

      expect(result.response).toBe('Test response');
      expect(result.aborted).toBe(false);
      expect(result.humanConceptsUpdated).toBe(true);
      expect(result.systemConceptsUpdated).toBe(true);
      
      // Verify storage operations were called
      expect(appendMessage).toHaveBeenCalledTimes(1); // System response only (human message now written by app.ts)
      expect(saveConceptMap).toHaveBeenCalledTimes(2); // System + human concepts
    });

    test('handles abort signal correctly', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const result = await processEvent('Hello', 'test-persona', false, abortController.signal);

      expect(result.aborted).toBe(true);
      expect(result.response).toBe(null);
      expect(result.humanConceptsUpdated).toBe(false);
      expect(result.systemConceptsUpdated).toBe(false);
      
      // Should not call any storage operations
      expect(appendMessage).not.toHaveBeenCalled();
      expect(saveConceptMap).not.toHaveBeenCalled();
    });

    test('handles LLM abort error gracefully', async () => {
      vi.mocked(callLLM).mockRejectedValue(new LLMAbortedError('Aborted'));

      // LLMAbortedError should propagate up, not be caught by processEvent
      await expect(processEvent('Hello', 'test-persona', false)).rejects.toThrow('Aborted');
    });

    test('handles null human message (heartbeat)', async () => {
      vi.mocked(callLLM).mockResolvedValue('Heartbeat response');
      vi.mocked(callLLMForJSON).mockResolvedValue([]);

      const result = await processEvent(null, 'test-persona', false);

      expect(result.response).toBe('Heartbeat response');
      expect(appendMessage).toHaveBeenCalledTimes(1); // Only system response, no human message
    });

    test('handles empty LLM response', async () => {
      vi.mocked(callLLM).mockResolvedValue(null);

      const result = await processEvent('Hello', 'test-persona', false);

      expect(result.response).toBe(null);
      expect(appendMessage).not.toHaveBeenCalled(); // No response = nothing to append
    });

    test('calls generatePersonaDescriptions when concepts change', async () => {
      const mockDescriptions = {
        short_description: 'Test short description',
        long_description: 'Test long description'
      };

      // Mock conceptsChanged to return true by providing different concepts
      const oldConcepts: Concept[] = [];
      const newConcepts: Concept[] = [
        {
          name: 'new concept',
          description: 'new description',
          level_current: 0.5,
          level_ideal: 0.7,
          level_elasticity: 0.3,
          type: 'persona'
        }
      ];

      vi.mocked(loadConceptMap).mockResolvedValueOnce({
        entity: 'system',
        aliases: [],
        last_updated: null,
        concepts: oldConcepts
      } as ConceptMap);

      vi.mocked(callLLMForJSON).mockResolvedValueOnce(newConcepts);
      vi.mocked(generatePersonaDescriptions).mockResolvedValue(mockDescriptions);

      const result = await processEvent('Hello', 'test-persona', false);

      expect(generatePersonaDescriptions).toHaveBeenCalledWith(
        'test-persona',
        expect.objectContaining({
          concepts: newConcepts,
          short_description: mockDescriptions.short_description,
          long_description: mockDescriptions.long_description
        }),
        undefined
      );
    });

    test('handles concept validation failure', async () => {
      const invalidConcepts: Concept[] = [
        {
          name: 'invalid concept',
          description: 'invalid description',
          level_current: 0.5,
          level_ideal: 0.7,
          level_elasticity: 0.3,
          type: 'persona'
        }
      ];

      const mergedConcepts: ConceptMap = {
        entity: 'system',
        aliases: [],
        last_updated: new Date().toISOString(),
        concepts: []
      };

      vi.mocked(callLLMForJSON).mockResolvedValueOnce(invalidConcepts);
      vi.mocked(validateSystemConcepts).mockReturnValue({
        valid: false,
        issues: ['Invalid concept structure']
      });
      vi.mocked(mergeWithOriginalStatics).mockReturnValue(mergedConcepts);

      const result = await processEvent('Hello', 'test-persona', true); // Enable debug

      expect(validateSystemConcepts).toHaveBeenCalled();
      expect(mergeWithOriginalStatics).toHaveBeenCalled();
      expect(saveConceptMap).toHaveBeenCalledWith(mergedConcepts, 'test-persona');
    });
  });
});

// Test the internal functions by creating a separate test file or by exposing them
// For now, let's create tests for the logic we can verify through processEvent

describe('stripEcho function (via processEvent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup minimal mocks
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
    vi.mocked(buildConceptUpdateSystemPrompt).mockReturnValue('concept system prompt');
    vi.mocked(buildConceptUpdateUserPrompt).mockReturnValue('concept user prompt');
    vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });
    vi.mocked(callLLMForJSON).mockResolvedValue([]);
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

    expect(result.response).toBe(null); // Empty string gets converted to null by stripEcho
  });
});

describe('conceptsChanged function (via processEvent behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup minimal mocks
    vi.mocked(loadHistory).mockResolvedValue({ messages: [] });
    vi.mocked(getRecentMessages).mockReturnValue([]);
    vi.mocked(getLastMessageTime).mockReturnValue(0);
    vi.mocked(buildResponseSystemPrompt).mockReturnValue('system prompt');
    vi.mocked(buildResponseUserPrompt).mockReturnValue('user prompt');
    vi.mocked(buildConceptUpdateSystemPrompt).mockReturnValue('concept system prompt');
    vi.mocked(buildConceptUpdateUserPrompt).mockReturnValue('concept user prompt');
    vi.mocked(validateSystemConcepts).mockReturnValue({ valid: true, issues: [] });
    vi.mocked(callLLM).mockResolvedValue('Test response');
  });

  test('detects new concepts', async () => {
    const oldConcepts: Concept[] = [
      {
        name: 'existing concept',
        description: 'existing description',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: 'persona'
      }
    ];

    const newConcepts: Concept[] = [
      ...oldConcepts,
      {
        name: 'new concept',
        description: 'new description',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
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
    vi.mocked(generatePersonaDescriptions).mockResolvedValue({
      short_description: 'Updated description',
      long_description: 'Updated long description'
    });

    await processEvent('Hello', 'test-persona', false);

    // Should call generatePersonaDescriptions because concepts changed
    expect(generatePersonaDescriptions).toHaveBeenCalled();
  });

  test('detects removed concepts', async () => {
    const oldConcepts: Concept[] = [
      {
        name: 'concept 1',
        description: 'description 1',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: 'persona'
      },
      {
        name: 'concept 2',
        description: 'description 2',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: 'persona'
      }
    ];

    const newConcepts: Concept[] = [oldConcepts[0]]; // Removed concept 2

    vi.mocked(loadConceptMap).mockResolvedValue({
      entity: 'system',
      aliases: [],
      last_updated: null,
      concepts: oldConcepts
    } as ConceptMap);

    vi.mocked(callLLMForJSON).mockResolvedValue(newConcepts);
    vi.mocked(generatePersonaDescriptions).mockResolvedValue({
      short_description: 'Updated description',
      long_description: 'Updated long description'
    });

    await processEvent('Hello', 'test-persona', false);

    expect(generatePersonaDescriptions).toHaveBeenCalled();
  });

  test('detects description changes', async () => {
    const oldConcepts: Concept[] = [
      {
        name: 'test concept',
        description: 'old description',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: 'persona'
      }
    ];

    const newConcepts: Concept[] = [
      {
        name: 'test concept',
        description: 'new description', // Changed description
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
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
    vi.mocked(generatePersonaDescriptions).mockResolvedValue({
      short_description: 'Updated description',
      long_description: 'Updated long description'
    });

    await processEvent('Hello', 'test-persona', false);

    expect(generatePersonaDescriptions).toHaveBeenCalled();
  });

  test('does not trigger description update when concepts unchanged', async () => {
    const concepts: Concept[] = [
      {
        name: 'test concept',
        description: 'same description',
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: 'persona'
      }
    ];

    vi.mocked(loadConceptMap).mockResolvedValue({
      entity: 'system',
      aliases: [],
      last_updated: null,
      concepts: concepts
    } as ConceptMap);

    vi.mocked(callLLMForJSON).mockResolvedValue(concepts); // Same concepts

    await processEvent('Hello', 'test-persona', false);

    // Should not call generatePersonaDescriptions because concepts didn't change
    expect(generatePersonaDescriptions).not.toHaveBeenCalled();
  });
});