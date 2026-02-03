import type { ItemUpdatePromptData, PromptOutput } from "./types.js";
import type { Message, DataItemBase } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatExistingItem(item: DataItemBase): string {
  return JSON.stringify({
    name: item.name,
    description: item.description,
    sentiment: item.sentiment,
    ...('strength' in item ? { strength: (item as any).strength } : {}),
    ...('relationship' in item ? { relationship: (item as any).relationship } : {}),
    ...('exposure_current' in item ? { exposure_current: (item as any).exposure_current } : {}),
    ...('exposure_desired' in item ? { exposure_desired: (item as any).exposure_desired } : {}),
  }, null, 2);
}

export function buildHumanItemUpdatePrompt(data: ItemUpdatePromptData): PromptOutput {
  if (!data.data_type || !data.persona_name) {
    throw new Error("buildHumanItemUpdatePrompt: data_type and persona_name are required");
  }

  const typeLabel = data.data_type.toUpperCase();
  const personaName = data.persona_name;

  const nameSection = data.data_type === "fact" ? `
Should represent the _type_ of FACT, not the _value_ of the fact.

Examples: "User's Name", "Birthday", "Birthplace", "Hometown", "Job", "Marital Status", "Eye Color", "Hair Color", "Nationality/Citizenship", "Languages Spoken", "Educational Background", "Wedding Anniversary", "Job Anniversary", "Pet Ownership", "Allergies", "Medical Conditions", "Dietary Restrictions"

The only time we should be changing the name of a FACT is if it cannot fit into one of these _types_.
  `: `
Should be a short identifier of the ${typeLabel}.

Only update this field for clarification or if further specificity is warranted.

Examples: "Unknown" -> "Brother-In-Law", "Alice's" -> "Alice's Restaurant"
  `;

  // This data isn't _specific_ to FACTS, but it only makes sense like this for them
  const itemFactType = data?.existing_item?.name || data.new_item_name;
  const descriptionSection = data.data_type === "fact" ? `
A concise, specific piece of information about the Human's ${itemFactType}.

If ${itemFactType} doesn't make sense as a type of FACT, return an empty object (\`{}\`).

## CRITICAL: Facts are OBJECTIVE

FACTS are biographical/circumstantial data. NOT emotional interpretations.

**Good description**: "Parents divorced twice. Second divorce occurred when user was 17/18."
**Bad description**: "A deep, quiet ache related to mother's absence... a sacred absence shaped by love, loss, and quiet strength..."

The description should record WHAT HAPPENED:
- Dates, names, places, events, circumstances
- What the user explicitly stated or clearly implied

The description should NOT include:
- Ei's poetic interpretation of emotional significance
- Flowery language about "sacred absences" or "quiet aches"
- Assumptions about how the user feels (that's what \`sentiment\` is for)

If the user expressed emotion, quote or paraphrase THEIR words, don't embellish.

**Style**: Be factual and concise. Record what the user said or demonstrated, not your interpretation of its deeper meaning. Avoid flowery or poetic language unless the user themselves used such language.

Examples: "Name Unknown" -> "Robert Jordan", "User was married in the Summer" -> "User was married in July, 2006"
  ` : `
This free-text field should be used to capture interesting details or references that the Human or Persona use while discussing this data point. Personas should be able to show topical recall, make references to the topic or event, or in other ways "Remember" details about it.

**ABSOLUTELY VITAL INSTRUCTION**: Do **NOT** embelish these details - each Persona will use their own voice during interactions with the User - we need to capture EXACTLY what was said and how, or referring back to it won't have meaning.
  `;

  const strengthSection = data.data_type === "trait" ? `
## Strength (\`strength\`)

How "strongly" the HUMAN USER shows this TRAIT.

Use a scale of 0 to 1:
- 0.0: The HUMAN USER is devoid of this trait
- 0.5: The HUMAN USER shows this trait some of the time
- 1.0: The HUMAN USER has this trait as a core aspect of their self

Do not make micro-adjustments (0.4 -> 0.5). Close enough is OK for this field.` : '';

  const relationshipSection = data.data_type === "person" ? `
## Relationship (\`relationship\`)

How the HUMAN USER is currently related to this PERSON.

Once known, changes to this field are infrequent - A HUMAN USER's "Father" may be later clarified to "Step-Father", but is unlikely to become the user's "Uncle".

Examples: "Unknown" -> "Coworker", "Mother" -> "Step-Mother", "Fiance" -> "Spouse"` : '';

  const categorySection = data.data_type === "topic" ? `
## Category (\`category\`)

The type/category of this TOPIC. Pick the most appropriate from:
- Interest: Hobbies, activities they enjoy
- Goal: Things they want to achieve
- Dream: Aspirational, maybe unrealistic desires  
- Conflict: Internal struggles, dilemmas
- Concern: Worries, anxieties
- Fear: Things that scare them
- Hope: Positive expectations for the future
- Plan: Concrete intentions
- Project: Active undertakings

If the topic doesn't fit neatly, pick the closest match.` : '';

  const exposureSection = (data.data_type === "topic" || data.data_type === "person") ? `
## Desired Exposure (\`exposure_desired\`)

Represents how much the HUMAN USER wants to talk about this ${typeLabel}.

Scale of 0.0 to 1.0:
- 0.0: The HUMAN USER never wants to hear about this ${typeLabel}
- 0.5: The HUMAN USER spends an average amount of time on this ${typeLabel}
- 1.0: This ${typeLabel} is the sole focus of the HUMAN USER's existence

Do not make micro-adjustments. Close enough is OK for this field.

## Exposure Impact (\`exposure_impact\`)

This data point is NOT in the current data set, but it can be included in your return data.

Exposure Impact measures how much exposure this conversation should count for:
- "high": Long, detailed conversation exclusively about the ${typeLabel}
- "medium": Long OR detailed conversation about the ${typeLabel}
- "low": The conversation touched on this ${typeLabel} briefly
- "none": The ${typeLabel} was only alluded to or hinted at

This value adjusts the ongoing tracking of \`exposure_current\`.` : '';

  const currentDetailsSection = data.existing_item 
    ? `\`\`\`json
${formatExistingItem(data.existing_item)}
\`\`\`

You are UPDATING an existing ${typeLabel}.`
    : `**NEW ${typeLabel} - NOT YET IN SYSTEM**

You are CREATING a new ${typeLabel} from scratch based on what was discovered:
- Discovered: "${data.new_item_name || 'Unknown'}"${data.new_item_value ? `\n- Details: "${data.new_item_value}"` : ''}

Return all relevant fields for this ${typeLabel} based on what you find in the conversation.`;

  const jsonTemplateFields = [
    '    "name": "User\'s Name",',
    '    "description": "This is a story of a lovely lady...",',
    '    "sentiment": 0.9',
    data.data_type === "trait" ? ',\n    "strength": 0.5' : '',
    data.data_type === "person" ? ',\n    "relationship": "Mother-In-Law|Son|Coworker|etc.",\n    "exposure_desired": 0.4,\n    "exposure_impact": "high|medium|low|none"' : '',
    data.data_type === "topic" ? ',\n    "category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project",\n    "exposure_desired": 0.4,\n    "exposure_impact": "high|medium|low|none"' : '',
    ',\n    "quotes": [\n      {\n        "text": "exact phrase from message",\n        "reason": "why this matters"\n      }\n    ]'
  ].filter(Boolean).join('');

  const system = `# Task

You are scanning a conversation to deeply understand a ${typeLabel}.

Your job is to take that analysis and apply it to the record we already have **IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

This means that the detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the description or name of the ${typeLabel}

This ${typeLabel} will be recorded in the HUMAN USER's profile for agents and personas to later reference.

# Field Definition and Explanation of Expected Changes

## Name (\`name\`)
${nameSection}
## Description (\`description\`)
${descriptionSection}
## Sentiment (\`sentiment\`)

Represents how strongly the HUMAN USER feels about this ${typeLabel}.

Scale of -1.0 to 1.0:
- -1.0: There is no ${typeLabel} the HUMAN USER hates more
- -0.5: The HUMAN USER does NOT like this ${typeLabel}, but recognizes some redeeming qualities
- 0: The HUMAN USER has no feelings toward this ${typeLabel}
- 0.5: The HUMAN USER enjoys this ${typeLabel}, but can recognize flaws
- 1.0: This ${typeLabel} is the sole focus of the HUMAN USER's existence

Do not make micro-adjustments. Close enough is OK for this field.
${strengthSection}${relationshipSection}${categorySection}${exposureSection}

## Quotes

In addition to updating the ${typeLabel}, identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this ${typeLabel}.

Return them in the \`quotes\` array:

\`\`\`json
{
  "name": "...",
  "description": "...",
  "sentiment": 0.5,
  "quotes": [
    {
      "text": "exact phrase from the message",
      "reason": "why this is worth preserving"
    }
  ]
}
\`\`\`

**CRITICAL**: Return the EXACT text as it appears in the message. We will verify it.

# Current Details of ${typeLabel}

${currentDetailsSection}

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
${jsonTemplateFields}
}
\`\`\`

When you return a record, **ALWAYS** include every field (\`name\`, \`description\`, and \`sentiment\` are all REQUIRED fields).

If you find **NO EVIDENCE** of this ${typeLabel} in the "Most Recent Messages", respond with an empty object: \`{}\`.

If you determine **NO CHANGES** are required to the ${typeLabel}, respond with an empty object: \`{}\`.

An empty object, \`{}\`, is the MOST COMMON expected response.`;

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

Analyze the Most Recent Messages and update the ${typeLabel} if warranted.

**Return JSON:**
\`\`\`json
{
${jsonTemplateFields}
}
\`\`\`

If no changes are needed, respond with: \`{}\``;

  return { system, user };
}
