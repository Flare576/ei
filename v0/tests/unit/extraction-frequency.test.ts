import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { triggerExtraction, recordExtraction, getItemCount } from '../../src/extraction-frequency.js';
import type { HumanEntity, PersonaEntity, Message, ExtractionState } from '../../src/types.js';
import * as storage from '../../src/storage.js';
import * as llmQueue from '../../src/llm-queue.js';

vi.mock('../../src/storage.js', async () => {
  const actual = await vi.importActual<typeof storage>('../../src/storage.js');
  return {
    ...actual,
    loadExtractionState: vi.fn(),
    saveExtractionState: vi.fn(),
    appendDebugLog: vi.fn(),
  };
});

vi.mock('../../src/llm-queue.js', async () => {
  const actual = await vi.importActual<typeof llmQueue>('../../src/llm-queue.js');
  return {
    ...actual,
    enqueueItem: vi.fn(),
  };
});

describe('extraction-frequency', () => {
  const mockMessages: Message[] = [
    {
      role: 'human',
      content: 'Test message',
      timestamp: new Date().toISOString(),
      read: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerExtraction', () => {
    it('queues fast_scan for topics and people on every message', async () => {
      const mockState: ExtractionState = {
        human: {
          fact: { last_extraction: null, messages_since_last_extract: 3, total_extractions: 5 },
          trait: { last_extraction: null, messages_since_last_extract: 2, total_extractions: 5 },
          topic: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
          person: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
        },
      };
      vi.mocked(storage.loadExtractionState).mockResolvedValue(mockState);
      vi.mocked(storage.saveExtractionState).mockResolvedValue();
      vi.mocked(llmQueue.enqueueItem).mockResolvedValue('test-id');

      await triggerExtraction('human', 'ei', mockMessages);

      expect(llmQueue.enqueueItem).toHaveBeenCalledWith({
        type: 'fast_scan',
        priority: 'low',
        payload: {
          target: 'human',
          persona: 'ei',
          messages: mockMessages,
          dataTypes: ['topic', 'person'],
        },
      });
    });

    it('increments message count for all data types', async () => {
      const mockState: ExtractionState = {
        human: {
          fact: { last_extraction: null, messages_since_last_extract: 5, total_extractions: 0 },
          trait: { last_extraction: null, messages_since_last_extract: 3, total_extractions: 0 },
          topic: { last_extraction: null, messages_since_last_extract: 2, total_extractions: 0 },
          person: { last_extraction: null, messages_since_last_extract: 1, total_extractions: 0 },
        },
      };
      vi.mocked(storage.loadExtractionState).mockResolvedValue(mockState);
      vi.mocked(storage.saveExtractionState).mockResolvedValue();
      vi.mocked(llmQueue.enqueueItem).mockResolvedValue('test-id');

      await triggerExtraction('human', 'ei', mockMessages);

      expect(storage.saveExtractionState).toHaveBeenCalledWith({
        human: {
          fact: { last_extraction: null, messages_since_last_extract: 6, total_extractions: 0 },
          trait: { last_extraction: null, messages_since_last_extract: 4, total_extractions: 0 },
          topic: { last_extraction: null, messages_since_last_extract: 3, total_extractions: 0 },
          person: { last_extraction: null, messages_since_last_extract: 2, total_extractions: 0 },
        },
      });
    });

    it('respects threshold for facts and traits (not topics)', async () => {
      const mockState: ExtractionState = {
        human: {
          fact: { last_extraction: null, messages_since_last_extract: 5, total_extractions: 20 },
          trait: { last_extraction: null, messages_since_last_extract: 15, total_extractions: 10 },
          topic: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
          person: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
        },
      };
      vi.mocked(storage.loadExtractionState).mockResolvedValue(mockState);
      vi.mocked(storage.saveExtractionState).mockResolvedValue();
      vi.mocked(llmQueue.enqueueItem).mockResolvedValue('test-id');

      await triggerExtraction('human', 'ei', mockMessages);

      expect(llmQueue.enqueueItem).toHaveBeenCalled();
    });

    it('skips facts and people for system entities', async () => {
      const mockState: ExtractionState = {};
      vi.mocked(storage.loadExtractionState).mockResolvedValue(mockState);
      vi.mocked(storage.saveExtractionState).mockResolvedValue();
      vi.mocked(llmQueue.enqueueItem).mockResolvedValue('test-id');

      await triggerExtraction('system', 'frodo', mockMessages);

      const savedState = vi.mocked(storage.saveExtractionState).mock.calls[0][0];
      const entityState = savedState['system:frodo'];

      expect(entityState.trait.messages_since_last_extract).toBe(1);
      expect(entityState.topic.messages_since_last_extract).toBe(1);
      expect(entityState.fact.messages_since_last_extract).toBe(0);
      expect(entityState.person.messages_since_last_extract).toBe(0);
    });
  });

  describe('recordExtraction', () => {
    it('resets message count and increments total extractions', async () => {
      const mockState: ExtractionState = {
        human: {
          fact: { last_extraction: null, messages_since_last_extract: 15, total_extractions: 5 },
          trait: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
          topic: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
          person: { last_extraction: null, messages_since_last_extract: 0, total_extractions: 0 },
        },
      };
      vi.mocked(storage.loadExtractionState).mockResolvedValue(mockState);
      vi.mocked(storage.saveExtractionState).mockResolvedValue();

      await recordExtraction('human', null, 'fact');

      const savedState = vi.mocked(storage.saveExtractionState).mock.calls[0][0];
      expect(savedState.human.fact.messages_since_last_extract).toBe(0);
      expect(savedState.human.fact.total_extractions).toBe(6);
      expect(savedState.human.fact.last_extraction).toBeTruthy();
    });
  });

  describe('getItemCount', () => {
    it('returns correct counts for human entity', () => {
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [{ name: 'test', description: 'test', sentiment: 0, last_updated: '', confidence: 1 }],
        traits: [{name: 'a', description: '', sentiment: 0, last_updated: ''}, {name: 'b', description: '', sentiment: 0, last_updated: ''}],
        topics: [],
        people: [{name: 'c', description: '', sentiment: 0, last_updated: '', relationship: '', level_current: 0, level_ideal: 0}],
        last_updated: null,
      };

      expect(getItemCount(humanEntity, 'fact')).toBe(1);
      expect(getItemCount(humanEntity, 'trait')).toBe(2);
      expect(getItemCount(humanEntity, 'topic')).toBe(0);
      expect(getItemCount(humanEntity, 'person')).toBe(1);
    });

    it('returns 0 for facts/people on system entity', () => {
      const personaEntity: PersonaEntity = {
        entity: 'system',
        traits: [{ name: 'test', description: 'test', sentiment: 0, last_updated: '' }],
        topics: [],
        last_updated: null,
      };

      expect(getItemCount(personaEntity, 'fact')).toBe(0);
      expect(getItemCount(personaEntity, 'trait')).toBe(1);
      expect(getItemCount(personaEntity, 'topic')).toBe(0);
      expect(getItemCount(personaEntity, 'person')).toBe(0);
    });
  });
});
