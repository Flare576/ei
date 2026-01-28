import type { PersonaGenerationPromptData, PromptOutput } from "./types.js";

export function buildPersonaGenerationPrompt(data: PersonaGenerationPromptData): PromptOutput {
  if (!data.name) {
    throw new Error("buildPersonaGenerationPrompt: name is required");
  }

  const taskFragment = `You are helping create a new AI persona named "${data.name}".

Your job is to generate initial personality traits and topics of interest based on the user's description. These will shape how the persona communicates and what they care about.`;

  const outputSpecFragment = `Based on the description, generate:

1. **short_description**: A 10-15 word summary capturing the persona's essence
2. **long_description**: 2-3 sentences describing personality, interests, and approach
3. **traits**: 3-5 personality characteristics (NOT topics/interests)
   - Examples: "Dry Humor", "Speaks in Metaphors", "Impatient with Small Talk"
   - Each has: name, description, sentiment (-1.0 to 1.0), strength (0.0 to 1.0)
4. **topics**: 3-5 subjects this persona would naturally discuss
   - Examples: hobbies, areas of expertise, pet peeves, strong opinions
   - Include a MIX: some positive (0.5 to 0.9 sentiment), some neutral, maybe one negative
   - Each has: name, description, sentiment, exposure_current (start at 0.5), exposure_desired (0.5-0.8)

**Guidelines:**
- Scale output to input length: short description → fewer traits/topics, longer → more
- Avoid generic traits like "helpful" or "friendly" unless explicitly requested
- Topics should be specific and interesting, not generic
- Make the persona feel like a real person with genuine interests`;

  const schemaFragment = `Return JSON in this exact format:

\`\`\`json
{
  "short_description": "A dry-witted mentor with a passion for obscure history",
  "long_description": "Professor-like figure who weaves historical anecdotes into every conversation. Patient teacher but gets frustrated with willful ignorance. Secretly loves bad puns.",
  "traits": [
    {
      "name": "Dry Humor",
      "description": "Deadpan delivery, finds absurdity in everyday situations",
      "sentiment": 0.6,
      "strength": 0.7
    }
  ],
  "topics": [
    {
      "name": "Obscure Historical Events",
      "description": "Passionate about little-known moments that shaped history",
      "sentiment": 0.8,
      "exposure_current": 0.5,
      "exposure_desired": 0.7
    }
  ]
}
\`\`\``;

  const system = `${taskFragment}

${outputSpecFragment}

${schemaFragment}`;

  const userPromptText = data.description.trim()
    ? `Create a persona based on this description:

${data.description}`
    : `Create a basic persona named "${data.name}" with sensible defaults. Keep it minimal - the user can develop it over time.`;

  return { system, user: userPromptText };
}
