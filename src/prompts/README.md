# Prompt Engineering Guidelines

This folder contains all LLM prompt builders for the EI system, organized by purpose.

## Folder Structure

```
prompts/
├── response/          # Conversational response generation
├── extraction/        # Human entity data extraction (3-step flow)
├── persona/           # Persona-specific extraction (traits, topics)
├── generation/        # Entity creation (new personas)
└── verification/      # Data validation and parsing
```

## Prompt Construction Pattern

All prompt builders follow a consistent "fragment-building" pattern:

### Structure

1. **Build large text fragments at the top** (definitions, instructions, fields, examples)
2. **Compose final prompts at the bottom** using pseudo-HEREDOC structure

### Example

```typescript
export function buildMyPrompt(args): { system: string; user: string } {
  // 1. BUILD FRAGMENTS (top of function)
  const definitionsFragment = `# Definitions
  
  Term1 - explanation
  Term2 - explanation`;
  
  const taskFragment = `# Task
  
  You are analyzing...`;
  
  const fieldsFragment = `# Fields
  
  - field1: description
  - field2: description`;
  
  const examplesFragment = `# Examples
  
  Good: ...
  Bad: ...`;
  
  // 2. COMPOSE PROMPTS (bottom of function)
  const systemPrompt = `${definitionsFragment}

${taskFragment}

${fieldsFragment}

${examplesFragment}`;

  const userPrompt = `# Input Data
${dataToAnalyze}

# Task
${specificInstructions}`;

  return { system: systemPrompt, user: userPrompt };
}
```

## Why This Pattern?

### Benefits

1. **Readability**: Large blocks are easier to read and maintain than inline string concatenation
2. **Modularity**: Fragments can be conditionally included or reused
3. **Testing**: Individual fragments can be validated independently
4. **AI-Friendly**: Agents can easily identify and modify specific prompt sections
5. **Human-Friendly**: Reviewers can scan fragments without parsing complex logic

### Anti-Pattern (Avoid)

```typescript
// DON'T DO THIS - hard to read and maintain
return {
  system: "# Definitions\n\n" + 
          "Term1 - " + term1 + "\n" +
          "Term2 - " + term2 + "\n\n" +
          "# Task\n\n" +
          taskDescription + "\n\n" +
          "# Fields\n\n" +
          fields.map(f => `- ${f.name}: ${f.desc}`).join('\n'),
  user: "..."
};
```

## Terminology: Code vs Prompts

Some field names are mapped to more semantic terms in prompts:

| Code Field | Prompt Term | Rationale |
|------------|-------------|-----------|
| `level_current` | `exposure_current` | Clearer: "how recently exposed to this" |
| `level_ideal` | `exposure_desired` | Clearer: "how much they want to discuss" |

Mapping happens at boundaries:
- **Prompt generation**: Convert code → prompt terms
- **Response parsing**: Convert prompt → code terms

See `extraction/field-mapping.ts` for implementation.

## Temperature Guidelines

Different operations need different creativity levels:

| Operation | Temp | Rationale |
|-----------|------|-----------|
| Fact extraction | 0.2 | Pure detection, no creativity |
| Trait detection | 0.3 | Slight interpretation needed |
| Topic detection | 0.3 | Detection with some semantic grouping |
| Topic exploration | 0.5 | Generative - making connections |
| Response generation | 0.7 | Conversational variety |

## Common Fragments

### Message Formatting

```typescript
function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}
```

### Message Splitting (Earlier vs Recent)

```typescript
const effectiveSplitIndex = splitIndex ?? 0;
const earlierMessages = messages.slice(0, effectiveSplitIndex);
const recentMessages = messages.slice(effectiveSplitIndex);

const earlierSection = earlierMessages.length > 0
  ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, personaName)}

`
  : '';

const recentSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, personaName)}`;
```

This pattern:
- Provides context (earlier messages)
- Focuses analysis (recent messages only)
- Avoids re-processing already-analyzed data

## Testing Prompts

See `tests/model/` for prompt benchmarking tools:

```bash
npm run bench -- \
  --system prompts/myPrompt/system.md \
  --user prompts/myPrompt/user.md \
  --model local:qwen/qwen3-14b \
  --runs 20
```

## Evolution Notes

**Current phase**: Proof of Concept (PoC) using Blessed UI

**Next iteration** will use a different queuing system. Current extraction frequency logic and prompt designs are experimental—prioritize clarity and experimentation over production-grade optimization.

Some extraction tasks (like `exposure_current` updates) will move to scheduled/triggered jobs in the next version. For now, they're embedded in extraction prompts for simplicity.
