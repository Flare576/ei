# Prompts Module

LLM prompt builders. All prompts are **synchronous** and **pure**.

## Structure

```
prompts/
├── index.ts           # Re-exports all builders
├── message-utils.ts   # Format messages for context
├── ceremony/          # Exposure decay, persona enrichment
├── generation/        # New persona creation
├── heartbeat/         # Periodic check-ins
├── human/             # Fact/trait/topic/person extraction
├── persona/           # Persona trait extraction, topic matching
├── response/          # Main conversation responses
└── validation/        # Data validation prompts
```

## Pattern

Every prompt builder follows this contract:

```typescript
interface PromptBuilder<T> {
  (data: T): { system: string; user: string }
}
```

**Rules**:
1. **Synchronous** - No async, no fetching
2. **Pure** - Same input → same output
3. **Pre-processed data** - Processor fetches/filters before calling
4. **Minimal logic** - String interpolation, not computation

## Adding New Prompts

1. Create directory: `prompts/[purpose]/`
2. Create files:
   - `types.ts` - Input data interface
   - `sections.ts` - Reusable prompt fragments
   - `index.ts` - Builder function + exports
3. Export from `prompts/index.ts`
4. Call from Processor with pre-fetched data

## Subdirectories

| Directory | Purpose | Key Output |
|-----------|---------|------------|
| `response/` | Generate persona replies | Conversational text |
| `human/` | Extract facts/traits/topics/people | JSON arrays |
| `persona/` | Extract persona traits, match topics | JSON |
| `generation/` | Create new personas | PersonaEntity JSON |
| `ceremony/` | Exposure decay prompts | Updated values |
| `heartbeat/` | Check if persona should speak | Boolean-ish |
| `validation/` | Verify extracted data | Confirmation |

## Key Insight

**Prompt engineering lives here. Code logic lives in Processor.**

When modifying persona behavior, check prompts first—the "personality" is in the English, not the TypeScript.
