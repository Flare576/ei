import type { PersonaTopicExplorationPromptData, PromptOutput } from "./types.js";
import type { Trait, Topic } from "../../core/types.js";

function formatTraitsForPrompt(traits: Trait[]): string {
  if (traits.length === 0) return "(No traits defined)";
  
  return traits.map(t => {
    const strength = t.strength !== undefined ? ` (strength: ${t.strength.toFixed(1)})` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join('\n');
}

function formatTopicsForPrompt(topics: Topic[]): string {
  if (topics.length === 0) return "(No topics yet - wide open for exploration!)";
  
  return topics.map(t => `- **${t.name}**: ${t.description}`).join('\n');
}

export function buildPersonaTopicExplorationPrompt(data: PersonaTopicExplorationPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonaTopicExplorationPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const taskFragment = `# Task

You are exploring what NEW topics ${personaName} might be interested in, based on their identity.

**This is GENERATIVE** - you're discovering natural extensions of their interests, not detecting what was discussed.

## Goal

Identify 0-2 NEW topics that:
- Connect naturally to ${personaName}'s identity/traits
- Feel like organic extensions of existing topics
- Would make conversations more interesting
- Are specific and engaging, not generic

## Guardrails

**Be CONSERVATIVE:**
- Maximum 0-2 new topics
- Topics must tie strongly to identity
- Must feel natural, not forced
- If nothing fits well, return empty array

**DO NOT add:**
- Topics only relevant to the human
- Generic topics with no identity connection
- Variants of existing topics (check the list!)`;

  const identityFragment = `# ${personaName}'s Identity

## Description
${data.short_description || "(No short description)"}

${data.long_description || "(No long description)"}

## Traits
${formatTraitsForPrompt(data.traits)}`;

  const existingTopicsFragment = `# Existing Topics

${personaName} already knows about these - do NOT duplicate:

${formatTopicsForPrompt(data.current_topics)}`;

  const fieldsFragment = `# Fields for New Topics

- \`name\`: Short identifier
- \`description\`: Why ${personaName} would care, connection to identity
- \`sentiment\`: How they'd feel about it (-1.0 to 1.0), inferred from identity
- \`exposure_current\`: Start at 0.0 (not discussed yet)
- \`exposure_desired\`: Based on identity (0.3-0.8 typical range)`;

  const criticalFragment = `# Critical Instructions

1. EXPLORATION ONLY - discovering what ${personaName} SHOULD care about
2. Maximum 2 new topics - quality over quantity
3. Return ONLY new topics (do NOT include existing)
4. If no good fits, return empty array: \`[]\`

**Return JSON:**
\`\`\`json
[
  {
    "name": "Indie Game Development",
    "description": "Natural connection to gaming interest and creative trait",
    "sentiment": 0.8,
    "exposure_current": 0.0,
    "exposure_desired": 0.7
  }
]
\`\`\``;

  const system = `${taskFragment}

${identityFragment}

${existingTopicsFragment}

${fieldsFragment}

${criticalFragment}`;

  const user = `Based on ${personaName}'s identity and existing topics, propose 0-2 NEW topics that would be natural extensions of their interests.

Return ONLY new topics as JSON (or empty array if no good fits).`;

  return { system, user };
}
