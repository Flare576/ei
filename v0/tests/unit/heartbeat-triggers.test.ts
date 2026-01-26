import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConceptMap } from '../../src/storage.js';
import type { ConceptMap, Concept, ConceptType } from '../../src/types.js';

vi.mock('../../src/storage.js', () => ({
  loadConceptMap: vi.fn(),
  appendDebugLog: vi.fn(),
  initializeDebugLog: vi.fn(),
  setStateManager: vi.fn(),
  getDataPath: vi.fn(() => "/tmp/ei-test"),
}));

// Test the heartbeat trigger logic directly
const DESIRE_GAP_THRESHOLD = 0.3;
const SENTIMENT_FLOOR = -0.5;

async function checkConceptDeltas(personaName: string): Promise<boolean> {
  const concepts = await loadConceptMap("system", personaName);
  
  for (const concept of concepts.concepts) {
    const desireGap = concept.level_ideal - concept.level_current;
    
    if (desireGap >= DESIRE_GAP_THRESHOLD && concept.sentiment > SENTIMENT_FLOOR) {
      console.log(`Heartbeat trigger: "${concept.name}" - desire gap ${desireGap.toFixed(2)}, sentiment ${concept.sentiment.toFixed(2)}`);
      return true;
    }
  }
  
  return false;
}

describe('Heartbeat Trigger Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkConceptDeltas', () => {
    const createMockConcept = (name: string, level_current: number, level_ideal: number, sentiment: number): Concept => ({
      name,
      description: 'Mock concept for testing',
      level_current,
      level_ideal,
      sentiment,
      type: 'topic' as ConceptType,
    });

    const createMockConceptMap = (concepts: Concept[]): ConceptMap => ({
      entity: 'system',
      last_updated: new Date().toISOString(),
      concepts,
    });

    it('triggers when desire gap exceeds threshold and sentiment is positive', async () => {
      const concepts = [
        createMockConcept('programming', 0.2, 0.6, 0.3)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(true);
      expect(loadConceptMap).toHaveBeenCalledWith('system', 'test-persona');
    });

    it('does not trigger when sentiment is too negative despite large desire gap', async () => {
      const concepts = [
        createMockConcept('work_stress', 0.1, 0.5, -0.7)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(false);
    });

    it('does not trigger when level_ideal is less than level_current', async () => {
      const concepts = [
        createMockConcept('happy_topic', 0.5, 0.3, 0.8)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(false);
    });

    it('does not trigger when desire gap is below threshold', async () => {
      const concepts = [
        createMockConcept('small_gap', 0.5, 0.7, 0.5)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(false);
    });

    it('triggers on first matching concept even with multiple concepts', async () => {
      const concepts = [
        createMockConcept('no_trigger_1', 0.5, 0.7, 0.5),
        createMockConcept('trigger_concept', 0.1, 0.5, 0.3),
        createMockConcept('no_trigger_2', 0.8, 0.6, 0.8)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(true);
    });

    it('respects sentiment floor boundary condition', async () => {
      const concepts = [
        createMockConcept('boundary_sentiment', 0.0, 0.4, -0.5)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(false);
    });

    it('respects desire gap threshold boundary condition', async () => {
      const concepts = [
        createMockConcept('boundary_gap', 0.0, 0.3, 0.5)
      ];
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap(concepts));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(true);
    });

    it('handles empty concept list', async () => {
      vi.mocked(loadConceptMap).mockResolvedValue(createMockConceptMap([]));

      const result = await checkConceptDeltas('test-persona');

      expect(result).toBe(false);
    });
  });
});
