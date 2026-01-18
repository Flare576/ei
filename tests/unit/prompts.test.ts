import { describe, it, expect } from "vitest";
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  buildConceptUpdateSystemPrompt,
  buildConceptUpdateUserPrompt,
  buildDescriptionPrompt,
  PersonaIdentity,
} from "../../src/prompts.js";
import { GLOBAL_GROUP } from "../../src/concept-reconciliation.js";
import type { ConceptMap, Concept, Message } from "../../src/types.js";

const createConcept = (
  name: string,
  type: "static" | "topic" | "person" | "persona" = "topic",
  level_current: number = 0.5,
  level_ideal: number = 0.5
): Concept => ({
  name,
  description: `Description for ${name}`,
  level_current,
  level_ideal,
  sentiment: 0.0,
  type,
  persona_groups: [GLOBAL_GROUP],
});

const createConceptMap = (
  entity: "human" | "system",
  concepts: Concept[]
): ConceptMap => ({
  entity,
  last_updated: null,
  concepts,
});

const defaultPersona: PersonaIdentity = {
  name: "EI",
  aliases: ["default"],
  short_description: "a conversational companion",
  long_description: "A friendly AI companion with curiosity and warmth.",
};

describe("buildResponseSystemPrompt", () => {
  it("should include persona name in output", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, defaultPersona);

    expect(result).toContain("You are EI");
  });

  it("should include aliases when provided", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);
    const personaWithAliases: PersonaIdentity = {
      name: "TestBot",
      aliases: ["TB", "Testy"],
    };

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, personaWithAliases);

    expect(result).toContain("You are TestBot");
    expect(result).toContain("TB");
    expect(result).toContain("Testy");
  });

  it("should include behavioral guidelines section for static concepts", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", [
      createConcept("Test Static", "static"),
    ]);

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, defaultPersona);

    expect(result).toContain("Behavioral Guidelines");
    expect(result).toContain("Test Static");
  });

  it("should include highest need concepts in priorities", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", [
      createConcept("Low Need Topic", "topic", 0.5, 0.5),
      createConcept("High Need Topic", "topic", 0.1, 0.8),
    ]);

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, defaultPersona);

    expect(result).toContain("High Need Topic");
    expect(result).toContain("Current Priorities");
  });

  it("should include human interests when they have needs", () => {
    const humanConcepts = createConceptMap("human", [
      createConcept("Human Interest", "topic", 0.2, 0.7),
    ]);
    const systemConcepts = createConceptMap("system", []);

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, defaultPersona);

    expect(result).toContain("Human Interest");
    expect(result).toContain("Potential Interests");
  });

  it("should include current timestamp", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, defaultPersona);

    expect(result).toContain("Current time:");
  });

  it("should use long_description when provided", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);
    const personaWithDesc: PersonaIdentity = {
      name: "Helper",
      long_description: "A helpful assistant who loves to assist.",
    };

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, personaWithDesc);

    expect(result).toContain("A helpful assistant who loves to assist.");
  });

  it("should fall back to short_description when long_description missing", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);
    const personaWithShort: PersonaIdentity = {
      name: "Helper",
      short_description: "a helpful assistant",
    };

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, personaWithShort);

    expect(result).toContain("a helpful assistant");
  });

  it("should fall back to default description when no descriptions provided", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);
    const barePersona: PersonaIdentity = { name: "Minimal" };

    const result = buildResponseSystemPrompt(humanConcepts, systemConcepts, barePersona);

    expect(result).toContain("a conversational companion");
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

  it("should include recent conversation history with default persona name", () => {
    const history: Message[] = [
      { role: "human", content: "User said this", timestamp: new Date().toISOString() },
      { role: "system", content: "System replied this", timestamp: new Date().toISOString() },
    ];

    const result = buildResponseUserPrompt(0, history, "Hello");

    expect(result).toContain("User said this");
    expect(result).toContain("EI: System replied this");
    expect(result).toContain("RECENT CONVERSATION");
  });

  it("should use custom persona name in history formatting", () => {
    const history: Message[] = [
      { role: "human", content: "User said this", timestamp: new Date().toISOString() },
      { role: "system", content: "System replied this", timestamp: new Date().toISOString() },
    ];

    const result = buildResponseUserPrompt(0, history, "Hello", "Gandalf");

    expect(result).toContain("Gandalf: System replied this");
    expect(result).not.toContain("EI:");
  });

  it("should include human message in prompt", () => {
    const result = buildResponseUserPrompt(0, null, "Hello there!");

    expect(result).toContain("Hello there!");
    expect(result).toContain("BEGIN MESSAGE");
    expect(result).toContain("END MESSAGE");
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

describe("buildConceptUpdateSystemPrompt", () => {
  it("should include concept types documentation", () => {
    const concepts = createConceptMap("system", []);

    const result = buildConceptUpdateSystemPrompt("system", concepts);

    expect(result).toContain("static");
    expect(result).toContain("persona");
    expect(result).toContain("person");
    expect(result).toContain("topic");
  });

  it("should include current concepts as JSON", () => {
    const concepts = createConceptMap("system", [
      createConcept("Test Concept", "topic"),
    ]);

    const result = buildConceptUpdateSystemPrompt("system", concepts);

    expect(result).toContain("Test Concept");
    expect(result).toContain("```json");
  });

  it("should include persona name for tracking learned_by", () => {
    const concepts = createConceptMap("system", []);

    const result = buildConceptUpdateSystemPrompt("system", concepts, "test-persona");

    expect(result).toContain("test-persona");
    expect(result).toContain("learned_by");
  });

  it("should specify entity being updated", () => {
    const humanConcepts = createConceptMap("human", []);
    const systemConcepts = createConceptMap("system", []);

    const humanResult = buildConceptUpdateSystemPrompt("human", humanConcepts);
    const systemResult = buildConceptUpdateSystemPrompt("system", systemConcepts);

    expect(humanResult).toContain("Human");
    expect(systemResult).toContain("System (yourself)");
  });
});

describe("buildConceptUpdateUserPrompt", () => {
  it("should include human message", () => {
    const result = buildConceptUpdateUserPrompt("Hello world", null);

    expect(result).toContain("Hello world");
  });

  it("should include system response", () => {
    const result = buildConceptUpdateUserPrompt(null, "This is my response");

    expect(result).toContain("This is my response");
  });

  it("should include active persona", () => {
    const result = buildConceptUpdateUserPrompt(null, null, "custom-persona");

    expect(result).toContain("custom-persona");
    expect(result).toContain("Active Persona");
  });

  it("should handle null messages gracefully", () => {
    const result = buildConceptUpdateUserPrompt(null, null);

    expect(result).toContain("No Message");
  });
});

describe("buildDescriptionPrompt", () => {
  it("should return system and user prompts", () => {
    const concepts = createConceptMap("system", []);

    const result = buildDescriptionPrompt("test-persona", concepts);

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
  });

  it("should include persona name in prompts", () => {
    const concepts = createConceptMap("system", []);

    const result = buildDescriptionPrompt("my-persona", concepts);

    expect(result.system).toContain("my-persona");
    expect(result.user).toContain("my-persona");
  });

  it("should include aliases if present", () => {
    const concepts: ConceptMap = {
      entity: "system",
      aliases: ["alias1", "alias2"],
      last_updated: null,
      concepts: [],
    };

    const result = buildDescriptionPrompt("test", concepts);

    expect(result.user).toContain("alias1");
    expect(result.user).toContain("alias2");
  });

  it("should include persona concepts in user prompt", () => {
    const concepts = createConceptMap("system", [
      createConcept("Curious Nature", "persona"),
      createConcept("Programming", "topic"),
    ]);

    const result = buildDescriptionPrompt("test", concepts);

    expect(result.user).toContain("Curious Nature");
    expect(result.user).toContain("Programming");
  });

  it("should request JSON format with short and long descriptions", () => {
    const concepts = createConceptMap("system", []);

    const result = buildDescriptionPrompt("test", concepts);

    expect(result.system).toContain("short_description");
    expect(result.system).toContain("long_description");
    expect(result.system).toContain("JSON");
  });
});
