import type { PersonaExplorePromptData } from "./types.js";

export function buildPersonaExplorePrompt(data: PersonaExplorePromptData): { system: string; user: string } {
  const traitList = data.traits.map(t => 
    `- ${t.name}: ${t.description} (strength: ${t.strength?.toFixed(2) ?? "N/A"})`
  ).join("\n");

  const topicList = data.remaining_topics.map(t => 
    `- ${t.name}: ${t.perspective || t.name}`
  ).join("\n");

  const themeList = data.recent_conversation_themes.length > 0
    ? data.recent_conversation_themes.map(t => `- ${t}`).join("\n")
    : "No recent themes identified";

  const system = `You are generating new conversation topics for a persona.

Topics should:
- Align with the persona's traits and personality
- Complement (not duplicate) existing topics
- Be natural extensions of recent conversation themes
- Be specific enough to drive interesting conversations

Generate 1-3 new topics that this persona would genuinely care about.

Return JSON:
{
  "new_topics": [{
    "name": "Topic Name",
    "perspective": "The persona's view or opinion on this topic",
    "approach": "How they prefer to engage with this topic",
    "personal_stake": "Why this topic matters to them personally",
    "sentiment": 0.5,
    "exposure_current": 0.2,
    "exposure_desired": 0.6
  }]
}

**Field guidance:**
- perspective: REQUIRED - their actual view/opinion
- approach: Optional if unclear - how they discuss this topic
- personal_stake: Optional if unclear - why it matters to them
- exposure_current: Low (0.2) since these are new topics
- exposure_desired: How much the persona would want to discuss this`;

  const user = `Persona: ${data.persona_name}

Personality traits:
${traitList}

Current topics (do not duplicate):
${topicList}

Recent conversation themes:
${themeList}

Generate new topics this persona would care about.`;

  return { system, user };
}
