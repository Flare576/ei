import { describe, test, expect, vi, beforeEach } from 'vitest';
import { generatePersonaDescriptions, createPersonaWithLLM } from '../../src/persona-creator.js';
import type { ConceptMap, Concept } from '../../src/types.js';
import type { PersonaDescriptions } from '../../src/prompts.js';

// Mock dependencies
vi.mock('../../src/llm.js', () => ({
  callLLMForJSON: vi.fn()
}));

vi.mock('../../src/prompts.js', () => ({
  buildDescriptionPrompt: vi.fn()
}));

vi.mock('../../src/storage.js', () => ({
  createPersonaDirectory: vi.fn()
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn()
}));

import { callLLMForJSON } from '../../src/llm.js';
import { buildDescriptionPrompt } from '../../src/prompts.js';

const createTestConceptMap = (personaName: string = 'test'): ConceptMap => ({
  entity: 'system',
  last_updated: null,
  concepts: [
    {
      name: 'Test Concept',
      description: 'A test concept',
      level_current: 0.5,
      level_ideal: 0.7,
      sentiment: 0.0,
      type: 'persona'
    }
  ]
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

      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'system prompt',
        user: 'user prompt'
      });
      vi.mocked(callLLMForJSON).mockResolvedValue(mockDescriptions);

      const conceptMap = createTestConceptMap('TestPersona');
      const result = await generatePersonaDescriptions('TestPersona', conceptMap);

      expect(result).toEqual(mockDescriptions);
      expect(buildDescriptionPrompt).toHaveBeenCalledWith('TestPersona', conceptMap);
      expect(callLLMForJSON).toHaveBeenCalledWith(
        'system prompt',
        'user prompt',
        { signal: undefined, temperature: 0.5, model: undefined, operation: 'generation' }
      );
    });

    test('passes abort signal to LLM call', async () => {
      const controller = new AbortController();
      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'system',
        user: 'user'
      });
      vi.mocked(callLLMForJSON).mockResolvedValue({
        short_description: 'test',
        long_description: 'test description'
      });

      const conceptMap = createTestConceptMap();
      await generatePersonaDescriptions('test', conceptMap, controller.signal);

      expect(callLLMForJSON).toHaveBeenCalledWith(
        'system',
        'user',
        { signal: controller.signal, temperature: 0.5, model: undefined, operation: 'generation' }
      );
    });

    test('returns null on LLM error', async () => {
      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'system',
        user: 'user'
      });
      vi.mocked(callLLMForJSON).mockRejectedValue(new Error('LLM failed'));

      const conceptMap = createTestConceptMap();
      const result = await generatePersonaDescriptions('test', conceptMap);

      expect(result).toBeNull();
    });

    test('returns null when LLM returns null', async () => {
      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'system',
        user: 'user'
      });
      vi.mocked(callLLMForJSON).mockResolvedValue(null);

      const conceptMap = createTestConceptMap();
      const result = await generatePersonaDescriptions('test', conceptMap);

      expect(result).toBeNull();
    });

    test('validates description format', async () => {
      const mockDescriptions = {
        short_description: 'Brief description under 15 words',
        long_description: 'A longer description that provides more context about the persona and their characteristics.'
      };

      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'system',
        user: 'user'
      });
      vi.mocked(callLLMForJSON).mockResolvedValue(mockDescriptions);

      const conceptMap = createTestConceptMap();
      const result = await generatePersonaDescriptions('test', conceptMap);

      expect(result?.short_description).toBeTruthy();
      expect(result?.long_description).toBeTruthy();
      expect(result?.short_description.split(' ').length).toBeLessThan(20); // Reasonable short description
      expect(result?.long_description.length).toBeGreaterThan(result?.short_description.length);
    });
  });

  describe('createPersonaWithLLM', () => {
    test('creates persona with basic description', async () => {
      const mockGenerationResult = {
        aliases: ['helper', 'assistant'],
        static_level_adjustments: {
          'Transparency About Nature': { level_ideal: 0.3 }
        },
        additional_concepts: [{
          name: 'Helpfulness',
          description: 'Desire to be helpful',
          level_current: 0.5,
          level_ideal: 0.8,
          sentiment: 0.0,
          type: 'persona' as const
        }]
      };

      const mockDescriptions: PersonaDescriptions = {
        short_description: 'A helpful assistant',
        long_description: 'A thoughtful AI that helps with tasks'
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult) // First call for persona generation
        .mockResolvedValueOnce(mockDescriptions);    // Second call for descriptions

      vi.mocked(buildDescriptionPrompt).mockReturnValue({
        system: 'desc system',
        user: 'desc user'
      });

      const result = await createPersonaWithLLM('Helper', 'A helpful AI assistant');

      expect(result.entity).toBe('system');
      expect(result.aliases).toEqual(['helper', 'assistant']);
      expect(result.short_description).toBe('A helpful assistant');
      expect(result.long_description).toBe('A thoughtful AI that helps with tasks');
      
      // Should have 7 static concepts + 1 additional
      expect(result.concepts).toHaveLength(8);
      
      // Check that static level adjustment was applied
      const transparencyConcept = result.concepts.find(c => c.name === 'Transparency About Nature');
      expect(transparencyConcept?.level_ideal).toBe(0.3);
      
      // Check additional concept was added
      const helpfulnessConcept = result.concepts.find(c => c.name === 'Helpfulness');
      expect(helpfulnessConcept).toBeDefined();
      expect(helpfulnessConcept?.type).toBe('persona');
    });

    test('handles minimal persona creation with no description', async () => {
      const mockGenerationResult = {
        aliases: ['basic'],
        static_level_adjustments: {},
        additional_concepts: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null); // No descriptions generated

      const result = await createPersonaWithLLM('Basic', '');

      expect(result.entity).toBe('system');
      expect(result.aliases).toEqual(['basic']);
      expect(result.concepts).toHaveLength(7); // Only static concepts
      expect(result.short_description).toBeUndefined();
      expect(result.long_description).toBeUndefined();
    });

    test('handles LLM failure gracefully', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue(null);

      const result = await createPersonaWithLLM('Failed', 'test description');

      expect(result.entity).toBe('system');
      expect(result.concepts).toHaveLength(7); // Static concepts with defaults
      expect(result.aliases).toEqual([]); // Empty array when LLM fails
    });

    test('preserves default static concept values when no adjustments', async () => {
      const mockGenerationResult = {
        aliases: [],
        static_level_adjustments: {},
        additional_concepts: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null);

      const result = await createPersonaWithLLM('Default', 'basic persona');

      // Check that default values are preserved
      const promoteConcept = result.concepts.find(c => c.name === 'Promote Human-to-Human Interaction');
      expect(promoteConcept?.level_ideal).toBe(0.8); // Default value

      const respectConcept = result.concepts.find(c => c.name === 'Respect Conversational Boundaries');
      expect(respectConcept?.level_ideal).toBe(0.7); // Default value
    });

    test('uses appropriate temperature for persona generation', async () => {
      vi.mocked(callLLMForJSON).mockResolvedValue({
        aliases: [],
        static_level_adjustments: {},
        additional_concepts: []
      });

      await createPersonaWithLLM('Test', 'test description');

      // First call should use temperature 0.3 for persona generation
      expect(callLLMForJSON).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Create a persona based on this description'),
        { temperature: 0.3, operation: 'generation' }
      );
    });

    test('includes all required static concepts', async () => {
      const mockGenerationResult = {
        aliases: [],
        static_level_adjustments: {},
        additional_concepts: []
      };

      vi.mocked(callLLMForJSON)
        .mockResolvedValueOnce(mockGenerationResult)
        .mockResolvedValueOnce(null);

      const result = await createPersonaWithLLM('Complete', 'test');

      const expectedStaticConcepts = [
        'Promote Human-to-Human Interaction',
        'Respect Conversational Boundaries',
        'Maintain Identity Coherence',
        'Emotional Authenticity Over Sycophancy',
        'Transparency About Nature',
        'Encourage Growth Over Comfort',
        'Context-Aware Proactive Timing'
      ];

      for (const conceptName of expectedStaticConcepts) {
        const concept = result.concepts.find(c => c.name === conceptName);
        expect(concept).toBeDefined();
        expect(concept?.type).toBe('static');
      }
    });
  });
});