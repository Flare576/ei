import { describe, test, expect, vi, beforeEach } from 'vitest';
import { generatePersonaDescriptions, createPersonaWithLLM } from '../../src/persona-creator.js';
import type { PersonaEntity, Trait, Topic } from '../../src/types.js';

interface PersonaDescriptions {
  short_description: string;
  long_description: string;
}

vi.mock('../../src/llm.js', () => ({
  callLLMForJSON: vi.fn()
}));

vi.mock('../../src/storage.js', () => ({
  createPersonaDirectory: vi.fn(),
  loadPersonaEntity: vi.fn(() => Promise.resolve({ 
    entity: 'system', 
    traits: [], 
    topics: [], 
    last_updated: null 
  })),
  setStateManager: vi.fn(),
  getDataPath: vi.fn(() => "/tmp/ei-test"),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn()
}));

import { callLLMForJSON } from '../../src/llm.js';

const createTestPersonaEntity = (personaName: string = 'test'): PersonaEntity => ({
  entity: 'system',
  last_updated: null,
  traits: [
    {
      name: 'Test Trait',
      description: 'A test trait',
      sentiment: 0.0,
      strength: 0.7,
      last_updated: new Date().toISOString()
    }
  ],
  topics: []
});

describe('Persona Creator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generatePersonaDescriptions', () => {
    test('returns persona descriptions from LLM', async () => {
      const mockDescriptions: PersonaDescriptions = {
        short_description: 'A helpful AI assistant',
        long_description: 'A thoughtful and engaging AI companion that helps with various tasks.'
      };

      vi.mocked(callLLMForJSON).mockResolvedValue(mockDescriptions);

      const personaEntity = createTestPersonaEntity('TestPersona');
      const result = await generatePersonaDescriptions('TestPersona', personaEntity);

      expect(result).toEqual(mockDescriptions);
      expect(callLLMForJSON).toHaveBeenCalledWith(
        expect.stringContaining('generating brief descriptions'),
        expect.stringContaining('TestPersona'),
        { signal: undefined, temperature: 0.5, model: undefined, operation: 'generation' }
      );
    });

    test('passes abort signal to LLM call', async () => {
      const controller = new AbortController();
      vi.mocked(callLLMForJSON).mockResolvedValue({
        short_description: 'test',
        long_description: 'test description'
      });

      const personaEntity = createTestPersonaEntity();
      await generatePersonaDescriptions('test', personaEntity, controller.signal);

      expect(callLLMForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { signal: controller.signal, temperature: 0.5, model: undefined, operation: 'generation' }
      );
    });

    test('returns null on LLM error', async () => {
      vi.mocked(callLLMForJSON).mockRejectedValue(new Error('LLM failed'));

      const personaEntity = createTestPersonaEntity();
      const result = await generatePersonaDescriptions('test', personaEntity);

      expect(result).toBeNull();
    });

    test('returns null when LLM returns null', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue(null);

      const personaEntity = createTestPersonaEntity();
      const result = await generatePersonaDescriptions('test', personaEntity);

      expect(result).toBeNull();
    });

    test('validates description format', async () => {
      const mockDescriptions = {
        short_description: 'Brief description under 15 words',
        long_description: 'A longer description that provides more context about the persona and their characteristics.'
      };

      vi.mocked(callLLMForJSON).mockResolvedValue(mockDescriptions);

      const personaEntity = createTestPersonaEntity();
      const result = await generatePersonaDescriptions('test', personaEntity);

      expect(result?.short_description).toBeTruthy();
      expect(result?.long_description).toBeTruthy();
      const wordCount = result?.short_description.split(' ').length ?? 0;
      expect(wordCount).toBeLessThan(20);
      if (result) {
        expect(result.long_description.length).toBeGreaterThan(result.short_description.length);
      }
    });
  });

  describe('createPersonaWithLLM', () => {
    test('creates persona with traits and topics', async () => {
      const mockGenerationResult = {
        aliases: ['helper', 'assistant'],
        traits: [{
          name: 'Helpfulness',
          description: 'Desire to be helpful',
          sentiment: 0.0,
          strength: 0.8,
          last_updated: new Date().toISOString()
        }],
        topics: [{
          name: 'Task Management',
          description: 'Organizing and completing tasks',
          level_current: 0.5,
          level_ideal: 0.7,
          sentiment: 0.6,
          last_updated: new Date().toISOString()
        }]
      };

      const mockDescriptions: PersonaDescriptions = {
        short_description: 'A helpful assistant',
        long_description: 'A thoughtful AI that helps with tasks'
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(mockDescriptions);

      const result = await createPersonaWithLLM('Helper', 'A helpful AI assistant');

      expect(result.entity).toBe('system');
      expect(result.aliases).toEqual(['helper', 'assistant']);
      expect(result.short_description).toBe('A helpful assistant');
      expect(result.long_description).toBe('A thoughtful AI that helps with tasks');
      
      expect(result.traits.length).toBeGreaterThanOrEqual(2);
      const helpfulnessTrait = result.traits.find(t => t.name === 'Helpfulness');
      expect(helpfulnessTrait).toBeDefined();
      
      const identityTrait = result.traits.find(t => t.name === 'Consistent Character');
      expect(identityTrait).toBeDefined();
      expect(identityTrait?.strength).toBe(0.8);
      
      expect(result.topics).toHaveLength(1);
      expect(result.topics[0].name).toBe('Task Management');
    });

    test('adds growth trait when description mentions growth', async () => {
      const mockGenerationResult = {
        aliases: ['coach'],
        traits: [],
        topics: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null);

      const result = await createPersonaWithLLM('Coach', 'A persona to help me grow and improve');

      expect(result.traits.length).toBe(2);
      const growthTrait = result.traits.find(t => t.name === 'Growth-Oriented');
      expect(growthTrait).toBeDefined();
      expect(growthTrait?.strength).toBe(0.7);
    });

    test('handles minimal persona creation with no description', async () => {
      const mockGenerationResult = {
        aliases: ['basic'],
        traits: [],
        topics: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null);

      const result = await createPersonaWithLLM('Basic', '');

      expect(result.entity).toBe('system');
      expect(result.aliases).toEqual(['basic']);
      expect(result.traits).toHaveLength(1);
      expect(result.traits[0].name).toBe('Consistent Character');
      expect(result.topics).toHaveLength(0);
      expect(result.short_description).toBeUndefined();
      expect(result.long_description).toBeUndefined();
    });

    test('handles LLM failure gracefully', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue(null);

      const result = await createPersonaWithLLM('Failed', 'test description');

      expect(result.entity).toBe('system');
      expect(result.traits).toHaveLength(1);
      expect(result.traits[0].name).toBe('Consistent Character');
      expect(result.aliases).toEqual([]);
    });

    test('uses appropriate temperature for persona generation', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue({
        aliases: [],
        traits: [],
        topics: []
      });

      await createPersonaWithLLM('Test', 'test description');

      expect(callLLMForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Create a persona based on this description'),
        { temperature: 0.3, operation: 'generation' }
      );
    });

    test('always includes identity coherence seed trait', async () => {
      const mockGenerationResult = {
        aliases: [],
        traits: [{
          name: 'Custom Trait',
          description: 'A custom trait',
          sentiment: 0.0,
          strength: 0.5,
          last_updated: new Date().toISOString()
        }],
        topics: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null);

      const result = await createPersonaWithLLM('Complete', 'test');

      const identityTrait = result.traits.find(t => t.name === 'Consistent Character');
      expect(identityTrait).toBeDefined();
      expect(identityTrait?.description).toContain('Maintains personality consistency');
    });
  });

  describe('generatePersonaDescriptions', () => {
    test('returns locked descriptions for ei persona', async () => {
      const eiEntity = createTestPersonaEntity('ei');
      
      const result = await generatePersonaDescriptions('ei', eiEntity);
      
      expect(result).toBeDefined();
      expect(result?.short_description).toBe("Your guide to the EI persona system - warm, direct, and always looking out for you");
      expect(result?.long_description).toContain("orchestrator of your personal AI companion system");
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('generates descriptions for non-ei personas', async () => {
      const testEntity = createTestPersonaEntity('helper');
      vi.mocked(callLLMForJSON).mockResolvedValue({
        short_description: 'A helpful companion',
        long_description: 'A helpful AI companion who assists with tasks.'
      });

      const result = await generatePersonaDescriptions('helper', testEntity);

      expect(result).toBeDefined();
      expect(result?.short_description).toBe('A helpful companion');
      expect(callLLMForJSON).toHaveBeenCalled();
    });
  });
});
