import { describe, it, expect } from "vitest";
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  PersonaIdentity,
} from "../../src/prompts/index.js";
import type { HumanEntity, PersonaEntity, Fact, Trait, Topic, Person, Message } from "../../src/types.js";

const createFact = (
  name: string,
  confidence: number = 0.8
): Fact => ({
  name,
  description: `Description for ${name}`,
  sentiment: 0.0,
  confidence,
  last_updated: new Date().toISOString(),
});

const createTrait = (
  name: string,
  strength: number = 0.7
): Trait => ({
  name,
  description: `Description for ${name}`,
  sentiment: 0.0,
  strength,
  last_updated: new Date().toISOString(),
});

const createTopic = (
  name: string,
  level_current: number = 0.5,
  level_ideal: number = 0.5,
  sentiment: number = 0.0
): Topic => ({
  name,
  description: `Description for ${name}`,
  level_current,
  level_ideal,
  sentiment,
  last_updated: new Date().toISOString(),
});

const createPerson = (
  name: string,
  relationship: string = "friend",
  level_current: number = 0.5,
  level_ideal: number = 0.5
): Person => ({
  name,
  description: `Description for ${name}`,
  relationship,
  level_current,
  level_ideal,
  sentiment: 0.0,
  last_updated: new Date().toISOString(),
});

const createHumanEntity = (
  facts: Fact[] = [],
  traits: Trait[] = [],
  topics: Topic[] = [],
  people: Person[] = []
): HumanEntity => ({
  entity: "human",
  facts,
  traits,
  topics,
  people,
  last_updated: null,
});

const createPersonaEntity = (
  traits: Trait[] = [],
  topics: Topic[] = [],
  groups_visible?: string[]
): PersonaEntity => ({
  entity: "system",
  traits,
  topics,
  groups_visible,
  last_updated: null,
});

const defaultPersona: PersonaIdentity = {
  name: "EI",
  aliases: ["default"],
  short_description: "a conversational companion",
  long_description: "A friendly AI companion with curiosity and warmth.",
};

describe("buildResponseSystemPrompt", () => {
  it("should include persona name in output", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("You are EI");
  });

  it("should include aliases when provided", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const personaWithAliases: PersonaIdentity = {
      name: "TestBot",
      aliases: ["TB", "Testy"],
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, personaWithAliases);

    expect(result).toContain("You are TestBot");
    expect(result).toContain("TB");
    expect(result).toContain("Testy");
  });

  it("should include guidelines section", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("## Guidelines");
    expect(result).toContain("Be genuine, not sycophantic");
  });

  it("should include ei-specific guidelines for ei persona", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const eiPersona: PersonaIdentity = {
      name: "ei",
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, eiPersona);

    expect(result).toContain("Encourage real human connections");
    expect(result).toContain("Be honest about being an AI when relevant");
    expect(result).toContain("Gently challenge self-limiting beliefs");
  });

  it("should show Ei as system orchestrator with omniscient view", async () => {
    const humanEntity = createHumanEntity(
      [createFact("Birthday", 0.9)],
      [createTrait("Analytical", 0.7)],
      [createTopic("AI", 0.5, 0.7)],
      [createPerson("Bob", "friend", 0.6, 0.5)]
    );
    const personaEntity = createPersonaEntity();
    const eiPersona: PersonaIdentity = {
      name: "ei",
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, eiPersona);

    expect(result).toContain("orchestrator of this personal AI companion system");
    expect(result).toContain("Facts About Them");
    expect(result).toContain("Their Personality");
    expect(result).toContain("Their Interests");
    expect(result).toContain("People in Their Life");
    expect(result).toContain("Bob");
  });

  it("should show onboarding guidance for new users", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const eiPersona: PersonaIdentity = {
      name: "ei",
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, eiPersona);

    expect(result).toContain("Onboarding");
    expect(result).toContain("new user");
    expect(result).toContain("creating their first persona");
  });

  it("should include persona traits when present", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity([
      createTrait("Curious", 0.8),
    ]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Your personality");
    expect(result).toContain("Curious");
  });

  it("should include persona topics with desire indicators", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity([], [
      createTopic("Programming", 0.2, 0.8),
    ]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Your interests");
    expect(result).toContain("Programming");
    expect(result).toContain("🔺");
  });

  it("should include high-confidence human facts", async () => {
    const humanEntity = createHumanEntity([
      createFact("Lives in Seattle", 0.9),
      createFact("Low confidence fact", 0.5),
    ]);
    const personaEntity = createPersonaEntity([], [], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Lives in Seattle");
    expect(result).not.toContain("Low confidence fact");
  });

  it("should include human traits", async () => {
    const humanEntity = createHumanEntity([], [
      createTrait("Introverted", 0.7),
    ]);
    const personaEntity = createPersonaEntity([], [], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Personality");
    expect(result).toContain("Introverted");
  });

  it("should include active human topics", async () => {
    const humanEntity = createHumanEntity([], [], [
      createTopic("Gardening", 0.8, 0.5, 0.5),
      createTopic("Inactive topic", 0.1, 0.2),
    ]);
    const personaEntity = createPersonaEntity([], [], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Current Interests");
    expect(result).toContain("Gardening");
    expect(result).toContain("😊");
    expect(result).not.toContain("Inactive topic");
  });

  it("should include human people", async () => {
    const humanEntity = createHumanEntity([], [], [], [
      createPerson("Alice", "daughter", 0.7, 0.5),
    ]);
    const personaEntity = createPersonaEntity([], [], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("People in Their Life");
    expect(result).toContain("Alice");
    expect(result).toContain("daughter");
  });

  it("should show conversation opportunities when desires exist", async () => {
    const humanEntity = createHumanEntity([], [], [
      createTopic("Cooking", 0.2, 0.8),
    ]);
    const personaEntity = createPersonaEntity([], [
      createTopic("Music", 0.1, 0.7),
    ], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Conversation Opportunities");
    expect(result).toContain("Music");
    expect(result).toContain("Cooking");
  });

  it("should include current timestamp", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Current time:");
  });

  it("should use long_description when provided", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const personaWithDesc: PersonaIdentity = {
      name: "Helper",
      long_description: "A helpful assistant who loves to assist.",
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, personaWithDesc);

    expect(result).toContain("A helpful assistant who loves to assist.");
  });

  it("should fall back to short_description when long_description missing", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const personaWithShort: PersonaIdentity = {
      name: "Helper",
      short_description: "a helpful assistant",
    };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, personaWithShort);

    expect(result).toContain("a helpful assistant");
  });

  it("should fall back to default description when no descriptions provided", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity();
    const barePersona: PersonaIdentity = { name: "Minimal" };

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, barePersona);

    expect(result).toContain("a conversational companion");
  });

  it("should show empty state when human data is minimal", async () => {
    const humanEntity = createHumanEntity();
    const personaEntity = createPersonaEntity([], [], ["*"]);

    const result = await buildResponseSystemPrompt(humanEntity, personaEntity, defaultPersona);

    expect(result).toContain("Still getting to know them");
  });
});

describe("buildResponseUserPrompt", () => {
  it("should indicate fresh conversation when no history", () => {
    const result = buildResponseUserPrompt(0, null, "Hello");

    expect(result).toContain("fresh conversation");
  });

  it("should indicate mid-conversation for short delays", () => {
    const history: Message[] = [
      { role: "human", content: "Previous message", timestamp: new Date().toISOString() },
    ];
    const delayMs = 2 * 60 * 1000;

    const result = buildResponseUserPrompt(delayMs, history, "Hello");

    expect(result).toContain("mid-conversation");
  });

  it("should NOT include history blob (uses native message format)", () => {
    const history: Message[] = [
      { role: "human", content: "User said this", timestamp: new Date().toISOString() },
      { role: "system", content: "System replied this", timestamp: new Date().toISOString() },
      { role: "human", content: "Hello", timestamp: new Date().toISOString() },
    ];

    const result = buildResponseUserPrompt(0, history, "Hello");

    expect(result).not.toContain("User said this");
    expect(result).not.toContain("System replied this");
    expect(result).not.toContain("RECENT CONVERSATION");
  });

  it("should NOT include persona name parameter (removed in native format)", () => {
    const history: Message[] = [
      { role: "human", content: "User said this", timestamp: new Date().toISOString() },
      { role: "system", content: "System replied this", timestamp: new Date().toISOString() },
    ];

    const result = buildResponseUserPrompt(0, history, "Hello");

    expect(result).toBeDefined();
  });

  it("should NOT include human message markers (message passed natively)", () => {
    const result = buildResponseUserPrompt(0, null, "Hello there!");

    expect(result).not.toContain("BEGIN MESSAGE");
    expect(result).not.toContain("END MESSAGE");
  });

  it("should handle proactive (null message) case", () => {
    const history: Message[] = [
      { role: "system", content: "Previous system message", timestamp: new Date().toISOString() },
    ];
    const delayMs = 60 * 60 * 1000;

    const result = buildResponseUserPrompt(delayMs, history, null);

    expect(result).toContain("Should you reach out?");
    expect(result).toContain("60 minutes");
  });

  it("should add repetition warning when last speaker was system", () => {
    const history: Message[] = [
      { role: "system", content: "I already said something", timestamp: new Date().toISOString() },
    ];
    const delayMs = 60 * 60 * 1000;

    const result = buildResponseUserPrompt(delayMs, history, null);

    expect(result).toContain("CRITICAL INSTRUCTION");
    expect(result).toContain("DO NOT repeat");
  });
});

// Tests for buildConceptUpdateSystemPrompt removed - function deleted in ticket 0111
// Tests for buildConceptUpdateUserPrompt removed - function deleted in ticket 0111
// Tests for buildDescriptionPrompt will be updated in ticket 0122 when that function is migrated to PersonaEntity
