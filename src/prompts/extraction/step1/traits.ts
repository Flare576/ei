import type { Message } from "../../../types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildStep1TraitsPrompt(
  messages: Message[],
  persona: string
): { system: string; user: string } {
  const systemPrompt = `# Task

You are scanning a conversation to quickly identify important TRAITS of the HUMAN USER; your ONLY job is to spot admissions, observations, or other indicators of TRAITS for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

## Specific Needs

Your job is to quickly identify:
1. Which TRAITS were mentioned or observed
    a. Only flag TRAITS that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant TRAITS
        i. Ignore: greetings, small talk, one-off mentions, jokes
    c. Be CLEAR - state your \`reason\` for including this FACT in the record with any evidence you used


To help the system prioritize data, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain

## Guidelines

**A TRAIT Is:**
* Personality Patterns (Introverted | Reserved | Extroverted | Detail Oriented | Analytical)
* Communication style (Assertive | Passive | Empathetic | Curious | Narrative)
* Behavioral tendencies (Risk-Taker | Cautious | Spontaneous | Decisive)
* Cognitive Style / Learning Approach (Logical | Creative | Intuitive | Analytical | Conceptual | Strategic | Fact-Driven | Abstract Thinker | Visual Learner)
* Emotional Traits / Regulation (Emotionally Resilient | Optimistic | Pessimistic | Calm | Anxious | Expressive | Stoic | Empathetic | Patient | Impatient)
* Work Ethic / Task Orientation (Diligent | Proactive | Organized | Methodical | Ambitious | Persistent | Procrastinator | Conscientious | Goal-Oriented | Resourceful)
* Social Orientation (Collaborative | Independent | Competitive | Supportive | Gregarious | Aloof | A Good Listener | Conflict-Averse | Harmonizer | Dominant)
* Approach to Change & Adversity (Adaptable | Resilient | Flexible | Change-Averse | Open-minded | Stubborn | Optimistic (in face of challenge) | Gritty | Resourceful)
* Motivational Drivers (Achievement-Oriented | Altruistic | Security-Focused | Status-Driven | Purpose-Driven | Curiosity-Driven | Recognition-Seeking | Self-Starter)
* Ethical & Moral Stance (Principled | Honest | Integrity-Driven | Opportunistic | Conscientious | Fair-minded | Loyal | Duplicitous)

**A TRAIT Is Not:**
- Biographical data:
  - "Birthday"
  - "Location"
  - "Job"
  - "Marital Status"
  - "Gender"
  - "Eye Color"
  - "Hair Color"
- Other unchangeable Data
  - "Wedding Day"
  - "Allergies"
- General Topic: Interests, hobbies
- People: Real people in their life
- Personas: AI personas they discuss
- Characters: Fictitious entities from books, movies, stories, media, etc.

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and have already been processed!

The JSON format is:

\`\`\`
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

  const recentCount = Math.min(10, messages.length);
  const recentMessages = messages.slice(-recentCount);
  const earlierMessages = messages.slice(0, -recentCount);

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, persona)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, persona)}`;

  const taskInstructionsSection = `# Task
You are scanning a conversation to quickly identify important TRAITS of the HUMAN USER; your ONLY job is to spot admissions, observations, or other indicators of TRAITS for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.`;

  const jsonTemplateSection = `**Return JSON:**
\`\`\`json
{
  "traits": [
    {
        "type_of_trait": "Personality Pattern|Communication Style|etc.",
        "value_of_trait": "Introverted|Assertive|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from...""
    }
  ]
}
\`\`\``;

  const userPrompt = `# Conversation
${earlierConversationSection}${recentConversationSection}

${taskInstructionsSection}

${jsonTemplateSection}`;

  return { system: systemPrompt, user: userPrompt };
}
