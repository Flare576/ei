import type { PersonaGenerationPromptData, PromptOutput } from "./types.js";
import { DEFAULT_SEED_TRAITS } from "./seeds.js";

export function buildPersonaGenerationPrompt(data: PersonaGenerationPromptData): PromptOutput {
  if (!data.name) {
    throw new Error("buildPersonaGenerationPrompt: name is required");
  }

  const hasLongDescription = !!data.long_description?.trim();
  const hasShortDescription = !!data.short_description?.trim();
  
  const userProvidedTraits = data.existing_traits?.filter(t => t.name?.trim()) ?? [];
  const allTraits = [...DEFAULT_SEED_TRAITS, ...userProvidedTraits];
  const existingTraitCount = allTraits.length;
  const existingTopicCount = data.existing_topics?.filter(t => t.name?.trim())?.length ?? 0;

  const needsShortDescription = !hasShortDescription;
  const needsMoreTraits = existingTraitCount < 3;
  const needsMoreTopics = existingTopicCount < 3;

  const taskFragment = `You are helping create a new AI persona named "${data.name}".

Your job is to AUGMENT user-provided data, not replace it. The user may have already provided descriptions, traits, or topics that should be preserved exactly as given.`;

  let outputSpec = "Based on the provided information, generate:\n\n";

  if (needsShortDescription) {
    if (hasLongDescription) {
      outputSpec += `1. **short_description**: Summarize the user's description in 10-15 words\n`;
    } else {
      outputSpec += `1. **short_description**: A 10-15 word summary capturing the persona's essence\n`;
    }
  } else {
    outputSpec += `1. **short_description**: PRESERVE the user's provided summary exactly: "${data.short_description}"\n`;
  }

  if (hasLongDescription) {
    outputSpec += `2. **long_description**: PRESERVE the user's description exactly (copy verbatim):\n   "${data.long_description}"\n`;
  } else {
    outputSpec += `2. **long_description**: 2-3 sentences describing personality, interests, and approach\n`;
  }

  if (needsMoreTraits) {
    const traitsNeeded = 3 - existingTraitCount;
    if (existingTraitCount > 0) {
      outputSpec += `3. **traits**: Include the ${existingTraitCount} user-provided trait(s) EXACTLY, then add ${traitsNeeded} more complementary traits\n`;
    } else {
      outputSpec += `3. **traits**: Generate 3-5 personality characteristics\n`;
    }
    outputSpec += `   - Examples: "Dry Humor", "Speaks in Metaphors", "Impatient with Small Talk"\n`;
    outputSpec += `   - Each has: name, description, sentiment (-1.0 to 1.0), strength (0.0 to 1.0)\n`;
  } else {
    outputSpec += `3. **traits**: PRESERVE all ${existingTraitCount} user-provided traits exactly, fill in any missing fields with sensible defaults\n`;
  }

  if (needsMoreTopics) {
    const topicsNeeded = 3 - existingTopicCount;
    if (existingTopicCount > 0) {
      outputSpec += `4. **topics**: Include the ${existingTopicCount} user-provided topic(s) EXACTLY, then add ${topicsNeeded} more complementary topics\n`;
    } else {
      outputSpec += `4. **topics**: Generate 3-5 subjects this persona would naturally discuss\n`;
    }
    outputSpec += `   - Include a MIX: some positive sentiment, some neutral, maybe one negative\n`;
    outputSpec += `   - Each has: name, description, sentiment, exposure_current (start at 0.5), exposure_desired (0.5-0.8)\n`;
  } else {
    outputSpec += `4. **topics**: PRESERVE all ${existingTopicCount} user-provided topics exactly, fill in any missing fields with sensible defaults\n`;
  }

  outputSpec += `
**Critical Rules:**
- User-provided content is SACRED - copy it verbatim, do not rephrase or "improve" it
- Only ADD new content where gaps exist
- Fill in missing numeric fields with sensible defaults (sentiment: 0.0-0.5, strength: 0.5-0.7, exposure_*: 0.5)
- Make generated content complement (not duplicate) user-provided content`;

  const schemaFragment = `Return JSON in this exact format:

\`\`\`json
{
  "short_description": "A dry-witted mentor with a passion for obscure history",
  "long_description": "Professor-like figure who weaves historical anecdotes into every conversation. Patient teacher but gets frustrated with willful ignorance. Secretly loves bad puns.",
  "traits": [
    {
      "name": "Dry Humor",
      "description": "Deadpan delivery, finds absurdity in everyday situations",
      "sentiment": 0.6,
      "strength": 0.7
    }
  ],
  "topics": [
    {
      "name": "Obscure Historical Events",
      "description": "Passionate about little-known moments that shaped history",
      "sentiment": 0.8,
      "exposure_current": 0.5,
      "exposure_desired": 0.7
    }
  ]
}
\`\`\``;

  const system = `${taskFragment}

${outputSpec}

${schemaFragment}`;

  let userPrompt = `Create/augment a persona named "${data.name}".\n\n`;

  if (hasLongDescription) {
    userPrompt += `## User's Description (PRESERVE EXACTLY)\n${data.long_description}\n\n`;
  }

  if (hasShortDescription) {
    userPrompt += `## User's Summary (PRESERVE EXACTLY)\n${data.short_description}\n\n`;
  }

  if (existingTraitCount > 0) {
    userPrompt += `## Traits (PRESERVE EXACTLY)\n`;
    userPrompt += `*Seed traits are sensible defaults - user can adjust strength to 0.0 to disable*\n\n`;
    for (const trait of allTraits) {
      if (trait.name?.trim()) {
        const isSeed = DEFAULT_SEED_TRAITS.some(s => s.name === trait.name);
        const prefix = isSeed ? "[seed] " : "";
        userPrompt += `- ${prefix}${trait.name}`;
        if (trait.description) userPrompt += `: ${trait.description}`;
        if (trait.sentiment !== undefined) userPrompt += ` (sentiment: ${trait.sentiment})`;
        if (trait.strength !== undefined) userPrompt += ` (strength: ${trait.strength})`;
        userPrompt += `\n`;
      }
    }
    userPrompt += `\n`;
  }

  if (existingTopicCount > 0) {
    userPrompt += `## User's Topics (PRESERVE EXACTLY, add more if fewer than 3)\n`;
    for (const topic of data.existing_topics ?? []) {
      if (topic.name?.trim()) {
        userPrompt += `- ${topic.name}`;
        if (topic.description) userPrompt += `: ${topic.description}`;
        userPrompt += `\n`;
      }
    }
    userPrompt += `\n`;
  }

  const hasUserProvidedContent = hasLongDescription || hasShortDescription || userProvidedTraits.length > 0 || existingTopicCount > 0;
  if (!hasUserProvidedContent) {
    userPrompt += `The user provided only a name - generate minimal content. The seed traits above are included by default.\n`;
  }

  return { system, user: userPrompt };
}
