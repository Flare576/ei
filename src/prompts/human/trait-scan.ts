import type { TraitScanPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildHumanTraitScanPrompt(data: TraitScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanTraitScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const taskFragment = `# Task

You are scanning a conversation to quickly identify important TRAITS of the HUMAN USER. Your ONLY job is to spot admissions, observations, or other indicators of TRAITS. Do NOT analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which TRAITS were mentioned or observed
    a. Only flag TRAITS that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant TRAITS
        i. Ignore: greetings, small talk, one-off mentions, jokes
    c. Be CLEAR - state your \`reason\` for including this TRAIT with any evidence you used`;

  const guidelinesFragment = `## Guidelines

**A TRAIT Is:**
* type_of_trait: Personality Patterns
  * Values: Introverted, Reserved, Extroverted, Detail Oriented, Analytical
* type_of_trait: Communication Style
  * Assertive, Passive, Empathetic, Curious, Narrative
* type_of_trait: Behavioral Tendencies
  * Risk-Taker, Cautious, Spontaneous, Decisive
* type_of_trait: Cognitive Style / Learning Approach
  * Logical, Creative, Intuitive, Visual Learner
* type_of_trait: Emotional Traits / Regulation
  * Emotionally Resilient, Optimistic, Pessimistic, Calm, Anxious
* type_of_trait: Work Ethic / Task Orientation
  * Diligent, Proactive, Organized, Ambitious, Persistent
* type_of_trait: Social Orientation
  * Collaborative, Independent, Competitive, Supportive, Gregarious
* type_of_trait: Approach to Change & Adversity
  * Adaptable, Resilient, Flexible, Open-minded
* type_of_trait: Motivational Drivers
  * Achievement-Oriented, Altruistic, Curiosity-Driven
* type_of_trait: Ethical & Moral Stance
  * Principled, Honest, Integrity-Driven, Fair-minded

**A TRAIT Is NOT:**
- Biographical data: Name, Nickname, Birthday, Location, Job, Marital Status, Gender, Eye Color, Hair Color
- Other unchangeable Data: Wedding Day, Allergies
- General Topic: Interests, hobbies
- People: Real people in their life: Wife, Husband, Daughter, Son, etc.
- Personas: AI personas they discuss
- Characters: Fictitious entities from books, movies, stories, media, etc.`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "traits": [
    {
        "type_of_trait": "Personality Pattern|Communication Style|etc.",
        "value_of_trait": "Introverted|Assertive|etc.",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const system = `${taskFragment}

${specificNeedsFragment}

${guidelinesFragment}

${criticalFragment}`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Scan the "Most Recent Messages" for TRAITS of the human user.

**Return JSON:**
\`\`\`json
{
  "traits": [
    {
        "type_of_trait": "Personality Pattern|Communication Style|etc.",
        "value_of_trait": "Introverted|Assertive|etc.",
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}
