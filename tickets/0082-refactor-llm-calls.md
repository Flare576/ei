# 0082: Refactor LLM Calls - Accept Model Parameter

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Update `callLLM` and `callLLMForJSON` to accept an optional model parameter, and update all callsites to pass the appropriate model based on persona or operation type.

## Problem

Current LLM functions use a global client and MODEL constant:

```typescript
// Current: llm.ts
const client = new OpenAI({...});
const MODEL = process.env.EI_LLM_MODEL || "...";

async function callLLMRaw(systemPrompt, userPrompt, options) {
  // Uses global client and MODEL
}
```

After 0080, we have `resolveModel()` but no way to use it from callsites.

## Proposed Solution

### Update LLMOptions Interface

```typescript
export interface LLMOptions {
  signal?: AbortSignal;
  temperature?: number;
  model?: string;  // NEW: Override model for this call
}
```

### Update callLLMRaw

```typescript
async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<LLMRawResponse> {
  const { signal, temperature = 0.7, model: modelSpec } = options;
  
  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  const { client, model, provider } = resolveModel(modelSpec);
  
  // Debug logging
  if (process.env.DEBUG || process.argv.includes('-d')) {
    console.log(`[LLM] Using ${provider}:${model}`);
  }

  let response;
  try {
    response = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
      },
      { signal }
    );
  } catch (err) {
    // ... existing error handling
  }
  // ...
}
```

### Update Callsites

| File | Function | Current | After |
|------|----------|---------|-------|
| `processor.ts:121` | `processEvent` | No model | Pass persona's model from `systemConcepts.model` |
| `processor.ts:191` | `updateConceptsForMessages` | No model | Pass persona's model (deprecated path) |
| `concept-queue.ts:337` | `processTask` | No model | Pass persona's model from task context |
| `persona-creator.ts:116` | `createPersonaWithLLM` | No model | Use global default (no persona yet) |
| `persona-creator.ts:165` | `generatePersonaDescriptions` | No model | Pass persona's model if available |

### Example: processor.ts Changes

```typescript
// Before
const rawResponse = await callLLM(
  responseSystemPrompt, 
  responseUserPrompt, 
  { signal, temperature: 0.7 }
);

// After
const rawResponse = await callLLM(
  responseSystemPrompt, 
  responseUserPrompt, 
  { signal, temperature: 0.7, model: systemConcepts.model }
);
```

### Example: concept-queue.ts Changes

The concept queue already has access to persona via `task.persona`. Need to:
1. Load persona's ConceptMap to get model field
2. Pass model to callLLMForJSON

```typescript
// In processTask, after loading currentConcepts for target === "system"
const personaModel = task.target === "system" ? currentConcepts.model : undefined;

const newConcepts = await callLLMForJSON<Concept[]>(
  systemPrompt,
  userPrompt,
  { signal, temperature: 0.3, model: personaModel }
);
```

## Files Modified

- `src/llm.ts` - Add `model` to LLMOptions, use `resolveModel()` in callLLMRaw
- `src/processor.ts` - Pass persona model to LLM calls
- `src/concept-queue.ts` - Pass persona model to LLM calls
- `src/persona-creator.ts` - Pass persona model where available

## Acceptance Criteria

- [ ] `LLMOptions.model` field exists
- [ ] `callLLMRaw` uses `resolveModel()` to get client and model
- [ ] Debug mode logs which provider:model is used per call
- [ ] `processEvent` passes persona's model to response generation
- [ ] `concept-queue` passes persona's model to concept updates
- [ ] `persona-creator` passes persona's model to description generation
- [ ] All existing tests pass (backward compatible when model not specified)
- [ ] New tests verify model parameter flows through correctly

## Testing Strategy

### Unit Tests

```typescript
describe("callLLM with model parameter", () => {
  it("uses specified model", async () => {
    // Mock resolveModel to verify it's called with correct spec
    const spy = jest.spyOn(llm, 'resolveModel');
    await callLLM("sys", "user", { model: "openai:gpt-4o" });
    expect(spy).toHaveBeenCalledWith("openai:gpt-4o");
  });
  
  it("uses default when model not specified", async () => {
    const spy = jest.spyOn(llm, 'resolveModel');
    await callLLM("sys", "user", {});
    expect(spy).toHaveBeenCalledWith(undefined);
  });
});
```

### Integration Tests

```typescript
describe("processEvent with persona model", () => {
  it("uses persona model for response generation", async () => {
    // Create persona with model field
    // Process event
    // Verify correct model was used (via mock or log capture)
  });
});
```

## Dependencies

- **0080**: Needs `resolveModel()` function

## Effort Estimate

Medium: 2-3 hours

## Notes

- This is the core refactoring ticket - most of the plumbing happens here
- Backward compatible: when `model` is undefined, `resolveModel()` falls back to env vars
- The persona-creator case is special: when creating a new persona, there's no model yet, so it uses global default
