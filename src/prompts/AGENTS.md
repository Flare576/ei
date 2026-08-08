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
├── human/             # Fact/topic/person extraction
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
2. **Pure** - Same input → same output. No state reads, no side effects.
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

---

## VIOLATIONS

These are wrong. If you see them, fix them.

### Prompt strings defined outside `src/prompts/`

**Violation:**
```typescript
// ❌ In src/core/handlers/something.ts
const system = `You are an expert at JSON. Return only valid JSON with no commentary.`;
const user = `Fix this broken JSON: ${badJson}`;
const response = await llmClient.call({ system, user });
```

**Correct:** Move the prompt to `src/prompts/[purpose]/index.ts`. The handler calls the builder with pre-fetched data; the builder returns `{ system, user }`.

### Exception: JSON recovery prompt in `queue-processor.ts`

There is one deliberate exception to the "all prompts live in `src/prompts/`" rule: the JSON repair retry prompt in `queue-processor.ts`.

**Why it's an exception**: This is a *repair heuristic* — it fires after a JSON parse failure to ask the LLM to fix its own malformed output. It has no domain knowledge, no persona data, and no human data. It's infrastructure-level error recovery, not a domain prompt. Moving it to `src/prompts/` would create a degenerate prompt builder with a one-line body and no meaningful data contract.

**Criteria for a legitimate exception** (all must be true):
1. The prompt contains zero domain knowledge (no persona names, no human data, no Ei concepts)
2. It's error recovery or infrastructure glue, not business logic
3. Moving it to `src/prompts/` would produce a builder with no real `types.ts` (no input data shape worth naming)

If your use case doesn't meet all three criteria, it belongs in `src/prompts/`.

### Prompt builders that do computation

**Violation:**
```typescript
// ❌ Prompt builder filtering its own data
function buildResponsePrompt(data: ResponsePromptData) {
  const relevantFacts = data.facts.filter(f => f.sentiment > 0.5);  // ← WRONG
  const recentTopics = data.topics.slice(-5);                        // ← WRONG
  return { system: `...${relevantFacts}...`, user: `...` };
}
```

**Correct:** The Processor filters and slices before calling the builder. The builder receives already-filtered data and does string interpolation only.

> If you're writing a loop, a `.filter()`, or a `.map()` inside a prompt builder for anything other than formatting a string — stop. That logic belongs in the Processor or a pre-processing utility.

### Async prompt builders

**Violation:**
```typescript
// ❌ Async prompt builder
async function buildHeartbeatPrompt(personaId: string) {
  const persona = await stateManager.getPersona(personaId);  // ← WRONG
  return { system: `...`, user: `...` };
}
```

**Correct:** Processor calls `stateManager.getPersona()` first, then passes the result to the synchronous builder.

---

## Prompt Creep Warning

Prompt builders are the most-edited files in the codebase. Watch for these failure modes:

- **Logic creep**: A builder that started as pure string interpolation slowly accumulates conditionals, date math, or data filtering. Each addition seems small. After six changes it's a 200-line function that requires mocking to test. If you're adding branching logic to a prompt builder — reconsider. Move it to the Processor.

- **Data shape expansion**: A builder's input type grows to include things it doesn't actually use in the prompt string. This means the Processor is fetching data the prompt doesn't need. Audit `types.ts` when the data shape grows.

- **Responsibility leakage**: A prompt builder that calls another prompt builder, or calls a utility that reads from state, or has a side effect on logging that depends on runtime context. Builders must be standalone: same input, same output, every time, in any order.
