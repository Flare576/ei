# 0027: Ei Validation Prompt + Handler

**Status**: PENDING
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

When non-Ei personas update global human data, those changes are queued for Ei validation. Ei reviews the changes and decides whether to accept, modify, or reject them. This maintains data consistency across personas.

## Acceptance Criteria

- [ ] Create `src/prompts/validation/ei.ts` with `buildEiValidationPrompt(data): { system: string; user: string }`
- [ ] Prompt includes the pending change (what was added/modified)
- [ ] Prompt includes existing data for context
- [ ] Prompt includes source persona info
- [ ] Prompt asks Ei to validate: accept, modify, or reject
- [ ] Implement `handleEiValidation` handler
- [ ] Handler applies accepted changes
- [ ] Handler applies modifications
- [ ] Handler logs rejected changes (for debugging)
- [ ] Handler clears processed validations from queue
- [ ] Unit tests

## Technical Notes

### Data Contract

```typescript
interface EiValidationPromptData {
  validation_type: "cross_persona";
  item_name: string;
  data_type: "fact" | "trait" | "topic" | "person";
  context: string;          // Description of what changed
  source_persona: string;   // Who made the change
  current_item?: DataItemBase;  // Existing data if updating
  proposed_item: DataItemBase;  // The change being validated
}

// Expected response
interface EiValidationResult {
  decision: "accept" | "modify" | "reject";
  reason: string;
  modified_item?: DataItemBase;  // If decision === "modify"
}
```

### When This Runs

From backward doc and V0:
> "If the Persona is anyone other than Ei, and the [Fact|Trait|Person|Topic] is General group: add a change log, add an `ei_validation` queue item"

Validations accumulate in the queue. They're processed:
1. During Ei's heartbeat (batch process pending validations)
2. During Ceremony

### Validation Guidelines

Prompt should instruct Ei to:
- Accept if change is factual and well-evidenced
- Modify if partially correct (fix errors, clarify)
- Reject if contradicts known facts or seems hallucinated
- Consider source persona's expertise (relevant context?)

### Handler Flow

```
handleEiValidation(response, stateManager):
  1. Parse EiValidationResult from response.parsed
  2. Switch on decision:
     - "accept": Apply proposed_item as-is
     - "modify": Apply modified_item
     - "reject": Log rejection, no data change
  3. Clear this validation from queue
  4. Fire onHumanUpdated if data changed
```

### Queue Integration

Validations are LLMRequests with type `ei_validation`:
```typescript
stateManager.queue_getValidations()  // Get all pending
stateManager.queue_clearValidations(ids)  // Clear processed
```

### V0 Reference

`v0/src/extraction.ts` — `checkCrossPersonaUpdate`

## Out of Scope

- Automatic validation (all go through Ei)
- User override of Ei's decisions
- Validation UI
