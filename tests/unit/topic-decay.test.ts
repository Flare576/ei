import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTopicDecay, checkDesireGaps } from '../../src/topic-decay.js';
import type { HumanEntity, PersonaEntity } from '../../src/types.js';
import * as storage from '../../src/storage.js';

vi.mock('../../src/storage.js', async () => {
  const actual = await vi.importActual<typeof storage>('../../src/storage.js');
  return {
    ...actual,
    loadHumanEntity: vi.fn(),
    loadPersonaEntity: vi.fn(),
    saveHumanEntity: vi.fn(),
    savePersonaEntity: vi.fn(),
    appendDebugLog: vi.fn(),
  };
});

describe('topic-decay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyTopicDecay', () => {
    it('decays topic level_current over time', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [
          {
            name: 'programming',
            description: 'Loves coding',
            sentiment: 0.8,
            level_current: 0.5,
            level_ideal: 0.7,
            last_updated: oneHourAgo,
          },
        ],
        people: [],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      const changed = await applyTopicDecay('human');

      expect(changed).toBe(true);
      expect(storage.saveHumanEntity).toHaveBeenCalled();
      const savedEntity = vi.mocked(storage.saveHumanEntity).mock.calls[0][0];
      expect(savedEntity.topics[0].level_current).toBeLessThan(0.5);
    });

    it('decays person level_current over time (human only)', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [],
        people: [
          {
            name: 'Alice',
            relationship: 'friend',
            description: 'Best friend',
            sentiment: 0.9,
            level_current: 0.6,
            level_ideal: 0.5,
            last_updated: oneHourAgo,
          },
        ],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      const changed = await applyTopicDecay('human');

      expect(changed).toBe(true);
      const savedEntity = vi.mocked(storage.saveHumanEntity).mock.calls[0][0];
      expect(savedEntity.people[0].level_current).toBeLessThan(0.6);
    });

    it('does not decay if updated recently', async () => {
      const now = new Date().toISOString();
      
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [
          {
            name: 'programming',
            description: 'Loves coding',
            sentiment: 0.8,
            level_current: 0.5,
            level_ideal: 0.7,
            last_updated: now,
          },
        ],
        people: [],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      const changed = await applyTopicDecay('human');

      expect(changed).toBe(false);
      expect(storage.saveHumanEntity).not.toHaveBeenCalled();
    });

    it('works for persona entities (no people)', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      const personaEntity: PersonaEntity = {
        entity: 'system',
        traits: [],
        topics: [
          {
            name: 'storytelling',
            description: 'Enjoys narratives',
            sentiment: 0.7,
            level_current: 0.8,
            level_ideal: 0.9,
            last_updated: oneHourAgo,
          },
        ],
        last_updated: null,
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();

      const changed = await applyTopicDecay('system', 'frodo');

      expect(changed).toBe(true);
      expect(storage.savePersonaEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          topics: [
            expect.objectContaining({
              level_current: expect.any(Number),
            }),
          ],
        }),
        'frodo'
      );
    });
  });

  describe('checkDesireGaps', () => {
    it('returns true when level_ideal exceeds level_current by threshold', async () => {
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [
          {
            name: 'travel',
            description: 'Wants to discuss travel plans',
            sentiment: 0.5,
            level_current: 0.1,
            level_ideal: 0.8,
            last_updated: new Date().toISOString(),
          },
        ],
        people: [],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);

      const hasGap = await checkDesireGaps('human');

      expect(hasGap).toBe(true);
    });

    it('returns false when desire gap is below threshold', async () => {
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [
          {
            name: 'weather',
            description: 'Neutral topic',
            sentiment: 0.0,
            level_current: 0.5,
            level_ideal: 0.6,
            last_updated: new Date().toISOString(),
          },
        ],
        people: [],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);

      const hasGap = await checkDesireGaps('human');

      expect(hasGap).toBe(false);
    });

    it('returns false when sentiment is too negative', async () => {
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [
          {
            name: 'bad_memories',
            description: 'Painful topic',
            sentiment: -0.8,
            level_current: 0.1,
            level_ideal: 0.9,
            last_updated: new Date().toISOString(),
          },
        ],
        people: [],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);

      const hasGap = await checkDesireGaps('human');

      expect(hasGap).toBe(false);
    });

    it('checks people as well as topics for humans', async () => {
      const humanEntity: HumanEntity = {
        entity: 'human',
        facts: [],
        traits: [],
        topics: [],
        people: [
          {
            name: 'Bob',
            relationship: 'colleague',
            description: 'Want to talk about Bob',
            sentiment: 0.3,
            level_current: 0.0,
            level_ideal: 0.8,
            last_updated: new Date().toISOString(),
          },
        ],
        last_updated: null,
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(humanEntity);

      const hasGap = await checkDesireGaps('human');

      expect(hasGap).toBe(true);
    });
  });
});
