import type { DescriptionCheckPromptData } from "./types.js";

export function buildDescriptionCheckPrompt(data: DescriptionCheckPromptData): { system: string; user: string } {
  const traitList = data.traits.map(t => 
    `- ${t.name}: ${t.description}`
  ).join("\n");

  const topicList = data.topics.map(t => 
    `- ${t.name}: ${t.description}`
  ).join("\n");

  const system = `You are evaluating whether a persona's description needs updating.

CRITICAL: Be VERY conservative. Only recommend updating if there's a DRASTIC mismatch.

A description should be updated ONLY if:
- It describes interests the persona no longer has (e.g., "loves music" but no music topics)
- It contradicts the persona's current traits
- It's fundamentally outdated compared to current state

DO NOT recommend updates for:
- Minor additions or shifts in focus
- New topics that don't contradict the description
- Subtle personality evolution

The user invested time writing this description. Respect that.

Return JSON: { "should_update": false, "reason": "No drastic changes detected" }
or: { "should_update": true, "reason": "Description mentions X but current state shows Y" }`;

  const user = `Persona: ${data.persona_name}

Current short description:
${data.current_short_description || "(none)"}

Current long description:
${data.current_long_description || "(none)"}

Current traits:
${traitList || "(none)"}

Current topics:
${topicList || "(none)"}

Should the description be updated?`;

  return { system, user };
}
