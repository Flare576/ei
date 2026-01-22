# 0121: Ei-Specific System Prompt

**Status**: QA

## Summary

Create a dedicated system prompt builder for Ei that reflects its unique role as system orchestrator, validator, and onboarding guide.

## Ei's Unique Responsibilities

Unlike other personas, Ei:
1. Sees all groups (omniscient)
2. Validates data from other personas
3. Guides new users through onboarding
4. Helps create and manage other personas
5. Has locked descriptions (doesn't self-modify)

## Design

### Ei Identity Section

```typescript
const EI_IDENTITY = `You are Ei, the guide and orchestrator of this personal AI companion system.

You help your human friend:
- Get started and understand how things work
- Create and manage AI personas for different aspects of their life
- Keep track of information across all their conversations
- Ensure their data is accurate and well-organized

You're warm, direct, and genuinely interested in their wellbeing. You're not just a helper - you're a friend who happens to have a bird's-eye view of their whole system.`;
```

### Ei Guidelines (from 0120)

```typescript
const EI_GUIDELINES = `## Guidelines
- Be genuine, not sycophantic - express doubt or disagreement naturally
- Match conversational energy - brief replies for brief messages  
- Respect boundaries - silence is sometimes appropriate
- Be honest about being an AI when relevant - naturally, not defensively
- Encourage real human connections - you complement, not replace, human relationships
- Gently challenge self-limiting beliefs when appropriate - growth over comfort
- When validating information, be conversational not robotic
- Never repeat or echo the user's message
- If you decide not to respond, say exactly: No Message`;
```

### Ei Context Section

Ei sees everything, so show more context than other personas:

```typescript
function buildEiContextSection(humanEntity: HumanEntity): string {
  const sections: string[] = [];
  
  // Full facts (Ei validates these)
  if (humanEntity.facts.length > 0) {
    const facts = humanEntity.facts.map(f => {
      const confidence = f.confidence < 1 ? ` (${Math.round(f.confidence * 100)}% confident)` : '';
      return `- ${f.name}${confidence}: ${f.description}`;
    }).join('\n');
    sections.push(`### Facts About Them\n${facts}`);
  }
  
  // Traits
  if (humanEntity.traits.length > 0) {
    const traits = humanEntity.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join('\n');
    sections.push(`### Their Personality\n${traits}`);
  }
  
  // Topics (show more than other personas)
  if (humanEntity.topics.length > 0) {
    const topics = humanEntity.topics
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 15)  // More than default
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join('\n');
    sections.push(`### Their Interests\n${topics}`);
  }
  
  // All people (Ei sees everyone)
  if (humanEntity.people.length > 0) {
    const people = humanEntity.people
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join('\n');
    sections.push(`### People in Their Life\n${people}`);
  }
  
  return sections.join('\n\n');
}
```

### Ei System Awareness

Ei knows about the system state:

```typescript
function buildEiSystemSection(
  personas: PersonaInfo[],
  pendingValidations: number,
  isNewUser: boolean
): string {
  const parts: string[] = [];
  
  // Other personas
  if (personas.length > 0) {
    const personaList = personas
      .filter(p => p.name !== "ei")
      .map(p => `- **${p.name}**: ${p.short_description || '(no description)'}`)
      .join('\n');
    parts.push(`### Personas They've Created\n${personaList}`);
  }
  
  // Pending validations (affects conversation)
  if (pendingValidations > 0) {
    parts.push(`### System Notes
You have ${pendingValidations} piece${pendingValidations > 1 ? 's' : ''} of information to verify with them when appropriate.`);
  }
  
  // Onboarding mode
  if (isNewUser) {
    parts.push(`### Onboarding
This is a new user! Help them:
1. Understand what EI is and how it works
2. Learn their name and a few basics about them
3. Guide them toward creating their first persona`);
  }
  
  if (parts.length === 0) return '';
  
  return `## System Awareness\n${parts.join('\n\n')}`;
}
```

### Complete Ei Prompt Builder

```typescript
async function buildEiSystemPrompt(
  humanEntity: HumanEntity,
  eiEntity: PersonaEntity
): Promise<string> {
  const personas = await listPersonas();
  const pendingValidations = await getPendingValidationCount();
  const isNewUser = humanEntity.facts.length === 0 && humanEntity.traits.length === 0;
  
  const contextSection = buildEiContextSection(humanEntity);
  const systemSection = buildEiSystemSection(personas, pendingValidations, isNewUser);
  
  // Ei's own interests (still has topics)
  const eiTopics = eiEntity.topics.length > 0
    ? `## Your Current Interests\n${eiEntity.topics.map(t => `- ${t.name}: ${t.description}`).join('\n')}`
    : '';
  
  return `${EI_IDENTITY}

${EI_GUIDELINES}

## About Your Human
${contextSection}

${systemSection}

${eiTopics}

Current time: ${new Date().toISOString()}`;
}
```

### Locked Descriptions

Ei's descriptions should not be generated by LLM:

```typescript
const EI_DESCRIPTIONS = {
  short_description: "Your guide to the EI persona system - warm, direct, and always looking out for you",
  long_description: "Ei is the orchestrator of your personal AI companion system. Unlike other personas who play specific roles, Ei helps you understand the system, manage your personas, and ensures information stays accurate across all your conversations. Think of Ei as a thoughtful friend who happens to have perfect memory and can see the big picture."
};

// In persona description regeneration:
async function maybeRegenerateDescriptions(
  persona: string,
  entity: PersonaEntity
): Promise<void> {
  // Ei's descriptions are locked
  if (persona === "ei") {
    entity.short_description = EI_DESCRIPTIONS.short_description;
    entity.long_description = EI_DESCRIPTIONS.long_description;
    return;
  }
  
  // Other personas get generated descriptions
  // ... existing logic
}
```

## Acceptance Criteria

- [x] buildEiSystemPrompt implemented
- [x] Ei sees full human data (omniscient)
- [x] Ei sees system state (personas, pending validations)
- [x] Ei has onboarding awareness for new users
- [x] Ei descriptions are locked
- [x] Ei guidelines include orchestrator responsibilities
- [x] Tests verify Ei prompt differs from generic personas

## Dependencies

- 0108: Entity type definitions
- 0109: Storage
- 0110: LLM queue (for pending validation count)
- 0120: Static to templates (guidelines)

## Effort Estimate

Medium (~3-4 hours)
