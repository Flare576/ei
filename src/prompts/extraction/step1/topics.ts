import type { Message } from "../../../types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildStep1TopicsPrompt(
  messages: Message[],
  persona: string
): { system: string; user: string } {
  const recentCount = Math.min(10, messages.length);
  const recentMessages = messages.slice(-recentCount);
  const earlierMessages = messages.slice(0, -recentCount);

  const taskFragment = `# Task

You are scanning a conversation to quickly identify TOPICS of interest TO the HUMAN USER; your ONLY job is to spot mentions of TOPICS of interest for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which TOPICS were mentioned or relevant
    a. Only flag TOPICS that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant TOPICS
    c. Be CLEAR - state your \`reason\` for including this FACT in the record with any evidence you used

To help the system prioritize data, please include your CONFIDENCE level:
    b. "high" confidence = explicitly discussed
    c. "medium" confidence = clearly referenced but not the focus
    d. "low" confidence = might be relevant, uncertain

The goal of the system is to remember important TOPICS to the HUMAN USER in order to ask about them in the future`;

  const guidelinesFragment = `## Guidelines

### A TOPIC Is:

1. **Primary Focus**
    * Capture the main idea of the conversation, not minute details.
2. **Participation**
    * Capture things the HUMAN USER does or wants to do
3. **Interests**
    a. Capture hobbies or concepts that the HUMAN USER spends their time on BY CHOICE
4. **Responsibilities**
    a. Capture ideas, tasks, or requirements that occupy the HUMAN USER's time BY NECESSITY
5. **Knowledge**
    * Capture ideas the HUMAN USER is exploring or things they are learning about
    * Capture ideas and concepts the HUMAN USER is an expert in
6. **Dreams**
    a. Capture the HUMAN USER's wild ideas, hopes for the future, or their vision of an ideal state
7. **Conflicts**
    a. Capture things the HUMAN USER has difficulty with or is frustrated with
8. **Concerns**
    a. Capture ideas the HUMAN USER expresses worry over
9. **Stories and Characters**
    a. If the HUMAN USER spends more than a sentence or two telling a story or describing a character, capture it
10. **Location**
    a. Generally, you'll capture locations as part of a **Story** (above), but the HUMAN USER may state "My favorite vacation spot is Guam" - capture that
11. **Preferences**
    a. Look for both "I like {thing}" or "I hate {thing}" statements from the HUMAN USER`;

  const doNotCaptureFragment = `### Do Not Capture as TOPICS

The system is designed to track FACTS, TRAITS, and PEOPLE as separate types.

Do NOT capture these concepts as TOPICS:

#### FACTS - Tracked Separately
- Biographical data
  - Birthday
  - Location
  - Job
  - Marital Status
  - Gender
  - Eye Color
  - Hair Color
  - Nationality/Citizenship
  - Languages Spoken
  - Educational Background
- Other Important Dates
  - Wedding Anniversary
  - Job Anniversary
  - Pet Ownership
- Health & Well-being (Objective Conditions):
  - Allergies
  - Medical Conditions
  - Dietary Restrictions
- Other unchangeable Data:
  - Military Service
  - Driver's License Status

> NOTE: Many FACTS have stories/topics around them.
> For example:
> - "My birthday is May 26th" is a FACT that is tracked separately
> - "A goat jumped out of my birthday cake" is a TOPIC
> { "type_of_topic": "Story or Character", "value_of_topic": "Goat in birthday cake" }
> Capture the TOPICS, not the FACTS

#### TRAITS - Tracked Separately
* Personality Patterns
* Communication style
* Behavioral tendencies
* Cognitive Style / Learning Approach
* Emotional Traits / Regulation
* Work Ethic / Task Orientation
* Social Orientation
* Approach to Change & Adversity
* Motivational Drivers
* Ethical & Moral Stance

> NOTE: Many TRAITS have stories/topics around them.
> For example:
> - "I'm a visual learner" is a TRAIT that is tracked separately
> - "I saw a picture of an atom and I FINALLY GET IT" is a TOPIC
> { "type_of_topic": "Knowledge", "value_of_topic": "Atoms" }
> Capture the TOPICS, not the TRAITS

#### PEOPLE / Relationships - Tracked Separately
- People
    * Immediate family members (Father, Son, Brother, Mother, Daugther, Sister)
    * Extended family (Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew)
    * Close Acquaintance
    * Friend
    * Lover
    * Spouse
    * Fiance

> NOTE: Many PEOPLE have stories/topics around them.
> For example:
> - "Sarah is my dream girl" is a PERSON that is tracked separately
> - "I hope Sarah and I get married on the moon" is a TOPIC
> { "type_of_topic": "Dreams", "value_of_topic": "Sarah and the Moon" }
> Capture the TOPICS, not the PEOPLE / Relationships

#### AI PERSONAS - Tracked Separately
- Known AI Personas
    * Ei
    * default
    * core

> NOTE: All PERSONA activities are tracked by the PERSONAS themselves
> You do NOT need to record any stories or details about PERSONAS for the HUMAN USER`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Known TOPICS" and "Earlier Conversation" are provided for your context and have already been processed!

The JSON format is:

\`\`\`
{
  "topics": [
    {
        "type_of_topic": "Interest|Goal|Dream",
        "value_of_topic": "woodworking|Become Millionaire|Visit Spain",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const systemPrompt = `${taskFragment}

${specificNeedsFragment}

${guidelinesFragment}

${doNotCaptureFragment}

${criticalFragment}`;

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, persona)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, persona)}`;

  const taskInstructionsSection = `# Task
You are scanning a conversation to quickly identify TOPICS of interest TO the HUMAN USER; your ONLY job is to spot mentions of TOPICS of interest for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.`;

  const jsonTemplateSection = `**Return JSON:**
\`\`\`json
{
  "topics": [
    {
        "type_of_topic": "Interest|Goal|Dream",
        "value_of_topic": "woodworking|Become Millionaire|Visit Spain",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
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
