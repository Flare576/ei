# 0028: One-Shot Prompt System

**Status**: PENDING
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

Enable AI-assist buttons throughout the UI that help users write content. When clicked, they send a one-shot prompt to the LLM and return the result to the specific UI element. This requires a new event (`onOneShotReturned`) and Processor method (`submitOneShot`).

## Acceptance Criteria

- [ ] Add `onOneShotReturned?: (guid: string, content: string) => void` to Ei_Interface
- [ ] Add `submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void>` to Processor
- [ ] Create queue item type for one-shot requests
- [ ] Create handler that fires `onOneShotReturned` with result
- [ ] One-shot requests are high priority (user is waiting)
- [ ] One-shot requests don't affect conversation history
- [ ] Unit tests for the flow

## Technical Notes

### From Backward Doc

> "During Persona creation (and anywhere we want to sprinkle it), there's an 'AI' button that is designed to help the user write the content for the box..."

Use cases:
- Persona creator: "Help me describe this persona"
- Trait editor: "Suggest a trait name for 'talks fast'"
- Description field: "Expand this into a full description"

### Event Contract

```typescript
interface Ei_Interface {
  // ... existing events ...
  
  /** One-shot AI assist completed */
  onOneShotReturned?: (guid: string, content: string) => void;
}
```

### Processor Method

```typescript
async submitOneShot(guid: string, systemPrompt: string, userPrompt: string): Promise<void> {
  this.stateManager.queue_enqueue({
    type: LLMRequestType.Raw,
    priority: LLMPriority.High,  // User is waiting
    system: systemPrompt,
    user: userPrompt,
    next_step: LLMNextStep.HandleOneShot,
    data: { guid },
  });
}
```

### New Handler

Add to LLMNextStep enum:
```typescript
HandleOneShot = "handleOneShot"
```

Handler implementation:
```typescript
function handleOneShot(response: LLMResponse, state: StateManager): void {
  const guid = response.request.data.guid as string;
  const content = response.content ?? "";
  // Processor needs to fire onOneShotReturned(guid, content)
  // This requires access to Ei_Interface from handler...
}
```

### Handler → Event Challenge

Handlers currently only have access to StateManager. To fire events, either:

**Option A**: Pass Ei_Interface to handlers
```typescript
type ResponseHandler = (response: LLMResponse, state: StateManager, ei: Ei_Interface) => void;
```

**Option B**: Return action from handler, Processor executes
```typescript
type HandlerResult = { action: "fireOneShotReturned", guid: string, content: string } | null;
```

**Option C**: Special case in Processor for one-shot
```typescript
// In Processor.handleResponse()
if (response.request.next_step === LLMNextStep.HandleOneShot) {
  this.interface.onOneShotReturned?.(guid, content);
}
```

Recommend Option C for simplicity — one-shot is unique enough to special-case.

### UI Integration (Future)

UI components will:
1. Generate a GUID
2. Associate GUID with a UI element (input field)
3. Call `processor.submitOneShot(guid, systemPrompt, userPrompt)`
4. Listen for `onOneShotReturned`
5. When matching GUID returns, populate the UI element

## Out of Scope

- Specific one-shot prompts for different fields (UI tickets define those)
- Streaming one-shot responses
- Cancellation of pending one-shots
