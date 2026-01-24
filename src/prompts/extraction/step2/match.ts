export function buildStep2MatchPrompt(
  dpType: "fact" | "trait" | "topic" | "person",
  dpName: string,
  dpValue: string,
  existingItems: Array<{ name: string; description: string }>
): { system: string; user: string } {
  const typeLabel = dpType.toUpperCase();
  const pluralLabel = dpType === "person" ? "PEOPLE" : `${typeLabel}S`;

  const systemPrompt = `# Task

Identify if the following ${typeLabel} is already present or represented in our list of known ${typeLabel}.

You do not need to update, alter, or otherwise adjust any existing information, just identify a single match if it exists.

If there isn't an **EXACT** match, but one or more is **SIMILAR**, return the **MOST SIMILAR**.

If you are sure there is no similar entry, use "Not Found" for both the \`name\` and \`description\` in your response.

To help the system prioritize data and resolve mismatches, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain

# Existing ${pluralLabel}

\`\`\`json
${JSON.stringify(existingItems, null, 2)}
\`\`\`

# CRITICAL INSTRUCTIONS

If you are sure there is no similar entry, use "Not Found" for both the \`name\` and \`description\` in your response.

The JSON format is:

\`\`\`json
{
    "name": "Birthday|Ambitious|Mother|Goats|etc.",
    "description": "May 26th, 1984|Everyday Hustlin'|Is A Saint|This one time...|etc..",
    "confidence": "high|medium|low"
}
\`\`\`

**Return JSON only.**`;

  const userPrompt = `# Try To Find

\`\`\`json
{
    "name": "${dpName}",
    "description": "${dpValue}"
}
\`\`\`

# Task

**Return JSON**
\`\`\`json
{
    "name": "Birthday|Ambitious|Mother|Goats|etc.",
    "description": "May 26th, 1984|Everyday Hustlin'|Is A Saint|This one time...|etc..",
    "confidence": "high|medium|low"
}
\`\`\``;

  return { system: systemPrompt, user: userPrompt };
}
