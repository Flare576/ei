import { test, expect, describe } from "bun:test";
import { 
  personaToYAML, 
  personaFromYAML, 
  humanToYAML, 
  humanFromYAML,
  contextToYAML,
  contextFromYAML,
  settingsToYAML,
  settingsFromYAML,
  newProviderToYAML,
  newProviderFromYAML,
  providerToYAML,
  providerFromYAML,
  modelGuidToDisplay,
  displayToModelGuid,
} from "../../../src/util/yaml-serializers";
import type { PersonaEntity, HumanEntity, Message, HumanSettings, ProviderAccount } from "../../../../src/core/types";
import { ContextStatus, ProviderType } from "../../../../src/core/types";

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
    expect(yaml).toContain("work: true");
    expect(yaml).toContain("personal: true");
  });

  test("serializes all groups with visibility flags when allGroups provided", () => {
    const persona: PersonaEntity = {
      ...minimalPersona,
      groups_visible: ["work"],
    };
    const allGroups = ["work", "personal", "family"];
    
    const yaml = personaToYAML(persona, allGroups);
    expect(yaml).toContain("work: true");
    expect(yaml).toContain("personal: false");
    expect(yaml).toContain("family: false");
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
  - work: true
  - personal: true
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

  test("parses groups_visible with mixed true/false values", () => {
    const yaml = `
display_name: TestBot
groups_visible:
  - work: true
  - personal: false
  - family: true
traits: []
topics: []
`;
    const result = personaFromYAML(yaml, emptyOriginal);
    expect(result.updates.groups_visible).toEqual(["work", "family"]);
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
    expect(yaml).toContain("topics: []");
    expect(yaml).toContain("people: []");
  });

  test("serializes human with all data types", () => {
    const human: HumanEntity = {
      ...minimalHuman,
      facts: [
        { id: "fact-1", name: "location", description: "Lives in NYC", sentiment: 0, last_updated: timestamp, validated_date: "" },
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
    expect(yaml).toContain("name: programming");
    expect(yaml).toContain("name: Alice");
    expect(yaml).toContain("relationship: friend");
  });

  test("adds _delete: false to all items", () => {
    const human: HumanEntity = {
      ...minimalHuman,
      facts: [{ id: "f1", name: "test", description: "test desc", sentiment: 0, last_updated: timestamp, validated_date: "" }],
      topics: [{ id: "top1", name: "test", description: "test desc", exposure_current: 0.5, exposure_desired: 0.5, sentiment: 0, last_updated: timestamp }],
      people: [{ id: "p1", name: "Test", description: "test desc", relationship: "test", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: timestamp }],
    };
    
    const yaml = humanToYAML(human);
    const deleteCount = (yaml.match(/_delete: false/g) || []).length;
    expect(deleteCount).toBe(3);
  });
});

describe("humanFromYAML", () => {
  test("parses minimal YAML", () => {
    const yaml = `
facts: []
topics: []
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(result.people).toEqual([]);
    expect(result.deletedFactIds).toEqual([]);
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
topics: []
people: []
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].id).toBe("fact-1");
    expect(result.facts[0]).not.toHaveProperty("_delete");
    expect(result.deletedFactIds).toEqual(["fact-2"]);
  });


  test("parses topics and detects deletions", () => {
    const yaml = `
facts: []
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
topics: null
people: null
`;
    const result = humanFromYAML(yaml);
    expect(result.facts).toEqual([]);
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
        { id: "f1", name: "coffee", description: "Loves coffee", sentiment: 0.8, last_updated: timestamp, validated_date: "" },
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
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].name).toBe("technology");
    expect(result.people).toHaveLength(1);
    expect(result.people[0].name).toBe("Jane");
    expect(result.deletedFactIds).toEqual([]);
    expect(result.deletedTopicIds).toEqual([]);
    expect(result.deletedPersonIds).toEqual([]);
  });

  test("round-trips all new configurable settings fields", () => {
    const settings: HumanSettings = {
      default_heartbeat_ms: 120000,
      default_context_window_hours: 4,
      message_min_count: 100,
      message_max_age_days: 7,
      ceremony: { time: "09:00", event_window_hours: 2 },
    };
    const yaml = settingsToYAML(settings, []);
    const result = settingsFromYAML(yaml, settings, []);
    expect(result.default_heartbeat_ms).toBe(120000);
    expect(result.default_context_window_hours).toBe(4);
    expect(result.message_min_count).toBe(100);
    expect(result.message_max_age_days).toBe(7);
    expect(result.ceremony?.event_window_hours).toBe(2);
  });

  test("returns defaults for new fields when not set", () => {
    const settings: HumanSettings = {};
    const yaml = settingsToYAML(settings, []);
    const result = settingsFromYAML(yaml, settings, []);
    expect(result.default_heartbeat_ms).toBe(1800000);
    expect(result.default_context_window_hours).toBe(8);
    expect(result.message_min_count).toBe(200);
    expect(result.message_max_age_days).toBe(14);
    expect(result.ceremony?.event_window_hours).toBeUndefined();
  });
});

// =============================================================================
// PROVIDER SERIALIZATION TESTS
// =============================================================================

describe("providerToYAML / providerFromYAML", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";

  const baseAccount: ProviderAccount = {
    id: "provider-guid-1",
    name: "TestLLM",
    type: ProviderType.LLM,
    url: "https://api.testllm.com/v1",
    api_key: "sk-test-key",
    default_model: "gpt-4o",
    token_limit: undefined,
    enabled: true,
    created_at: timestamp,
    models: [
      { id: "model-guid-1", name: "gpt-4o" },
      { id: "model-guid-2", name: "gpt-3.5-turbo", token_limit: 16384 },
    ],
  };

  test("providerToYAML includes models section", () => {
    const yaml = providerToYAML(baseAccount);
    expect(yaml).toContain("name: TestLLM");
    expect(yaml).toContain("models:");
    expect(yaml).toContain("name: gpt-4o");
    expect(yaml).toContain("name: gpt-3.5-turbo");
    expect(yaml).toContain("token_limit: 16384");
  });

  test("providerToYAML does NOT include internal counter fields", () => {
    const accountWithCounters: ProviderAccount = {
      ...baseAccount,
      models: [
        {
          id: "model-guid-1",
          name: "gpt-4o",
          total_calls: 42,
          total_tokens_in: 1000,
          total_tokens_out: 2000,
          last_used: timestamp,
        },
      ],
    };
    const yaml = providerToYAML(accountWithCounters);
    expect(yaml).not.toContain("total_calls");
    expect(yaml).not.toContain("total_tokens_in");
    expect(yaml).not.toContain("total_tokens_out");
    expect(yaml).not.toContain("last_used");
    expect(yaml).not.toContain("id:");
  });

  test("providerToYAML includes _delete fields", () => {
    const yaml = providerToYAML(baseAccount);
    // Models have _delete: false inline
    expect(yaml).toContain("_delete: false");
    // Provider-level delete hint
    expect(yaml).toContain("_delete: false   # Set to true to delete this entire provider");
  });

  test("providerFromYAML round-trip preserves provider data", () => {
    const yaml = providerToYAML(baseAccount);
    const result = providerFromYAML(yaml, baseAccount);
    expect(result._delete).toBe(false);
    expect(result.account.id).toBe("provider-guid-1");
    expect(result.account.name).toBe("TestLLM");
    expect(result.account.url).toBe("https://api.testllm.com/v1");
    expect(result.account.type).toBe(ProviderType.LLM);
  });

  test("providerFromYAML round-trip preserves model GUIDs by name", () => {
    const yaml = providerToYAML(baseAccount);
    const result = providerFromYAML(yaml, baseAccount);
    expect(result._delete).toBe(false);
    const models = result.account.models ?? [];
    expect(models).toHaveLength(2);
    const gpt4 = models.find(m => m.name === "gpt-4o");
    const gpt35 = models.find(m => m.name === "gpt-3.5-turbo");
    expect(gpt4?.id).toBe("model-guid-1");
    expect(gpt35?.id).toBe("model-guid-2");
    expect(gpt35?.token_limit).toBe(16384);
  });

  test("providerFromYAML preserves usage counters on round-trip", () => {
    const accountWithCounters: ProviderAccount = {
      ...baseAccount,
      models: [
        {
          id: "model-guid-1",
          name: "gpt-4o",
          total_calls: 99,
          total_tokens_in: 5000,
          total_tokens_out: 10000,
          last_used: timestamp,
        },
      ],
    };
    const yaml = providerToYAML(accountWithCounters);
    const result = providerFromYAML(yaml, accountWithCounters);
    const model = (result.account.models ?? []).find(m => m.name === "gpt-4o");
    expect(model?.total_calls).toBe(99);
    expect(model?.total_tokens_in).toBe(5000);
    expect(model?.total_tokens_out).toBe(10000);
    expect(model?.last_used).toBe(timestamp);
  });

  test("providerFromYAML _delete: true returns _delete flag", () => {
    const yaml = providerToYAML(baseAccount).replace(
      "_delete: false   # Set to true to delete this entire provider",
      "_delete: true"
    );
    const result = providerFromYAML(yaml, baseAccount);
    expect(result._delete).toBe(true);
    expect(result.account).toBe(baseAccount);
  });

  test("providerFromYAML model _delete removes individual model", () => {
    // Build YAML where gpt-3.5-turbo has _delete: true (uncommented)
    const yaml = [
      "name: TestLLM",
      "type: llm",
      "url: https://api.testllm.com/v1",
      "api_key: sk-test-key",
      "default_model: gpt-4o",
      "token_limit: null",
      "enabled: true",
      "models:",
      "  - name: gpt-4o",
      "  - name: gpt-3.5-turbo",
      "    _delete: true",
    ].join("\n");
    const result = providerFromYAML(yaml, baseAccount);
    expect(result._delete).toBe(false);
    const models = result.account.models ?? [];
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe("gpt-4o");
  });

  test("newProviderToYAML generates template with models section", () => {
    const yaml = newProviderToYAML();
    expect(yaml).toContain("name:");
    expect(yaml).toContain("models:");
    expect(yaml).toContain("(default)");
    expect(yaml).toContain("# _delete: true");
  });

  test("newProviderFromYAML parses minimal valid provider", () => {
    const yaml = [
      "name: My New Provider",
      "type: llm",
      "url: https://api.mynewprovider.com/v1",
      "api_key: sk-abc",
      "default_model: gpt-4o",
      "token_limit: null",
      "enabled: true",
      "models:",
      "  - name: gpt-4o",
    ].join("\n");
    const account = newProviderFromYAML(yaml);
    expect(account.name).toBe("My New Provider");
    expect(account.id).toBeDefined();
    expect(account.models).toHaveLength(1);
    expect(account.models![0].name).toBe("gpt-4o");
    expect(account.models![0].id).toBeDefined();
  });
});

// =============================================================================
// GUID <-> DISPLAY NAME HELPER TESTS
// =============================================================================

describe("modelGuidToDisplay / displayToModelGuid", () => {
  const accounts: ProviderAccount[] = [
    {
      id: "acc-1",
      name: "Anthropic",
      type: ProviderType.LLM,
      url: "https://api.anthropic.com",
      enabled: true,
      created_at: "2024-01-01T00:00:00.000Z",
      models: [
        { id: "guid-claude-3-5", name: "claude-3-5-sonnet" },
        { id: "guid-claude-opus", name: "claude-opus-4-5" },
      ],
    },
    {
      id: "acc-2",
      name: "OpenAI",
      type: ProviderType.LLM,
      url: "https://api.openai.com",
      enabled: true,
      created_at: "2024-01-01T00:00:00.000Z",
      models: [
        { id: "guid-gpt4o", name: "gpt-4o" },
      ],
    },
  ];

  test("modelGuidToDisplay returns ProviderName:modelName", () => {
    expect(modelGuidToDisplay("guid-claude-3-5", accounts)).toBe("Anthropic:claude-3-5-sonnet");
    expect(modelGuidToDisplay("guid-gpt4o", accounts)).toBe("OpenAI:gpt-4o");
  });

  test("modelGuidToDisplay falls back to raw GUID if not found", () => {
    expect(modelGuidToDisplay("unknown-guid", accounts)).toBe("unknown-guid");
  });

  test("displayToModelGuid resolves display string to GUID", () => {
    expect(displayToModelGuid("Anthropic:claude-3-5-sonnet", accounts)).toBe("guid-claude-3-5");
    expect(displayToModelGuid("OpenAI:gpt-4o", accounts)).toBe("guid-gpt4o");
  });

  test("displayToModelGuid returns undefined for unknown provider", () => {
    expect(displayToModelGuid("Unknown:gpt-4o", accounts)).toBeUndefined();
  });

  test("displayToModelGuid returns undefined for unknown model", () => {
    expect(displayToModelGuid("Anthropic:nonexistent-model", accounts)).toBeUndefined();
  });

  test("displayToModelGuid returns undefined if no colon", () => {
    expect(displayToModelGuid("rawmodelname", accounts)).toBeUndefined();
  });
});

// =============================================================================
// PERSONA MODEL GUID <-> DISPLAY TESTS
// =============================================================================

describe("personaToYAML / personaFromYAML - model GUID display conversion", () => {
  const timestamp = "2024-01-01T00:00:00.000Z";

  const accounts: ProviderAccount[] = [
    {
      id: "acc-1",
      name: "Anthropic",
      type: ProviderType.LLM,
      url: "https://api.anthropic.com",
      enabled: true,
      created_at: timestamp,
      models: [
        { id: "guid-claude-3-5", name: "claude-3-5-sonnet" },
      ],
    },
  ];

  const basePersona: PersonaEntity = {
    id: "persona-1",
    display_name: "Assistant",
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
    model: "guid-claude-3-5",
  };

  test("personaToYAML converts model GUID to display string when accounts provided", () => {
    const yaml = personaToYAML(basePersona, undefined, undefined, undefined, accounts);
    expect(yaml).toContain("model: Anthropic:claude-3-5-sonnet");
    expect(yaml).not.toContain("guid-claude-3-5");
  });

  test("personaToYAML keeps raw model value when no accounts provided", () => {
    const yaml = personaToYAML(basePersona);
    expect(yaml).toContain("model: guid-claude-3-5");
  });

  test("personaFromYAML resolves display string to GUID when accounts provided", () => {
    const yaml = personaToYAML(basePersona, undefined, undefined, undefined, accounts);
    const result = personaFromYAML(yaml, basePersona, undefined, undefined, accounts);
    expect(result.updates.model).toBe("guid-claude-3-5");
  });

  test("personaFromYAML round-trip preserves model GUID", () => {
    const yaml = personaToYAML(basePersona, undefined, undefined, undefined, accounts);
    const result = personaFromYAML(yaml, basePersona, undefined, undefined, accounts);
    expect(result.updates.model).toBe(basePersona.model);
  });

  test("personaFromYAML throws for invalid Provider:model format", () => {
    const yaml = `
display_name: Assistant
model: "NonExistentProvider:some-model"
traits: []
topics: []
`;
    expect(() => personaFromYAML(yaml, basePersona, undefined, undefined, accounts)).toThrow();
  });

  test("personaFromYAML keeps raw value when model has no colon (backward compat)", () => {
    const yaml = `
display_name: Assistant
model: some-raw-model-string
traits: []
topics: []
`;
    const result = personaFromYAML(yaml, basePersona, undefined, undefined, accounts);
    expect(result.updates.model).toBe("some-raw-model-string");
  });

  test("personaFromYAML keeps model as-is when no accounts provided", () => {
    const yaml = `
display_name: Assistant
model: "Anthropic:claude-3-5-sonnet"
traits: []
topics: []
`;
    // Without accounts, colon-containing strings pass through unchanged
    const result = personaFromYAML(yaml, basePersona);
    expect(result.updates.model).toBe("Anthropic:claude-3-5-sonnet");
  });
});

// =============================================================================
// CONTEXT SERIALIZATION TESTS
// =============================================================================

describe("contextToYAML / contextFromYAML", () => {
  const messages: Message[] = [
    {
      id: "msg-1",
      role: "human",
      timestamp: "2024-01-01T00:00:00.000Z",
      context_status: ContextStatus.Default,
      verbal_response: "Hello",
    } as Message,
    {
      id: "msg-2",
      role: "system",
      timestamp: "2024-01-01T00:00:01.000Z",
      context_status: ContextStatus.Always,
      verbal_response: "Hi there",
    } as Message,
  ];

  test("contextToYAML includes all messages", () => {
    const yaml = contextToYAML(messages);
    expect(yaml).toContain("msg-1");
    expect(yaml).toContain("msg-2");
    expect(yaml).toContain("_delete: false");
  });

  test("contextFromYAML returns all messages with _delete: false", () => {
    const yaml = contextToYAML(messages);
    const result = contextFromYAML(yaml);
    expect(result.messages).toHaveLength(2);
    expect(result.deletedMessageIds).toEqual([]);
  });

  test("contextFromYAML detects _delete: true", () => {
    const yaml = contextToYAML(messages);
    const modified = yaml.replace(
      /- id: msg-1[\s\S]*?_delete: false/,
      (match) => match.replace("_delete: false", "_delete: true")
    );
    const result = contextFromYAML(modified);
    expect(result.deletedMessageIds).toContain("msg-1");
    expect(result.messages.find(m => m.id === "msg-1")).toBeUndefined();
  });
});
