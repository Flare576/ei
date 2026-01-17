# 0083: Operation-Specific Model Configuration

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Add environment variables to configure different default models for different operation types (responses, concept updates, persona generation), allowing cost/performance optimization without per-persona configuration.

## Problem

After 0082, we can specify models per-call, but the fallback is always the global `EI_LLM_MODEL`. Different operations have different needs:

| Operation | Needs | Ideal Model |
|-----------|-------|-------------|
| **Conversational responses** | Creativity, personality, nuance | Flagship model (expensive) |
| **Concept map updates** | Reliable JSON output, structured thinking | Mid-tier model (cheap, structured) |
| **Persona generation** | Creativity + structure | Mid-tier model |
| **Description generation** | Brief, accurate summaries | Fast model |

Users might want a flagship model for conversations but a cheap local model for background concept processing.

## Proposed Solution

### New Environment Variables

```bash
# Operation-specific model defaults (optional)
EI_MODEL_RESPONSE=openai:gpt-4o              # Conversational responses
EI_MODEL_CONCEPT=local:google/gemma-3-12b    # Concept map updates
EI_MODEL_GENERATION=openai:gpt-4o-mini       # Persona/description generation

# Existing global fallback (still works)
EI_LLM_MODEL=local:google/gemma-3-12b
```

### Operation Types

```typescript
// src/llm.ts
export type LLMOperation = "response" | "concept" | "generation";

const OPERATION_ENV_VARS: Record<LLMOperation, string> = {
  response: "EI_MODEL_RESPONSE",
  concept: "EI_MODEL_CONCEPT",
  generation: "EI_MODEL_GENERATION",
};
```

### Updated Resolution Chain

```typescript
export function resolveModel(modelSpec?: string, operation?: LLMOperation): ResolvedModel {
  // 1. Explicit model spec (highest priority)
  if (modelSpec) {
    return parseAndResolve(modelSpec);
  }
  
  // 2. Operation-specific env var
  if (operation) {
    const opEnvVar = OPERATION_ENV_VARS[operation];
    const opModel = process.env[opEnvVar];
    if (opModel) {
      return parseAndResolve(opModel);
    }
  }
  
  // 3. Global default
  const globalModel = process.env.EI_LLM_MODEL || "local:google/gemma-3-12b";
  return parseAndResolve(globalModel);
}
```

### Updated LLMOptions

```typescript
export interface LLMOptions {
  signal?: AbortSignal;
  temperature?: number;
  model?: string;
  operation?: LLMOperation;  // NEW: Hint for fallback resolution
}
```

### Callsite Updates

| File | Function | Operation Type |
|------|----------|----------------|
| `processor.ts` | Response generation | `"response"` |
| `concept-queue.ts` | Concept updates | `"concept"` |
| `persona-creator.ts` | Persona creation | `"generation"` |
| `persona-creator.ts` | Description generation | `"generation"` |

```typescript
// processor.ts
const rawResponse = await callLLM(
  responseSystemPrompt, 
  responseUserPrompt, 
  { signal, temperature: 0.7, model: systemConcepts.model, operation: "response" }
);

// concept-queue.ts
const newConcepts = await callLLMForJSON<Concept[]>(
  systemPrompt,
  userPrompt,
  { signal, temperature: 0.3, model: personaModel, operation: "concept" }
);
```

### Fallback Chain (Complete)

1. Explicit `model` parameter (persona's model or caller-specified)
2. Operation-specific env var (`EI_MODEL_RESPONSE`, etc.)
3. Global `EI_LLM_MODEL` env var
4. Hardcoded default: `local:google/gemma-3-12b`

## Files Modified

- `src/llm.ts` - Add `LLMOperation` type, update `resolveModel()`, update `LLMOptions`
- `src/processor.ts` - Add `operation: "response"` to LLM calls
- `src/concept-queue.ts` - Add `operation: "concept"` to LLM calls
- `src/persona-creator.ts` - Add `operation: "generation"` to LLM calls
- `AGENTS.md` - Document operation-specific env vars

## Acceptance Criteria

- [ ] `LLMOperation` type defined with three values
- [ ] `EI_MODEL_RESPONSE` env var recognized and used for response generation
- [ ] `EI_MODEL_CONCEPT` env var recognized and used for concept updates
- [ ] `EI_MODEL_GENERATION` env var recognized and used for persona/description generation
- [ ] Fallback chain works correctly (model → operation env → global env → default)
- [ ] All callsites updated with appropriate operation type
- [ ] AGENTS.md documents operation-specific env vars with examples
- [ ] Unit tests verify fallback chain behavior
- [ ] Backward compatible: existing setups (only `EI_LLM_MODEL`) still work

## Testing Strategy

```typescript
describe("resolveModel with operation", () => {
  beforeEach(() => {
    // Clear all model env vars
    delete process.env.EI_LLM_MODEL;
    delete process.env.EI_MODEL_RESPONSE;
    delete process.env.EI_MODEL_CONCEPT;
    delete process.env.EI_MODEL_GENERATION;
  });
  
  it("uses explicit model over operation default", () => {
    process.env.EI_MODEL_RESPONSE = "openai:gpt-4o";
    const result = resolveModel("local:gemma", "response");
    expect(result.model).toBe("gemma");
    expect(result.provider).toBe("local");
  });
  
  it("uses operation env var when no explicit model", () => {
    process.env.EI_MODEL_RESPONSE = "openai:gpt-4o";
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("gpt-4o");
    expect(result.provider).toBe("openai");
  });
  
  it("falls back to global when no operation env var", () => {
    process.env.EI_LLM_MODEL = "anthropic:claude-3-sonnet";
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("claude-3-sonnet");
  });
  
  it("uses hardcoded default when nothing configured", () => {
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("google/gemma-3-12b");
    expect(result.provider).toBe("local");
  });
});
```

## Dependencies

- **0082**: Needs refactored LLM calls that accept model parameter

## Effort Estimate

Small: 1-2 hours

## Notes

- This is an enhancement ticket - the core functionality works without it
- Enables cost optimization: expensive models for user-facing work, cheap models for background tasks
- The `operation` parameter is optional; callers can still use explicit `model` parameter
