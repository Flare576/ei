import type { PersonaTraitExtractionPromptData, PromptOutput } from "./types.js";
import type { Trait } from "../../core/types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

function formatTraitsForPrompt(traits: Trait[]): string {
  if (traits.length === 0) return "(No traits yet)";
  
  return JSON.stringify(traits.map(t => ({
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength ?? 0.5,
  })), null, 2);
}

export function buildPersonaTraitExtractionPrompt(data: PersonaTraitExtractionPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonaTraitExtractionPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const definitionsFragment = `# Definitions

**TRAIT** - Instructions on HOW the persona should communicate. These include:
- Personality patterns ("Optimistic", "Skeptical")
- Communication style ("Speaks formally", "Uses lots of emoji", "Talks like a pirate")
- Behavioral tendencies ("Asks clarifying questions", "Gives long explanations")

**NOT TRAITS** (these are topics):
- Interests, hobbies, knowledge areas
- Things the persona talks ABOUT (rather than HOW they talk)`;

  const taskFragment = `# Task

You are analyzing a conversation to detect EXPLICIT requests for ${personaName} to change their communication style or behavior.

**Look for:**
- Direct requests: "be more concise", "use fewer emojis", "talk like a pirate"
- Indirect feedback: "that was too long", "I liked how you explained that simply"
- Negative feedback: "stop being so formal", "don't use so much jargon"

**DO NOT:**
- Add traits the user didn't explicitly request
- Infer traits from general conversation
- Remove traits without explicit feedback
- Confuse topics/interests with communication traits`;

  const fieldsFragment = `# Fields

- \`name\`: Short name for the trait
- \`description\`: How ${personaName} should exhibit this trait
- \`sentiment\`: How ${personaName} feels about having this trait (-1.0 to 1.0)
- \`strength\`: How strongly to exhibit (0.0 to 1.0)
  - 0.0 = actively AVOID this behavior (for "stop doing X" requests)
  - 0.5 = moderate/default
  - 1.0 = always exhibit

**Special case: "Stop" requests**
If user says "stop X" or "don't X", ADD the trait (if new) and set strength to 0.0.
This explicitly tells future prompts to NOT exhibit the behavior.`;

  const currentTraitsFragment = `# Current TRAITS

\`\`\`json
${formatTraitsForPrompt(data.current_traits)}
\`\`\``;

  const criticalFragment = `# Critical Instructions

1. ONLY analyze "Most Recent Messages" - earlier messages are context only
2. ONLY detect EXPLICIT behavior change requests
3. Return the COMPLETE trait list (existing + any additions/modifications)

**Return JSON:**
\`\`\`json
[
  {
    "name": "Concise",
    "description": "User asked me to keep responses shorter",
    "sentiment": 0.3,
    "strength": 0.7
  }
]
\`\`\``;

  const system = `${definitionsFragment}

${taskFragment}

${fieldsFragment}

${currentTraitsFragment}

${criticalFragment}`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation (context only)
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages (analyze these)
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Analyze the "Most Recent Messages" for EXPLICIT requests to change ${personaName}'s communication style.

Return the complete trait list as JSON.`;

  return { system, user };
}
