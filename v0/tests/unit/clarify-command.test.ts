import { describe, test, expect } from 'vitest';
import { findDataPointByName } from '../../src/verification.js';
import type { HumanEntity, Fact, Topic, Trait, Person } from '../../src/types.js';

describe('Clarify Command - Data Operations', () => {
  const mockHumanEntity: HumanEntity = {
    entity: 'human',
    facts: [
      {
        name: 'Birthday',
        description: 'January 1, 1990',
        sentiment: 0,
        confidence: 0.9,
        last_updated: new Date().toISOString()
      } as Fact
    ],
    traits: [
      {
        name: 'Introverted',
        description: 'Prefers quiet settings',
        sentiment: 0.2,
        strength: 0.7,
        last_updated: new Date().toISOString()
      } as Trait
    ],
    topics: [
      {
        name: 'Programming',
        description: 'Software development interest',
        sentiment: 0.8,
        level_current: 0.9,
        level_ideal: 0.8,
        last_updated: new Date().toISOString()
      } as Topic
    ],
    people: [
      {
        name: 'Alice',
        description: 'Close friend from college',
        sentiment: 0.7,
        relationship: 'friend',
        level_current: 0.6,
        level_ideal: 0.7,
        last_updated: new Date().toISOString()
      } as Person
    ],
    last_updated: new Date().toISOString()
  };

  describe('findDataPointByName', () => {
    test('finds fact by exact name', () => {
      const result = findDataPointByName(mockHumanEntity, 'Birthday');
      expect(result).toBeTruthy();
      expect(result?.item_type).toBe('fact');
      expect(result?.name).toBe('Birthday');
    });

    test('finds trait by exact name', () => {
      const result = findDataPointByName(mockHumanEntity, 'Introverted');
      expect(result).toBeTruthy();
      expect(result?.item_type).toBe('trait');
      expect(result?.name).toBe('Introverted');
    });

    test('finds topic by exact name', () => {
      const result = findDataPointByName(mockHumanEntity, 'Programming');
      expect(result).toBeTruthy();
      expect(result?.item_type).toBe('topic');
      expect(result?.name).toBe('Programming');
    });

    test('finds person by exact name', () => {
      const result = findDataPointByName(mockHumanEntity, 'Alice');
      expect(result).toBeTruthy();
      expect(result?.item_type).toBe('person');
      expect(result?.name).toBe('Alice');
    });

    test('returns null for non-existent item', () => {
      const result = findDataPointByName(mockHumanEntity, 'NonExistent');
      expect(result).toBeNull();
    });

    test('search is case-sensitive', () => {
      const result = findDataPointByName(mockHumanEntity, 'birthday');
      expect(result).toBeNull();
    });
  });

  describe('Entity structure validation', () => {
    test('entity has correct data buckets', () => {
      expect(mockHumanEntity.facts).toBeDefined();
      expect(mockHumanEntity.traits).toBeDefined();
      expect(mockHumanEntity.topics).toBeDefined();
      expect(mockHumanEntity.people).toBeDefined();
    });

    test('facts have confidence field', () => {
      const fact = mockHumanEntity.facts[0];
      expect(fact).toHaveProperty('confidence');
      expect(typeof fact.confidence).toBe('number');
    });

    test('traits have optional strength field', () => {
      const trait = mockHumanEntity.traits[0];
      expect(trait).toHaveProperty('strength');
    });

    test('topics have level fields', () => {
      const topic = mockHumanEntity.topics[0];
      expect(topic).toHaveProperty('level_current');
      expect(topic).toHaveProperty('level_ideal');
    });

    test('people have relationship and level fields', () => {
      const person = mockHumanEntity.people[0];
      expect(person).toHaveProperty('relationship');
      expect(person).toHaveProperty('level_current');
      expect(person).toHaveProperty('level_ideal');
    });
  });
});
