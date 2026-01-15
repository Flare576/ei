import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConceptQueue, ConceptUpdateTask, ConceptUpdateResult } from '../../src/concept-queue.js';
import type { Message, Concept, ConceptMap } from '../../src/types.js';

vi.mock('../../src/llm.js', () => ({
  callLLMForJSON: vi.fn(),
  LLMAbortedError: class extends Error {
    name = 'LLMAbortedError';
    constructor() {
      super('LLM call aborted');
      this.name = 'LLMAbortedError';
    }
  },
}));

vi.mock('../../src/storage.js', () => ({
  loadConceptMap: vi.fn(),
  saveConceptMap: vi.fn(),
  markMessagesConceptProcessed: vi.fn(),
  appendDebugLog: vi.fn(),
}));

vi.mock('../../src/prompts.js', () => ({
  buildConceptUpdateSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  buildConceptUpdateUserPrompt: vi.fn().mockReturnValue('user prompt'),
}));

vi.mock('../../src/validate.js', () => ({
  validateSystemConcepts: vi.fn().mockReturnValue({ valid: true, issues: [] }),
  mergeWithOriginalStatics: vi.fn((proposed) => proposed),
}));

vi.mock('../../src/persona-creator.js', () => ({
  generatePersonaDescriptions: vi.fn(),
}));

import { callLLMForJSON, LLMAbortedError } from '../../src/llm.js';
import { loadConceptMap, saveConceptMap, markMessagesConceptProcessed } from '../../src/storage.js';
import { validateSystemConcepts } from '../../src/validate.js';
import { generatePersonaDescriptions } from '../../src/persona-creator.js';

describe('ConceptQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ConceptQueue.resetInstance();

    vi.mocked(loadConceptMap).mockResolvedValue({
      entity: 'system',
      aliases: [],
      last_updated: null,
      concepts: [],
    } as ConceptMap);

    vi.mocked(callLLMForJSON).mockResolvedValue([]);
    vi.mocked(saveConceptMap).mockResolvedValue(undefined);
    vi.mocked(markMessagesConceptProcessed).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ConceptQueue.resetInstance();
  });

  describe('singleton pattern', () => {
    test('getInstance returns the same instance', () => {
      const instance1 = ConceptQueue.getInstance();
      const instance2 = ConceptQueue.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('resetInstance clears the singleton', () => {
      const instance1 = ConceptQueue.getInstance();
      ConceptQueue.resetInstance();
      const instance2 = ConceptQueue.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('enqueue', () => {
    test('adds task to queue and returns ID', () => {
      const queue = ConceptQueue.getInstance();
      const messages: Message[] = [
        { role: 'human', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ];

      const taskId = queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages,
        priority: 'normal',
      });

      expect(taskId).toBeTruthy();
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(queue.getQueueLength()).toBe(1);
    });

    test('returns empty string when shutting down', async () => {
      const queue = ConceptQueue.getInstance();
      await queue.shutdown();

      const taskId = queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      expect(taskId).toBe('');
    });
  });

  describe('priority ordering', () => {
    test('processes high priority tasks before normal', async () => {
      const queue = ConceptQueue.getInstance();
      const processedOrder: string[] = [];

      vi.mocked(callLLMForJSON).mockImplementation(async () => {
        return [];
      });

      vi.mocked(saveConceptMap).mockImplementation(async () => {
        const currentTask = queue.getPendingForPersona('ei');
      });

      queue.setTaskCompletionCallback((result) => {
        processedOrder.push(result.task.priority);
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'normal1', timestamp: '2024-01-01T00:00:01Z' }],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'high', timestamp: '2024-01-01T00:00:02Z' }],
        priority: 'high',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'normal2', timestamp: '2024-01-01T00:00:03Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processedOrder[0]).toBe('high');
    });

    test('maintains FIFO within same priority', async () => {
      const queue = ConceptQueue.getInstance();
      const processedTimestamps: string[] = [];

      queue.setTaskCompletionCallback((result) => {
        processedTimestamps.push(result.task.created_at);
      });

      const id1 = queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'first', timestamp: '2024-01-01T00:00:01Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const id2 = queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'second', timestamp: '2024-01-01T00:00:02Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(processedTimestamps.length).toBeGreaterThanOrEqual(1);
      if (processedTimestamps.length >= 2) {
        expect(processedTimestamps[0] < processedTimestamps[1]).toBe(true);
      }
    });
  });

  describe('getQueueLength', () => {
    test('returns correct queue length', () => {
      const queue = ConceptQueue.getInstance();
      expect(queue.getQueueLength()).toBe(0);

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      expect(queue.getQueueLength()).toBe(1);
    });
  });

  describe('getPendingForPersona', () => {
    test('filters tasks by persona', () => {
      const queue = ConceptQueue.getInstance();

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'other',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'human',
        messages: [],
        priority: 'high',
      });

      const eiTasks = queue.getPendingForPersona('ei');
      expect(eiTasks.length).toBe(2);
      expect(eiTasks.every(t => t.persona === 'ei')).toBe(true);

      const otherTasks = queue.getPendingForPersona('other');
      expect(otherTasks.length).toBe(1);
    });
  });

  describe('cancelPersonaTasks', () => {
    test('removes all tasks for persona', () => {
      const queue = ConceptQueue.getInstance();

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'other',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'human',
        messages: [],
        priority: 'high',
      });

      const cancelled = queue.cancelPersonaTasks('ei');

      expect(cancelled).toBe(2);
      expect(queue.getQueueLength()).toBe(1);
      expect(queue.getPendingForPersona('ei').length).toBe(0);
      expect(queue.getPendingForPersona('other').length).toBe(1);
    });

    test('returns 0 if no tasks to cancel', () => {
      const queue = ConceptQueue.getInstance();
      const cancelled = queue.cancelPersonaTasks('nonexistent');
      expect(cancelled).toBe(0);
    });
  });

  describe('isProcessing', () => {
    test('returns false initially', () => {
      const queue = ConceptQueue.getInstance();
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe('processNext', () => {
    test('processes task and marks messages as processed', async () => {
      const queue = ConceptQueue.getInstance();
      const messages: Message[] = [
        { role: 'human', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'system', content: 'Hi there', timestamp: '2024-01-01T00:00:01Z' },
      ];

      vi.mocked(callLLMForJSON).mockResolvedValue([
        {
          name: 'test',
          description: 'test concept',
          level_current: 0.5,
          level_ideal: 0.5,
          level_elasticity: 0.3,
          type: 'topic',
        },
      ]);

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages,
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(markMessagesConceptProcessed).toHaveBeenCalledWith(
        ['2024-01-01T00:00:00Z', '2024-01-01T00:00:01Z'],
        'ei'
      );
    });

    test('skips processing with empty messages', async () => {
      const queue = ConceptQueue.getInstance();
      let completed = false;

      queue.setTaskCompletionCallback((result) => {
        completed = true;
        expect(result.success).toBe(true);
        expect(result.conceptsChanged).toBe(false);
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(completed).toBe(true);
      expect(callLLMForJSON).not.toHaveBeenCalled();
    });

    test('handles LLM errors gracefully', async () => {
      const queue = ConceptQueue.getInstance();
      let result: ConceptUpdateResult | null = null;

      vi.mocked(callLLMForJSON).mockRejectedValue(new Error('LLM failed'));

      queue.setTaskCompletionCallback((r) => {
        result = r;
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe('LLM failed');
    });

    test('validates system concepts', async () => {
      const queue = ConceptQueue.getInstance();

      vi.mocked(callLLMForJSON).mockResolvedValue([
        {
          name: 'new concept',
          description: 'test',
          level_current: 0.5,
          level_ideal: 0.5,
          level_elasticity: 0.3,
          type: 'topic',
        },
      ]);

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(validateSystemConcepts).toHaveBeenCalled();
    });

    test('does not validate human concepts', async () => {
      const queue = ConceptQueue.getInstance();

      vi.mocked(callLLMForJSON).mockResolvedValue([
        {
          name: 'new concept',
          description: 'test',
          level_current: 0.5,
          level_ideal: 0.5,
          level_elasticity: 0.3,
          type: 'topic',
        },
      ]);

      queue.enqueue({
        persona: 'ei',
        target: 'human',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(validateSystemConcepts).not.toHaveBeenCalled();
    });

    test('regenerates descriptions when concepts change', async () => {
      const queue = ConceptQueue.getInstance();

      vi.mocked(loadConceptMap).mockResolvedValue({
        entity: 'system',
        aliases: [],
        last_updated: null,
        concepts: [],
      } as ConceptMap);

      vi.mocked(callLLMForJSON).mockResolvedValue([
        {
          name: 'new concept',
          description: 'test',
          level_current: 0.5,
          level_ideal: 0.5,
          level_elasticity: 0.3,
          type: 'topic',
        },
      ]);

      vi.mocked(generatePersonaDescriptions).mockResolvedValue({
        short_description: 'Short',
        long_description: 'Long description',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(generatePersonaDescriptions).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    test('prevents new tasks from being enqueued', async () => {
      const queue = ConceptQueue.getInstance();
      await queue.shutdown();

      const taskId = queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      expect(taskId).toBe('');
      expect(queue.getQueueLength()).toBe(0);
    });

    test('clears pending tasks', async () => {
      const queue = ConceptQueue.getInstance();

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [],
        priority: 'normal',
      });

      queue.enqueue({
        persona: 'ei',
        target: 'human',
        messages: [],
        priority: 'normal',
      });

      await queue.shutdown();

      expect(queue.getQueueLength()).toBe(0);
    });
  });

  describe('task completion callback', () => {
    test('calls callback on successful completion', async () => {
      const queue = ConceptQueue.getInstance();
      let receivedResult: ConceptUpdateResult | null = null;

      queue.setTaskCompletionCallback((result) => {
        receivedResult = result;
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedResult).not.toBeNull();
      expect(receivedResult!.success).toBe(true);
      expect(receivedResult!.task.persona).toBe('ei');
    });

    test('calls callback on failure', async () => {
      const queue = ConceptQueue.getInstance();
      let receivedResult: ConceptUpdateResult | null = null;

      vi.mocked(callLLMForJSON).mockRejectedValue(new Error('Test error'));

      queue.setTaskCompletionCallback((result) => {
        receivedResult = result;
      });

      queue.enqueue({
        persona: 'ei',
        target: 'system',
        messages: [{ role: 'human', content: 'test', timestamp: '2024-01-01T00:00:00Z' }],
        priority: 'normal',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(receivedResult).not.toBeNull();
      expect(receivedResult!.success).toBe(false);
      expect(receivedResult!.error).toBe('Test error');
    });

    test('can clear callback with null', () => {
      const queue = ConceptQueue.getInstance();
      queue.setTaskCompletionCallback(() => {});
      queue.setTaskCompletionCallback(null);
    });
  });
});
