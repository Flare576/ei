# 0113: Extraction Frequency Controller

**Status**: PENDING

## Summary

Implement adaptive extraction frequency based on data fullness. When entity data is sparse, extract aggressively. When full, taper off to save LLM calls.

## Design

### Frequency Logic

Simplified approach using `total_extractions` as both the counter AND fullness indicator:

```typescript
function shouldExtract(
  dataType: "fact" | "trait" | "topic" | "person",
  messagesSinceLastExtract: number,
  totalExtractions: number
): boolean {
  // Topics and People: always extract (engagement changes frequently)
  if (dataType === "topic" || dataType === "person") {
    return true;
  }
  
  // Facts and Traits: adaptive based on how much we've already extracted
  // More extractions = more data = less frequent extraction needed
  const threshold = Math.max(10, totalExtractions);
  return messagesSinceLastExtract >= threshold;
}
```

**Logic**: `if messages_since_last_extract > MAX(10, total_extractions), run extraction`

This elegantly handles:
- Empty state (0 extractions): Extract after 10 messages
- Sparse state (5 extractions): Extract after 10 messages  
- Full state (20 extractions): Extract after 20 messages
- Very full (50 extractions): Extract after 50 messages

### Controller Interface

```typescript
interface ExtractionFrequencyController {
  // Check if extraction should run for this type
  shouldExtract(
    entity: HumanEntity | PersonaEntity,
    dataType: "fact" | "trait" | "topic" | "person",
    conversationCount: number    // Since last extraction for this type
  ): boolean;
  
  // Record that extraction happened
  recordExtraction(
    entityType: "human" | "system",
    persona: string | null,
    dataType: "fact" | "trait" | "topic" | "person"
  ): Promise<void>;
  
  // Get count of items in a bucket
  getItemCount(
    entity: HumanEntity | PersonaEntity,
    dataType: "fact" | "trait" | "topic" | "person"
  ): number;
}
```

### State Tracking

Track extraction history per entity per type:

```typescript
interface ExtractionState {
  [entityKey: string]: {          // "human" or "system:{personaName}"
    fact: ExtractionHistory;
    trait: ExtractionHistory;
    topic: ExtractionHistory;
    person: ExtractionHistory;
  };
}

interface ExtractionHistory {
  last_extraction: string | null;   // ISO timestamp
  messages_since_last_extract: number;  // Incremented per message, reset on extraction
  total_extractions: number;            // Lifetime count (also serves as "fullness")
}
```

Store in: `data/extraction_state.jsonc`

**Clarification**: `messages_since_last_extract` is per-entity, not global. If user sends messages to Frodo and Gandalf quickly, each persona's counter increments independently.

### Implementation

```typescript
function shouldExtract(
  entity: HumanEntity | PersonaEntity,
  dataType: "fact" | "trait" | "topic" | "person",
  conversationsSince: number
): boolean {
  const count = getItemCount(entity, dataType);
  
  // Topics and People: always extract
  if (dataType === "topic" || dataType === "person") {
    return true;
  }
  
  // Facts and Traits: adaptive
  if (count <= 2) {
    // Empty: every conversation
    return true;
  } else if (count <= 10) {
    // Sparse: every 3rd
    return conversationsSince >= 3;
  } else {
    // Full: every 10th
    return conversationsSince >= 10;
  }
}

function getItemCount(
  entity: HumanEntity | PersonaEntity,
  dataType: "fact" | "trait" | "topic" | "person"
): number {
  if (isHumanEntity(entity)) {
    switch (dataType) {
      case "fact": return entity.facts.length;
      case "trait": return entity.traits.length;
      case "topic": return entity.topics.length;
      case "person": return entity.people.length;
    }
  } else {
    // Personas only have traits and topics
    switch (dataType) {
      case "trait": return entity.traits.length;
      case "topic": return entity.topics.length;
      default: return 0;  // Personas don't have facts or people
    }
  }
}
```

### Trigger Point

**What triggers extraction?** Every message pair (human message + persona response).

**Key design**: Extraction LLM calls are **interruptible and low-priority**.
- If extraction is running and a new heartbeat/human message arrives, kill the extraction
- Process the conversation trigger first
- Resume queue processing after conversation is handled

This works well because we've broken extraction into small tasks (fast-scan + individual detail updates), so interrupting one is low-cost.

```typescript
async function triggerExtraction(
  target: "human" | "system",
  persona: string,
  messages: Message[]
): Promise<void> {
  const state = await loadExtractionState();
  const entityKey = target === "human" ? "human" : `system:${persona}`;
  const entityState = state[entityKey] || createDefaultState();
  
  // Determine which types to extract
  const typesToExtract: ("fact" | "trait" | "topic" | "person")[] = [];
  
  for (const dataType of ["fact", "trait", "topic", "person"] as const) {
    // Skip types the entity doesn't have
    if (target === "system" && (dataType === "fact" || dataType === "person")) {
      continue;
    }
    
    const history = entityState[dataType];
    if (shouldExtract(dataType, history.messages_since_last_extract, history.total_extractions)) {
      typesToExtract.push(dataType);
    }
  }
  
  if (typesToExtract.length > 0) {
    // Queue fast-scan with type filter - LOW PRIORITY, INTERRUPTIBLE
    await enqueueItem({
      type: "fast_scan",
      priority: "low",  // Can be interrupted by conversation
      payload: {
        target,
        persona,
        messages,
        types_to_scan: typesToExtract
      }
    });
  }
  
  // Increment message count for all types
  for (const dataType of ["fact", "trait", "topic", "person"] as const) {
    entityState[dataType].messages_since_last_extract++;
  }
  
  await saveExtractionState(state);
}
```

## Additional: Stale Message Detection

Add a scheduled check for stale unprocessed messages:

```typescript
async function checkStaleMessages(): Promise<void> {
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  
  for (const persona of await listPersonas()) {
    const unprocessed = await getUnprocessedMessages(persona.name);
    
    for (const msg of unprocessed) {
      const age = now - new Date(msg.timestamp).getTime();
      if (age > STALE_THRESHOLD_MS) {
        // Message is stale - queue extraction now
        await triggerExtraction("human", persona.name, [msg]);
        await triggerExtraction("system", persona.name, [msg]);
      }
    }
  }
}
```

This runs on a timer (every few minutes) to catch any messages that slipped through.

## Acceptance Criteria

- [ ] ExtractionFrequencyController implemented
- [ ] Extraction state persisted to file
- [ ] shouldExtract correctly calculates based on fullness
- [ ] Topics/People always extract
- [ ] Facts/Traits taper based on fullness
- [ ] Integration with triggerExtraction flow
- [ ] Tests cover all tier transitions

## Dependencies

- 0108: Entity type definitions
- 0110: LLM queue
- 0111: Fast-scan
- 0126: LLM Queue Processor (executes queued fast-scans)

## Effort Estimate

Medium (~3 hours)
