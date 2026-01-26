# 0127: Persona Facts/People as Topics

**Status**: PENDING

## Problem

Currently, when personas receive extraction updates for `fact` and `person` data types, we discard them (Option 1 from architecture decision). However, there's a legitimate use case for personas to track these as *topics* instead.

**Example**: "Mike the Mechanic" persona might want to track "Bob from Work" as a *topic* because Bob is relevant to conversations about cars, not because Mike has a personal relationship with Bob.

## Current State (as of 0107-entity-data-architecture-epic)

- Fast-scan can detect facts and people for both human and system entities
- Detail updates for `fact` and `person` are enqueued for both targets
- **System entities skip processing these** - we don't call detail updates for personas (implemented in Option 1)
- Result: Facts/people about humans are tracked, but mentions of facts/people in persona context are lost

## Proposed Solution (Future)

When `target === "system"` and `data_type === "fact" | "person"`:
1. **Remap to topic** during enqueue or processing
2. **Adjust prompt** to treat the item as a topic of interest/expertise rather than biographical data
3. **Store in topics bucket** on the persona entity

### Implementation Points

**Where to implement** (choose one):

#### Option A: Remap During Enqueue
In `runFastScan()` (src/extraction.ts ~line 250-290), when enqueueing detail updates:
```typescript
if (target === "system" && (item.type === "fact" || item.type === "person")) {
  // Enqueue as topic instead
  await enqueueItem({
    type: "detail_update",
    data_type: "topic",  // <-- remap here
    ...
  });
}
```

#### Option B: Remap During Processing
In `runDetailUpdate()` (src/extraction.ts ~line 675-740), detect and remap:
```typescript
let effectiveDataType = data_type;
if (target === "system" && (data_type === "fact" || data_type === "person")) {
  effectiveDataType = "topic";
}
```

#### Option C: Conditional Prompt Builder
In `buildDetailPromptByType()` (src/extraction.ts ~line 800-822), add logic:
```typescript
case "fact":
  if (target === "system") {
    return buildTopicDetailPrompt(...); // Use topic prompt
  }
  return buildFactDetailPrompt(...);
```

**Recommendation**: Option A (enqueue-time remap) is cleanest - keeps the remapping logic in one place and doesn't pollute processing logic.

### Prompt Adjustments Needed

When converting fact → topic for persona:
- **Name**: Keep the fact/person name
- **Description**: Reframe as "why this is relevant" instead of "what this is"
- **Sentiment**: How the persona feels about discussing this
- **level_current**: Recently discussed?
- **level_ideal**: How much does persona want to discuss this?

**Example**:
- Human fact: `"Bob from Work" - relationship: coworker, description: "Works in accounting..."`
- Persona topic: `"Bob from Work" - description: "A coworker who loves classic cars, relevant to Mike's mechanical expertise..."`

## Why Not Now?

1. **Noise concern**: Without strong skip logic, personas would accumulate many irrelevant topics
2. **Skip logic needs tuning**: Current implementation doesn't skip enough (see data in ~/personaldot/ei/)
3. **Use case unclear**: Need real-world examples where this would be valuable

## Dependencies

- Fix skip logic first (make it actually work)
- Test with real data to see if personas accumulate too much noise
- Identify concrete use cases where persona would benefit from tracking human facts/people as topics

## Acceptance Criteria

- [ ] When system entity mentions a fact/person in conversation, it's remapped to a topic
- [ ] Topic description reflects why the persona cares, not just biographical data
- [ ] Skip logic prevents noise (persona only tracks facts/people it actually engages with)
- [ ] Manual testing with "Mike the Mechanic" scenario confirms usefulness
- [ ] Data folder review shows clean, relevant topics (not noise)

## Testing Scenarios

1. **Bob the Car Guy**: Human mentions "Bob from Work loves classic cars" → Mike the Mechanic should track "Bob from Work" as a topic
2. **Irrelevant Person**: Human mentions "Karen from HR" in passing → Mike should skip (no interest)
3. **Historical Fact**: Human mentions "MLK's birthday is January 15" → History Teacher persona tracks as topic
4. **Irrelevant Fact**: Human mentions their own birthday → General purpose persona skips

## Notes

- This was consciously deferred during 0107-entity-data-architecture-epic
- Current implementation (Option 1: skip entirely) is in `runFastScan()` src/extraction.ts
- Decision discussion: https://github.com/Flare576/ei (session with Sisyphus, Jan 21 2026)
