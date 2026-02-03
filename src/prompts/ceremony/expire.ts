import type { PersonaExpirePromptData } from "./types.js";

export function buildPersonaExpirePrompt(data: PersonaExpirePromptData): { system: string; user: string } {
  const topicList = data.topics.map(t => {
    const display = t.perspective || t.name;
    return `- "${t.name}" (exposure: ${t.exposure_current.toFixed(2)}, sentiment: ${t.sentiment.toFixed(2)})\n  Perspective: ${display}`;
  }).join("\n");

  const system = `You are evaluating which topics a persona should stop caring about.

A topic should be removed if:
- Its exposure_current is very low (< 0.15) indicating prolonged disinterest
- It no longer aligns with the persona's current interests
- It was a temporary interest that has faded

Be conservative - only suggest removing topics that are clearly irrelevant.
If unsure, keep the topic.

Return JSON: { "topic_ids_to_remove": ["id1", "id2"] }
Return empty array if no topics should be removed.`;

  const user = `Persona: ${data.persona_name}

Current topics:
${topicList}

Which topics, if any, should this persona stop caring about?`;

  return { system, user };
}
