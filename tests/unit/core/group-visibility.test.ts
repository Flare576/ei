import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  ValidationLevel,
  type LLMResponse,
  type LLMRequest,
  type Message,
  type HumanEntity,
  type PersonaEntity,
  type Fact,
  type Trait,
  type Topic,
  type Person,
  type Quote,
} from "../../../src/core/types.js";

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueItemMatch: vi.fn(),
  queueItemUpdate: vi.fn(),
}));

vi.mock("../../../src/prompts/validation/index.js", () => ({
  buildEiValidationPrompt: vi.fn().mockReturnValue({ system: "sys", user: "usr" }),
}));

import { handlers } from "../../../src/core/handlers/index.js";

function createMockStateManager(options: {
  human?: Partial<HumanEntity>;
  personas?: Record<string, Partial<PersonaEntity>>;
} = {}) {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    ...options.human,
  };

  const personas: Record<string, PersonaEntity> = {};
  for (const [name, partial] of Object.entries(options.personas ?? {})) {
    personas[name] = {
      id: `${name.toLowerCase()}-id`,
      display_name: name,
      entity: "system",
      aliases: [name],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      ...partial,
    } as PersonaEntity;
  }

  const messages: Record<string, Message[]> = {};

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => {
      const idx = human.facts.findIndex(f => f.id === fact.id);
      if (idx >= 0) human.facts[idx] = fact;
      else human.facts.push(fact);
    }),
    human_trait_upsert: vi.fn((trait: Trait) => {
      const idx = human.traits.findIndex(t => t.id === trait.id);
      if (idx >= 0) human.traits[idx] = trait;
      else human.traits.push(trait);
    }),
    human_topic_upsert: vi.fn((topic: Topic) => {
      const idx = human.topics.findIndex(t => t.id === topic.id);
      if (idx >= 0) human.topics[idx] = topic;
      else human.topics.push(topic);
    }),
    human_person_upsert: vi.fn((person: Person) => {
      const idx = human.people.findIndex(p => p.id === person.id);
      if (idx >= 0) human.people[idx] = person;
      else human.people.push(person);
    }),
    human_quote_add: vi.fn((quote: Quote) => human.quotes.push(quote)),
    human_quote_update: vi.fn(),
    human_quote_getForMessage: vi.fn(() => []),
    persona_getById: vi.fn((id: string) => Object.values(personas).find(p => p.id === id) ?? null),
    persona_getByName: vi.fn((name: string) => Object.values(personas).find(p => p.display_name === name || p.aliases?.includes(name)) ?? null),
    persona_add: vi.fn((entity: PersonaEntity) => { personas[entity.id] = entity; }),
    persona_update: vi.fn(),
    messages_get: vi.fn((name: string) => messages[name] ?? []),
    queue_enqueue: vi.fn(),
    queue_clearValidations: vi.fn(),
    _human: human,
    _personas: personas,
  };
}

function createItemUpdateResponse(options: {
  personaId: string;
  personaDisplayName: string;
  candidateType: "fact" | "trait" | "topic" | "person";
  isNewItem: boolean;
  existingItemId?: string;
  result: Record<string, unknown>;
}): LLMResponse {
  return {
    success: true,
    content: JSON.stringify(options.result),
    parsed: options.result,
    request: {
      id: "req-1",
      created_at: new Date().toISOString(),
      attempts: 1,
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      system: "",
      user: "",
      next_step: LLMNextStep.HandleHumanItemUpdate,
      data: {
        personaId: options.personaId,
        personaDisplayName: options.personaDisplayName,
        candidateType: options.candidateType,
        isNewItem: options.isNewItem,
        existingItemId: options.existingItemId,
      },
    },
  };
}

describe("Group Visibility", () => {
  describe("handleHumanItemUpdate - group merging", () => {
    it("new item gets persona's group_primary", async () => {
      const state = createMockStateManager({
        personas: {
          Frodo: { group_primary: "Fellowship", groups_visible: ["General"] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "frodo-id",
    personaDisplayName: "Frodo",
        candidateType: "trait",
        isNewItem: true,
        result: {
          name: "Brave",
          description: "Shows courage",
          sentiment: 0.8,
          strength: 0.7,
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      expect(state.human_trait_upsert).toHaveBeenCalled();
      const trait = state.human_trait_upsert.mock.calls[0][0];
      expect(trait.persona_groups).toEqual(["Fellowship"]);
      expect(trait.learned_by).toBe("Frodo");
    });

    it("existing item gets persona's group added to existing groups", async () => {
      const existingTrait: Trait = {
        id: "trait-1",
        name: "Curious",
        description: "Asks questions",
        sentiment: 0.5,
        strength: 0.6,
        last_updated: new Date().toISOString(),
        learned_by: "Frodo",
        persona_groups: ["Fellowship"],
      };

      const state = createMockStateManager({
        human: { traits: [existingTrait] },
        personas: {
          Hermit: { group_primary: "Hermit", groups_visible: [] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "hermit-id",
        personaDisplayName: "Hermit",
        candidateType: "trait",
        isNewItem: false,
        existingItemId: "trait-1",
        result: {
          name: "Curious",
          description: "Asks deep questions about existence",
          sentiment: 0.6,
          strength: 0.7,
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      expect(state.human_trait_upsert).toHaveBeenCalled();
      const trait = state.human_trait_upsert.mock.calls[0][0];
      expect(trait.persona_groups).toContain("Fellowship");
      expect(trait.persona_groups).toContain("Hermit");
      expect(trait.persona_groups).toHaveLength(2);
      expect(trait.learned_by).toBe("Frodo");
    });

    it("does not duplicate groups when persona's group already exists", async () => {
      const existingTrait: Trait = {
        id: "trait-1",
        name: "Wise",
        description: "Shows wisdom",
        sentiment: 0.7,
        strength: 0.8,
        last_updated: new Date().toISOString(),
        persona_groups: ["Fellowship", "General"],
      };

      const state = createMockStateManager({
        human: { traits: [existingTrait] },
        personas: {
          Frodo: { group_primary: "Fellowship", groups_visible: ["General"] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "frodo-id",
        personaDisplayName: "Frodo",
        candidateType: "trait",
        isNewItem: false,
        existingItemId: "trait-1",
        result: {
          name: "Wise",
          description: "Shows great wisdom in difficult times",
          sentiment: 0.8,
          strength: 0.9,
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      const trait = state.human_trait_upsert.mock.calls[0][0];
      expect(trait.persona_groups).toEqual(["Fellowship", "General"]);
    });

    it("Ei updates preserve existing groups (Ei has no primary group effect)", async () => {
      const existingFact: Fact = {
        id: "fact-1",
        name: "Name",
        description: "User's name is Jeremy",
        sentiment: 0.5,
        validated: ValidationLevel.None,
        validated_date: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        persona_groups: ["Fellowship"],
      };

      const state = createMockStateManager({
        human: { facts: [existingFact] },
        personas: {
          Ei: { id: "ei", aliases: ["Ei"], group_primary: null, groups_visible: [] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "ei",
        personaDisplayName: "Ei",
        candidateType: "fact",
        isNewItem: false,
        existingItemId: "fact-1",
        result: {
          name: "Name",
          description: "User's name is Jeremy Scherer",
          sentiment: 0.6,
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      const fact = state.human_fact_upsert.mock.calls[0][0];
      // Ei has no group_primary (null), so existing groups are preserved unchanged
      // mergeGroups returns existing when personaGroup is null
      expect(fact.persona_groups).toEqual(["Fellowship"]);
    });
  });

  describe("handleHumanItemUpdate - topics and people with exposure", () => {
    it("new topic gets correct group and exposure fields", async () => {
      const state = createMockStateManager({
        personas: {
          Hermit: { group_primary: "Hermit", groups_visible: [] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "hermit-id",
        personaDisplayName: "Hermit",
        candidateType: "topic",
        isNewItem: true,
        result: {
          name: "Solitude",
          description: "The value of being alone",
          sentiment: 0.9,
          exposure_desired: 0.8,
          exposure_impact: "high",
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      const topic = state.human_topic_upsert.mock.calls[0][0];
      expect(topic.persona_groups).toEqual(["Hermit"]);
      expect(topic.exposure_desired).toBe(0.8);
      expect(topic.learned_by).toBe("Hermit");
    });

    it("new person gets correct group and relationship", async () => {
      const state = createMockStateManager({
        personas: {
          Frodo: { group_primary: "Fellowship", groups_visible: ["General"] },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "frodo-id",
        personaDisplayName: "Frodo",
        candidateType: "person",
        isNewItem: true,
        result: {
          name: "Samwise",
          description: "A loyal friend",
          sentiment: 0.95,
          relationship: "Best Friend",
          exposure_desired: 0.7,
        },
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      const person = state.human_person_upsert.mock.calls[0][0];
      expect(person.persona_groups).toEqual(["Fellowship"]);
      expect(person.relationship).toBe("Best Friend");
      expect(person.learned_by).toBe("Frodo");
    });
  });

  describe("empty result handling", () => {
    it("does not upsert when result is empty object", async () => {
      const state = createMockStateManager({
        personas: {
          Frodo: { group_primary: "Fellowship" },
        },
      });

      const response = createItemUpdateResponse({
        personaId: "frodo-id",
    personaDisplayName: "Frodo",
        candidateType: "trait",
        isNewItem: true,
        result: {},
      });

      await handlers[LLMNextStep.HandleHumanItemUpdate](response, state as any);

      expect(state.human_trait_upsert).not.toHaveBeenCalled();
    });
  });
});
