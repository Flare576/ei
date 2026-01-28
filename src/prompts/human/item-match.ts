import type { ItemMatchPromptData, PromptOutput } from "./types.js";

export function buildHumanItemMatchPrompt(data: ItemMatchPromptData): PromptOutput {
  if (!data.data_type || !data.item_name) {
    throw new Error("buildHumanItemMatchPrompt: data_type and item_name are required");
  }

  const typeLabel = data.data_type.toUpperCase();
  const pluralLabel = data.data_type === "person" ? "PEOPLE" : `${typeLabel}S`;

  const system = `# Task

Identify if the following ${typeLabel} is already present or represented in our list of known ${pluralLabel}.

You do not need to update, alter, or otherwise adjust any existing information, just identify a single match if it exists.

If there isn't an **EXACT** match, but one or more is **SIMILAR**, return the **MOST SIMILAR**.

If you are sure there is no similar entry, use "Not Found" for both the \`name\` and \`description\` in your response.

To help the system prioritize data and resolve mismatches, please include your CONFIDENCE level:
    a. "high" confidence = exact or near-exact match
    b. "medium" confidence = clearly related but not identical
    c. "low" confidence = might be the same thing, uncertain

# Existing ${pluralLabel}

\`\`\`json
${JSON.stringify(data.existing_items, null, 2)}
\`\`\`

# CRITICAL INSTRUCTIONS

If you are sure there is no similar entry, use "Not Found" for both the \`name\` and \`description\` in your response.

The JSON format is:

\`\`\`json
{
    "name": "Birthday|Ambitious|Mother|Goats|etc.",
    "description": "May 26th, 1984|Everyday Hustlin'|Is A Saint|This one time...|etc.",
    "confidence": "high|medium|low"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Try To Find

\`\`\`json
{
    "name": "${data.item_name}",
    "description": "${data.item_value}"
}
\`\`\`

# Task

Find the best match in existing ${pluralLabel}, or return "Not Found" if no match exists.

**Return JSON:**
\`\`\`json
{
    "name": "...",
    "description": "...",
    "confidence": "high|medium|low"
}
\`\`\``;

  return { system, user };
}
