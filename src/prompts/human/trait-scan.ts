import type { TraitScanPromptData, PromptOutput } from "./types.js";
import type { Message } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

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
    c. Be CLEAR - state your \`reason\` for including this TRAIT with any evidence you used

To help the system prioritize data, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain`;

  const guidelinesFragment = `## Guidelines

**A TRAIT Is:**
* Personality Patterns (Introverted | Reserved | Extroverted | Detail Oriented | Analytical)
* Communication Style (Assertive | Passive | Empathetic | Curious | Narrative)
* Behavioral Tendencies (Risk-Taker | Cautious | Spontaneous | Decisive)
* Cognitive Style / Learning Approach (Logical | Creative | Intuitive | Visual Learner)
* Emotional Traits / Regulation (Emotionally Resilient | Optimistic | Pessimistic | Calm | Anxious)
* Work Ethic / Task Orientation (Diligent | Proactive | Organized | Ambitious | Persistent)
* Social Orientation (Collaborative | Independent | Competitive | Supportive | Gregarious)
* Approach to Change & Adversity (Adaptable | Resilient | Flexible | Open-minded)
* Motivational Drivers (Achievement-Oriented | Altruistic | Curiosity-Driven)
* Ethical & Moral Stance (Principled | Honest | Integrity-Driven | Fair-minded)

**A TRAIT Is NOT:**
- Biographical data: Birthday, Location, Job, Marital Status, Gender, Eye Color, Hair Color
- Other unchangeable Data: Wedding Day, Allergies
- General Topic: Interests, hobbies
- People: Real people in their life
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
        "confidence": "high|medium|low",
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
${formatMessagesForPrompt(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesForPrompt(data.messages_analyze, personaName)}`;

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
        "confidence": "high|medium|low",
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}
