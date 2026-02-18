import { test, expect, describe } from "bun:test";
import { 
  personaToYAML, 
  personaFromYAML, 
  humanToYAML, 
  humanFromYAML 
} from "../../../src/util/yaml-serializers";
import type { PersonaEntity, HumanEntity } from "../../../../src/core/types";
import { ValidationLevel } from "../../../../src/core/types";

describe("personaToYAML", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";
  
  const minimalPersona: PersonaEntity = {
    id: "test-id",
    display_name: "TestBot",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: timestamp,
    last_activity: timestamp,
    last_heartbeat: timestamp,
    heartbeat_delay_ms: 300000,
  };

  test("serializes minimal persona with placeholders", () => {
    const yaml = personaToYAML(minimalPersona);
    expect(yaml).toContain("display_name: TestBot");
    expect(yaml).toContain("name: Example Trait");
    expect(yaml).toContain("name: Example Topic");
    expect(yaml).not.toContain("id:");
    expect(yaml).not.toContain("_delete:");
  });

  test("serializes persona with traits and topics", () => {
    const persona: PersonaEntity = {
      ...minimalPersona,
      long_description: "A bot for testing purposes",
      traits: [
        { id: "trait-1", name: "friendly", description: "always kind", strength: 0.8, sentiment: 0.5, last_updated: timestamp },
      ],
      topics: [
        { id: "topic-1", name: "testing", perspective: "loves it", approach: "thorough", personal_stake: "quality", sentiment: 0.5, exposure_current: 0.5, exposure_desired: 0.7, last_updated: timestamp },
      ],
    };
    
    const yaml = personaToYAML(persona);
    expect(yaml).toContain("long_description: A bot for testing purposes");
    expect(yaml).toContain("name: friendly");
    expect(yaml).toContain("description: always kind");
    expect(yaml).toContain("strength: 0.8");
    expect(yaml).toContain("name: testing");
    expect(yaml).toContain("perspective: loves it");
    expect(yaml).not.toContain("id:");
    expect(yaml).not.toContain("_delete:");
    expect(yaml).not.toContain("short_description:");
  });

  test("serializes persona with model and group settings", () => {
    const persona: PersonaEntity = {
      ...minimalPersona,
      model: "gpt-4o",
      group_primary: "work",
      groups_visible: ["work", "personal"],
    };
    
    const yaml = personaToYAML(persona);
    expect(yaml).toContain("model: gpt-4o");
    expect(yaml).toContain("group_primary: work");
    expect(yaml).toContain("groups_visible:");
    expect(yaml).toContain("- work");
    expect(yaml).toContain("- personal");
  });

  test("does not include id or _delete in output", () => {
    const persona: PersonaEntity = {
      ...minimalPersona,
      traits: [
        { id: "t1", name: "happy", description: "joyful", strength: 1, sentiment: 0.5, last_updated: timestamp },
        { id: "t2", name: "sad", description: "melancholy", strength: 0.5, sentiment: -0.3, last_updated: timestamp },
      ],
      topics: [
        { id: "top1", name: "music", perspective: "loves it", approach: "listening", personal_stake: "relaxation", sentiment: 0.7, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp },
      ],
    };
    
    const yaml = personaToYAML(persona);
    expect(yaml).not.toContain("id:");
    expect(yaml).not.toContain("_delete:");
  });
});

describe("personaFromYAML", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";
  
  const emptyOriginal: PersonaEntity = {
    id: "test-id",
    display_name: "TestBot",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: timestamp,
    last_activity: timestamp,
    last_heartbeat: timestamp,
    heartbeat_delay_ms: 300000,
  };

  test("parses minimal YAML with empty original", () => {
    const yaml = `
display_name: TestBot
traits: []
topics: []
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.traits).toEqual([]);
    expect(result.updates.topics).toEqual([]);
    expect(result.deletedTraitIds).toEqual([]);
    expect(result.deletedTopicIds).toEqual([]);
  });

  test("generates new IDs for new traits", () => {
    const yaml = `
display_name: TestBot
traits:
  - name: friendly
    description: always kind
    strength: 0.8
topics: []
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.traits).toHaveLength(1);
    expect(result.updates.traits![0].name).toBe("friendly");
    expect(result.updates.traits![0].description).toBe("always kind");
    expect(result.updates.traits![0].id).toBeDefined();
    expect(result.deletedTraitIds).toEqual([]);
  });

  test("preserves IDs for existing traits matched by name", () => {
    const originalWithTrait: PersonaEntity = {
      ...emptyOriginal,
      traits: [
        { id: "existing-trait-id", name: "friendly", description: "old desc", strength: 0.5, sentiment: 0.3, last_updated: timestamp },
      ],
    };
    
    const yaml = `
display_name: TestBot
traits:
  - name: friendly
    description: updated description
    strength: 0.9
topics: []
`;
    const result = personaFromYAML(yaml, originalWithTrait);
    expect(result.updates.traits).toHaveLength(1);
    expect(result.updates.traits![0].id).toBe("existing-trait-id");
    expect(result.updates.traits![0].description).toBe("updated description");
    expect(result.updates.traits![0].strength).toBe(0.9);
  });

  test("detects deleted traits", () => {
    const originalWithTraits: PersonaEntity = {
      ...emptyOriginal,
      traits: [
        { id: "keep-id", name: "keep-me", description: "staying", strength: 0.8, sentiment: 0, last_updated: timestamp },
        { id: "delete-id", name: "delete-me", description: "going away", strength: 0.5, sentiment: 0, last_updated: timestamp },
      ],
    };
    
    const yaml = `
display_name: TestBot
traits:
  - name: keep-me
    description: staying
    strength: 0.8
topics: []
`;
    const result = personaFromYAML(yaml, originalWithTraits);
    expect(result.updates.traits).toHaveLength(1);
    expect(result.updates.traits![0].name).toBe("keep-me");
    expect(result.deletedTraitIds).toEqual(["delete-id"]);
  });

  test("detects deleted topics", () => {
    const originalWithTopics: PersonaEntity = {
      ...emptyOriginal,
      topics: [
        { id: "keep-id", name: "keep-me", perspective: "p", approach: "a", personal_stake: "s", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp },
        { id: "delete-id", name: "delete-me", perspective: "p", approach: "a", personal_stake: "s", sentiment: 0, exposure_current: 0.3, exposure_desired: 0.3, last_updated: timestamp },
      ],
    };
    
    const yaml = `
display_name: TestBot
traits: []
topics:
  - name: keep-me
    perspective: p
    approach: a
    personal_stake: s
    exposure_current: 0.5
    exposure_desired: 0.5
`;
    const result = personaFromYAML(yaml, originalWithTopics);
    expect(result.updates.topics).toHaveLength(1);
    expect(result.updates.topics![0].name).toBe("keep-me");
    expect(result.deletedTopicIds).toEqual(["delete-id"]);
  });

  test("parses all persona fields", () => {
    const yaml = `
display_name: TestBot
long_description: A bot for testing
model: gpt-4o
group_primary: work
groups_visible:
  - work
  - personal
heartbeat_delay_ms: 600000
context_window_hours: 48
traits: []
topics: []
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.long_description).toBe("A bot for testing");
    expect(result.updates.model).toBe("gpt-4o");
    expect(result.updates.group_primary).toBe("work");
    expect(result.updates.groups_visible).toEqual(["work", "personal"]);
    expect(result.updates.heartbeat_delay_ms).toBe(600000);
    expect(result.updates.context_window_hours).toBe(48);
  });

  test("sets last_updated to current time", () => {
    const yaml = `
display_name: TestBot
traits: []
topics: []
`;
    const before = new Date().toISOString();
    const result = personaFromYAML(yaml, emptyOriginal);
    const after = new Date().toISOString();
    
    expect(result.updates.last_updated).toBeDefined();
    expect(result.updates.last_updated! >= before).toBe(true);
    expect(result.updates.last_updated! <= after).toBe(true);
  });

  test("strips placeholder traits", () => {
    const yaml = `
display_name: TestBot
traits:
  - name: Example Trait
    description: Delete this placeholder or modify it to define a real trait
    strength: 0.5
topics: []
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.traits).toEqual([]);
  });

  test("strips placeholder topics", () => {
    const yaml = `
display_name: TestBot
traits: []
topics:
  - name: Example Topic
    perspective: How this persona views or thinks about this topic
    approach: How this persona prefers to engage with this topic
    personal_stake: Why this topic matters to this persona personally
    exposure_current: 0.5
    exposure_desired: 0.5
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.topics).toEqual([]);
  });
});

describe("humanToYAML", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";
  
  const minimalHuman: HumanEntity = {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: timestamp,
    last_activity: timestamp,
    settings: {},
  };

  test("serializes minimal human data", () => {
    const yaml = humanToYAML(minimalHuman);
    expect(yaml).toContain("facts: []");
    expect(yaml).toContain("traits: []");
    expect(yaml).toContain("topics: []");
    expect(yaml).toContain("people: []");
  });

  test("serializes human with all data types", () => {
    const human: HumanEntity = {
      ...minimalHuman,
      facts: [
        { id: "fact-1", name: "location", description: "Lives in NYC", sentiment: 0, last_updated: timestamp, validated: ValidationLevel.None, validated_date: timestamp },
      ],
      traits: [
        { id: "trait-1", name: "curious", description: "always learning", strength: 0.8, sentiment: 0.5, last_updated: timestamp },
      ],
      topics: [
        { id: "topic-1", name: "programming", description: "loves to code", exposure_current: 0.7, exposure_desired: 0.5, sentiment: 0.8, last_updated: timestamp },
      ],
      people: [
        { id: "person-1", name: "Alice", description: "best friend", relationship: "friend", sentiment: 0.8, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp },
      ],
    };
    
    const yaml = humanToYAML(human);
    expect(yaml).toContain("name: location");
    expect(yaml).toContain("description: Lives in NYC");
    expect(yaml).toContain("name: curious");
    expect(yaml).toContain("name: programming");
    expect(yaml).toContain("name: Alice");
    expect(yaml).toContain("relationship: friend");
  });

  test("adds _delete: false to all items", () => {
    const human: HumanEntity = {
      ...minimalHuman,
      facts: [{ id: "f1", name: "test", description: "test desc", sentiment: 0, last_updated: timestamp, validated: ValidationLevel.None, validated_date: timestamp }],
      traits: [{ id: "t1", name: "test", description: "test desc", strength: 1, sentiment: 0, last_updated: timestamp }],
      topics: [{ id: "top1", name: "test", description: "test desc", exposure_current: 0.5, exposure_desired: 0.5, sentiment: 0, last_updated: timestamp }],
      people: [{ id: "p1", name: "Test", description: "test desc", relationship: "test", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp }],
    };
    
    const yaml = humanToYAML(human);
    const deleteCount = (yaml.match(/_delete: false/g) || []).length;
    expect(deleteCount).toBe(4);
  });
});

describe("humanFromYAML", () => {
  test("parses minimal YAML", () => {
    const yaml = `
facts: []
traits: []
topics: []
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toEqual([]);
    expect(result.traits).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.deletedFactIds).toEqual([]);
    expect(result.deletedTraitIds).toEqual([]);
    expect(result.deletedTopicIds).toEqual([]);
    expect(result.deletedPersonIds).toEqual([]);
  });

  test("parses facts and detects deletions", () => {
    const yaml = `
facts:
  - id: fact-1
    name: location
    description: Keep this fact
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    validated: none
    validated_date: 2024-01-01T00:00:00.000Z
    _delete: false
  - id: fact-2
    name: old-fact
    description: Delete this fact
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    validated: none
    validated_date: 2024-01-01T00:00:00.000Z
    _delete: true
traits: []
topics: []
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].id).toBe("fact-1");
    expect(result.facts[0]).not.toHaveProperty("_delete");
    expect(result.deletedFactIds).toEqual(["fact-2"]);
  });

  test("parses traits and detects deletions", () => {
    const yaml = `
facts: []
traits:
  - id: trait-1
    name: keep
    description: staying
    strength: 0.8
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
  - id: trait-2
    name: delete
    description: going
    strength: 0.5
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: true
topics: []
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.traits).toHaveLength(1);
    expect(result.traits[0].id).toBe("trait-1");
    expect(result.deletedTraitIds).toEqual(["trait-2"]);
  });

  test("parses topics and detects deletions", () => {
    const yaml = `
facts: []
traits: []
topics:
  - id: topic-1
    name: keep
    description: staying
    exposure_current: 0.5
    exposure_desired: 0.5
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
  - id: topic-2
    name: delete
    description: going
    exposure_current: 0.3
    exposure_desired: 0.3
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: true
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].id).toBe("topic-1");
    expect(result.deletedTopicIds).toEqual(["topic-2"]);
  });

  test("parses people and detects deletions", () => {
    const yaml = `
facts: []
traits: []
topics: []
people:
  - id: person-1
    name: Alice
    description: friend
    relationship: friend
    sentiment: 0.8
    exposure_current: 0.5
    exposure_desired: 0.5
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
  - id: person-2
    name: Bob
    description: enemy
    relationship: enemy
    sentiment: -0.5
    exposure_current: 0.5
    exposure_desired: 0.5
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: true
`;
    const result = humanFromYAML(yaml);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].id).toBe("person-1");
    expect(result.people[0].name).toBe("Alice");
    expect(result.deletedPersonIds).toEqual(["person-2"]);
  });

  test("handles null/undefined arrays", () => {
    const yaml = `
facts: null
traits: null
topics: null
people: null
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toEqual([]);
    expect(result.traits).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(result.people).toEqual([]);
  });

  test("strips _delete from all returned items", () => {
    const yaml = `
facts:
  - id: fact-1
    name: test
    description: test
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    validated: none
    validated_date: 2024-01-01T00:00:00.000Z
    _delete: false
traits:
  - id: trait-1
    name: test
    description: test
    strength: 0.8
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
topics:
  - id: topic-1
    name: test
    description: test
    exposure_current: 0.5
    exposure_desired: 0.5
    sentiment: 0
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
people:
  - id: person-1
    name: Test
    description: test
    relationship: test
    sentiment: 0
    exposure_current: 0.5
    exposure_desired: 0.5
    last_updated: 2024-01-01T00:00:00.000Z
    _delete: false
`;
    const result = humanFromYAML(yaml);
    expect(result.facts[0]).not.toHaveProperty("_delete");
    expect(result.traits[0]).not.toHaveProperty("_delete");
    expect(result.topics[0]).not.toHaveProperty("_delete");
    expect(result.people[0]).not.toHaveProperty("_delete");
  });
});

describe("round-trip serialization", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";

  test("persona survives round-trip without data loss", () => {
    const original: PersonaEntity = {
      id: "test-id",
      display_name: "TestBot",
      entity: "system",
      long_description: "A comprehensive test bot",
      model: "gpt-4o",
      group_primary: "testing",
      groups_visible: ["testing", "dev"],
      traits: [
        { id: "t1", name: "helpful", description: "always ready to assist", strength: 0.9, sentiment: 0.5, last_updated: timestamp },
        { id: "t2", name: "witty", description: "makes clever jokes", strength: 0.7, sentiment: 0.3, last_updated: timestamp },
      ],
      topics: [
        { id: "top1", name: "AI", perspective: "fascinated by it", approach: "deep discussion", personal_stake: "wants to understand", sentiment: 0.8, exposure_current: 0.8, exposure_desired: 0.9, last_updated: timestamp },
      ],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: timestamp,
      last_activity: timestamp,
      last_heartbeat: timestamp,
      heartbeat_delay_ms: 300000,
      context_window_hours: 24,
    };

    const yaml = personaToYAML(original);
    const result = personaFromYAML(yaml, original);

    expect(result.updates.long_description).toBe(original.long_description);
    expect(result.updates.model).toBe(original.model);
    expect(result.updates.group_primary).toBe(original.group_primary);
    expect(result.updates.groups_visible).toEqual(original.groups_visible);
    expect(result.updates.traits).toHaveLength(2);
    expect(result.updates.traits![0].id).toBe("t1");
    expect(result.updates.traits![1].id).toBe("t2");
    expect(result.updates.topics).toHaveLength(1);
    expect(result.updates.topics![0].id).toBe("top1");
    expect(result.updates.heartbeat_delay_ms).toBe(original.heartbeat_delay_ms);
    expect(result.updates.context_window_hours).toBe(original.context_window_hours);
    expect(result.deletedTraitIds).toEqual([]);
    expect(result.deletedTopicIds).toEqual([]);
  });

  test("human data survives round-trip without data loss", () => {
    const original: HumanEntity = {
      entity: "human",
      facts: [
        { id: "f1", name: "coffee", description: "Loves coffee", sentiment: 0.8, last_updated: timestamp, validated: ValidationLevel.None, validated_date: timestamp },
      ],
      traits: [
        { id: "t1", name: "introverted", description: "prefers quiet time", strength: 0.7, sentiment: 0, last_updated: timestamp },
      ],
      topics: [
        { id: "top1", name: "technology", description: "fascinated by tech", exposure_current: 0.9, exposure_desired: 0.6, sentiment: 0.7, last_updated: timestamp },
      ],
      people: [
        { id: "p1", name: "Jane", description: "colleague from work", relationship: "colleague", sentiment: 0.6, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp },
      ],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: {},
    };

    const yaml = humanToYAML(original);
    const result = humanFromYAML(yaml);

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].description).toBe("Loves coffee");
    expect(result.traits).toHaveLength(1);
    expect(result.traits[0].name).toBe("introverted");
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].name).toBe("technology");
    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Jane");
    expect(result.deletedFactIds).toEqual([]);
    expect(result.deletedTraitIds).toEqual([]);
    expect(result.deletedTopicIds).toEqual([]);
    expect(result.deletedPersonIds).toEqual([]);
  });
});
