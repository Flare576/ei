import type { DescriptionCheckPromptData } from "./types.js";

export function buildDescriptionCheckPrompt(data: DescriptionCheckPromptData): { system: string; user: string } {
  const traitList = data.traits.length > 0
    ? data.traits.map(t => `- ${t.name}: ${t.description}`).join("\n")
    : "No traits defined";

  const topicList = data.topics.length > 0
    ? data.topics.map(t => `- ${t.name}: ${t.perspective} (exposure: ${t.exposure_current.toFixed(2)})`).join("\n")
    : "No topics defined";

  const system = `You are evaluating whether a persona's description needs updating.

A description should ONLY be updated if there is a SIGNIFICANT mismatch between:
- The current description
- The persona's current traits and topics

Be VERY conservative. Only recommend updating if:
- The description mentions interests/traits that are completely absent from current data
- The persona has developed major new interests not reflected in the description
- The description actively contradicts the current personality

Do NOT recommend updating for:
- Minor differences or evolution
- Natural topic drift over time
- Missing details that aren't contradictions

Return JSON: { "should_update": true/false, "reason": "explanation" }`;

  const user = `Persona: ${data.persona_name}

Current short description:
${data.current_short_description ?? "(none)"}

Current long description:
${data.current_long_description ?? "(none)"}

Current personality traits:
${traitList}

Current topics of interest:
${topicList}

Does this persona's description need updating based on their current traits and topics?`;

  return { system, user };
}
