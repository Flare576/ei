export function buildVerificationResponsePrompt(
  validationList: string,
  userMessage: string
): { system: string; user: string } {
  const validationListFragment = validationList;
  const userMessageFragment = userMessage;

  const taskFragment = `You are parsing a user's response to data verification questions.`;

  const contextFragment = `The user was asked to verify these data points:
${validationListFragment}`;

  const instructionFragment = `Your task: categorize their response into confirmed, corrected, rejected, roleplay, or unclear items.`;

  const schemaFragment = `Return JSON matching this schema:
{
  "confirmed": ["names they said were correct"],
  "corrected": [{"name": "item", "correction": "what they said instead"}],
  "rejected": ["names they said were wrong/to remove"],
  "roleplay": [{"name": "item", "group": "group name for roleplay context"}],
  "unclear": ["names we still need clarification on"]
}`;

  const examplesFragment = `Examples:
- "That's right" → confirmed: [all items]
- "Number 2 is wrong" → rejected: [item 2 name]
- "Actually it's X not Y" → corrected: [{name: Y item, correction: "X"}]
- "That was just for the game with Frodo" → roleplay: [{name: item, group: "Frodo"}]`;

  const system = `${taskFragment}

${contextFragment}

${instructionFragment}

${schemaFragment}

${examplesFragment}`;

  const user = `Their response: "${userMessageFragment}"`;
  
  return { system, user };
}
