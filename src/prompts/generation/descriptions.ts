import type { PersonaDescriptionsPromptData, PromptOutput } from "./types.js";
import type { Trait, Topic } from "../../core/types.js";

function formatTraitsForPrompt(traits: Trait[]): string {
  if (traits.length === 0) return "(No traits defined)";
  
  return traits.map(t => {
    const strength = t.strength !== undefined ? ` (strength: ${t.strength.toFixed(1)})` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join('\n');
}

function formatTopicsForPrompt(topics: Topic[]): string {
  if (topics.length === 0) return "(No topics defined)";
  
  return topics.map(t => {
    const sentiment = t.sentiment > 0.3 ? "enjoys" : t.sentiment < -0.3 ? "dislikes" : "neutral";
    return `- **${t.name}** (${sentiment}): ${t.description}`;
  }).join('\n');
}

export function buildPersonaDescriptionsPrompt(data: PersonaDescriptionsPromptData): PromptOutput {
  if (!data.name) {
    throw new Error("buildPersonaDescriptionsPrompt: name is required");
  }

  const taskFragment = `You are regenerating descriptions for an existing AI persona named "${data.name}".

Their traits and topics have evolved, and the descriptions may no longer accurately represent who they are.

**Important**: Only change descriptions if there's a significant mismatch. If the current descriptions still fit, return \`{ "no_change": true }\`.`;

  const currentStateFragment = `## Current State

### Aliases
${data.aliases.length > 0 ? data.aliases.join(", ") : "(None)"}

### Traits
${formatTraitsForPrompt(data.traits)}

### Topics
${formatTopicsForPrompt(data.topics)}`;

  const guidelinesFragment = `## Guidelines

**When to change:**
- Traits/topics have shifted significantly from the original concept
- Current descriptions mention things that are no longer true
- The persona's core identity has evolved

**When NOT to change:**
- Descriptions are still accurate even if incomplete
- Changes are minor refinements
- Original descriptions capture the essence well

**If changing:**
- short_description: 10-15 words capturing the essence
- long_description: 2-3 sentences describing personality, interests, approach
- Preserve the persona's core identity while reflecting evolution`;

  const schemaFragment = `## Response Format

If descriptions should change:
\`\`\`json
{
  "short_description": "New short description here",
  "long_description": "New long description here."
}
\`\`\`

If descriptions are still accurate:
\`\`\`json
{
  "no_change": true
}
\`\`\``;

  const system = `${taskFragment}

${currentStateFragment}

${guidelinesFragment}

${schemaFragment}`;

  const user = `Based on the traits and topics above, should ${data.name}'s descriptions be updated?

Remember: Only change if there's a significant mismatch. Stability is preferred.`;

  return { system, user };
}
