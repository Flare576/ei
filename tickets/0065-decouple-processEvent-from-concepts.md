# 0065: Decouple processEvent from Concept Updates

**Status**: DONE

## Summary
Modify `processEvent()` to only generate responses, removing the inline concept update calls. This is the change that directly improves response time from 60-120 seconds to 20-40 seconds.

## Problem
Current `processEvent()` (processor.ts) does:
1. Load concepts and history
2. **Call LLM for response** (~20-40s)
3. **Call LLM for system concept update** (~20-40s)
4. **Call LLM for human concept update** (~20-40s)
5. Optionally regenerate descriptions (~20-40s)

Steps 3-5 block the user from seeing their response. These should happen asynchronously.

## Proposed Solution

### 1. Simplify processEvent() (processor.ts)
```typescript
export async function processEvent(
  humanMessage: string | null,
  persona: string = "ei",
  debug: boolean = false,
  signal?: AbortSignal
): Promise<ProcessResult> {
  // ... existing setup code ...

  // Generate response (this is the only LLM call now!)
  const rawResponse = await callLLM(responseSystemPrompt, responseUserPrompt, { signal, temperature: 0.7 });
  const response = rawResponse ? stripEcho(humanMessage, rawResponse) : null;

  if (signal?.aborted) return abortedResult;

  // === COMMIT POINT: Save response, mark messages read ===
  await markMessagesAsRead(persona);
  
  if (response) {
    await appendMessage({
      role: "system",
      content: response,
      timestamp: new Date().toISOString(),
    }, persona);
  }

  // Note: Concept updates are now handled by ConceptQueue (0064)
  // Messages are marked concept_processed by the queue after processing

  return {
    response,
    humanConceptsUpdated: false, // Will be updated by queue
    systemConceptsUpdated: false, // Will be updated by queue
    aborted: false,
  };
}
```

### 2. Move Concept Update Logic to Separate Function
```typescript
// New exported function for queue to use
export async function updateConceptsForMessages(
  messages: Message[],
  target: "system" | "human",
  persona: string,
  debug: boolean = false,
  signal?: AbortSignal
): Promise<boolean> {
  // Load current concepts
  const concepts = target === "system" 
    ? await loadConceptMap("system", persona)
    : await loadConceptMap("human");
  
  // Build prompt from messages
  const combinedContent = messages.map(m => 
    `[${m.role}]: ${m.content}`
  ).join("\n\n");
  
  const conceptUpdateUserPrompt = buildConceptUpdateUserPrompt(
    combinedContent,
    null, // response not relevant for batch
    persona
  );
  
  // ... rest of existing concept update logic ...
}
```

### 3. Update ProcessResult Interface
```typescript
export interface ProcessResult {
  response: string | null;
  humanConceptsUpdated: boolean; // Now always false from processEvent
  systemConceptsUpdated: boolean; // Now always false from processEvent
  aborted: boolean;
}
```

### 4. Deprecation Notice
Add comments indicating that concept update functionality has moved:
```typescript
// NOTE: As of 0065, concept updates are handled asynchronously by ConceptQueue.
// See updateConceptsForMessages() for the actual update logic.
// processEvent() now only generates responses.
```

## Acceptance Criteria
- [x] processEvent() only makes one LLM call (response generation)
- [x] Response time reduced to single LLM call duration
- [x] Concept update logic extracted to separate function
- [x] New function usable by ConceptQueue
- [x] Existing tests updated for new behavior
- [x] ProcessResult fields documented as "set by queue, not processEvent"
- [x] Debug logging indicates "concepts deferred to queue"
- [x] No regression in response quality (concepts still loaded for prompt building)

## Value Statement
**Direct UX Win**: This is the change users will feel immediately. Response time drops by 60-70%.

## Dependencies
- 0064: Implement ConceptQueue (needs somewhere for concepts to be processed)
- Part of 0061: Concept Processing Architecture Overhaul

## Effort Estimate
Medium (~2 hours)
- Refactor processEvent: 45 minutes
- Extract concept update function: 45 minutes
- Update tests: 30 minutes

## Technical Notes
- Concepts are still loaded at start of processEvent for prompt building
- The "staleness" of concepts is acceptable - LLM has conversation context
- May want to trigger queue after processEvent completes (handled by 0066)
- Description regeneration also moves to queue (triggered by concept changes)

## Implementation Notes (completed)
- `processEvent()` now only calls `callLLM()` once for response generation
- `callLLMForJSON()` calls removed from processEvent
- New `updateConceptsForMessages()` function exported from processor.ts
- The new function handles both system and human concept updates
- System concepts include validation, merging, and description regeneration
- Human concepts are simpler (just save)
- ProcessResult fields marked with `@deprecated` JSDoc tags
- All 21 processor unit tests pass
- TypeScript compilation passes
