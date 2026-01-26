# 0140: Deferred Exposure Level Updates and Logarithmic Decay

**Status**: PENDING

## Overview

Move exposure level (`level_current`) updates from real-time extraction to a deferred batch process. This enables accurate topic engagement tracking and proper logarithmic decay timing.

## Problem

Current extraction runs on small conversation snapshots, making it impossible to accurately determine:
- Which topics were actually discussed in a session
- How much exposure each topic received
- Which topics were NOT discussed (for decay)

**Current behavior (incorrect):**
- Extraction runs every N messages during active conversation
- Each extraction sees only recent messages
- Can't distinguish "not discussed yet" from "discussed earlier"
- Decay runs on schedule, regardless of conversation state

**What we need:**
- Wait until conversation session ends (user idle, day ends, or ceremony)
- Analyze FULL conversation session for topic exposure
- Update `level_current` based on complete picture
- THEN run decay on topics that weren't discussed

## Solution: Deferred Exposure Analysis

### Trigger Options (Choose One)

1. **After User Idle** (RECOMMENDED): Run when user hasn't sent messages for 1 hour
2. **End of Day**: Run during Daily Ceremony (simple, but delayed)
3. **Hybrid**: After idle OR at ceremony, whichever comes first

**Recommendation**: Start with #1 (idle detection), add #3 later if needed.

### Implementation

#### 1. Track Conversation Sessions

```typescript
// src/types.ts
export interface ExtractionState {
  // ... existing fields ...
  
  current_session: {
    start_time: string;  // ISO timestamp
    message_count: number;
    last_message_time: string;  // ISO timestamp
  } | null;
  
  pending_exposure_analysis: boolean;
}
```

#### 2. Defer Exposure Updates During Extraction

Modify Step 3 (update prompts) to skip `level_current` field:

```typescript
// src/prompts/extraction/step3/update.ts

// For Topics and People during real-time extraction:
// - Update: name, description, sentiment, level_ideal
// - SKIP: level_current (deferred to batch analysis)
```

#### 3. Create Exposure Analysis Prompts

```typescript
// src/prompts/exposure/topics.ts

export function buildTopicExposurePrompt(
  messages: Message[],
  topics: Topic[],
  personaName: string
): { system: string; user: string } {
  // Analyze FULL conversation session
  // Return: Map of topic name → exposure delta
  // Format: { "topic_name": 0.3, "another_topic": 0.1 }
}

// Similar for People exposure
```

**Prompt should answer:**
- Which topics were discussed?
- How much time/attention did each get?
- Were they central or tangential?
- Return exposure DELTA (not absolute value)

#### 4. Batch Exposure Update Function

```typescript
// src/exposure-analysis.ts

export async function runExposureAnalysis(
  target: "human" | "system",
  persona: string,
  sessionMessages: Message[],
  signal?: AbortSignal
): Promise<void> {
  // 1. Load entity
  // 2. Extract topics/people that exist
  // 3. Call LLM with FULL session messages
  // 4. Get exposure deltas for each topic/person
  // 5. Update level_current (cap at 1.0)
  // 6. Save entity
  // 7. Queue decay for topics NOT in the delta map
}
```

#### 5. Idle Detection & Trigger

```typescript
// src/processor.ts or new file

let idleTimer: NodeJS.Timeout | null = null;
const IDLE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export function onMessageSent() {
  // Reset idle timer
  if (idleTimer) clearTimeout(idleTimer);
  
  idleTimer = setTimeout(async () => {
    appendDebugLog("[Idle] User idle for 1 hour - triggering exposure analysis");
    await triggerExposureAnalysis();
  }, IDLE_THRESHOLD_MS);
}

async function triggerExposureAnalysis() {
  // Get session messages from extraction state
  // Enqueue exposure analysis for each active persona
  // Mark session complete
}
```

#### 6. Decay Timing

Move decay from scheduled/heartbeat to post-exposure:

```typescript
// After exposure analysis completes:

const discussedTopics = new Set(exposureDeltas.keys());
const allTopics = entity.topics;

for (const topic of allTopics) {
  if (!discussedTopics.has(topic.name)) {
    // Topic was NOT discussed - apply decay
    topic.level_current = applyLogarithmicDecay(
      topic.level_current,
      timeSinceLastUpdate
    );
  }
}
```

### Queue Integration

Add new queue item type:

```typescript
// src/llm-queue.ts

export interface ExposureAnalysisPayload {
  target: "human" | "system";
  persona: string;
  session_start: string;
  session_end: string;
  message_count: number;
}

export type LLMQueueItemType = 
  | "fast_scan"
  | "detail_update"
  | "description_regen"
  | "ei_validation"
  | "exposure_analysis";  // NEW
```

## Acceptance Criteria

- [ ] Create `src/prompts/exposure/topics.ts` for full-session topic analysis
- [ ] Create `src/prompts/exposure/people.ts` for full-session people analysis
- [ ] Create `src/exposure-analysis.ts` with batch update logic
- [ ] Modify Step 3 prompts to skip `level_current` updates
- [ ] Add idle detection (1 hour threshold)
- [ ] Queue exposure analysis on idle trigger
- [ ] Move decay to run AFTER exposure analysis
- [ ] Add session tracking to extraction state
- [ ] Test: Single topic discussed → `level_current` increases
- [ ] Test: Topic not discussed → `level_current` decays
- [ ] Test: Multiple topics → exposure distributed appropriately
- [ ] Test: Idle trigger fires after 1 hour of no messages

## Dependencies

- 0134 (Three-Step Extraction) - established extraction patterns
- 0136 (Persona Traits) - demonstrates persona-specific extraction

## Files Changed

| File | Changes |
|------|---------|
| `src/prompts/exposure/topics.ts` | NEW - Full-session topic exposure analysis |
| `src/prompts/exposure/people.ts` | NEW - Full-session people exposure analysis |
| `src/prompts/exposure/index.ts` | NEW - Export structure |
| `src/exposure-analysis.ts` | NEW - Batch exposure update orchestration |
| `src/prompts/extraction/step3/update.ts` | Skip `level_current` in real-time extraction |
| `src/types.ts` | Add session tracking to ExtractionState |
| `src/processor.ts` | Add idle detection and trigger logic |
| `src/llm-queue.ts` | Add `exposure_analysis` queue item type |
| `src/queue-processor.ts` | Handle `exposure_analysis` execution |

## Testing

### Manual Tests

1. **Basic Exposure Increase**:
   - Have conversation about "TypeScript"
   - Wait 1 hour (or trigger manually)
   - Verify `level_current` for "TypeScript" topic increased

2. **Decay for Undiscussed Topics**:
   - Have existing topic "Cooking" with `level_current: 0.8`
   - Have conversation about something else
   - Wait for exposure analysis
   - Verify "Cooking" decayed

3. **Multiple Topics**:
   - Discuss "Work" extensively, mention "Hobbies" briefly
   - Verify "Work" gets larger exposure delta than "Hobbies"

4. **Idle Detection**:
   - Send message
   - Wait 1 hour
   - Verify exposure analysis triggered
   - Send another message within 1 hour
   - Verify timer resets

### Edge Cases

- Session with zero topics discussed → All topics decay
- New topic created mid-session → Should appear in exposure analysis
- User quits before idle timer → Handle gracefully (queue analysis on shutdown?)

## Related Tickets

- **0134**: Three-Step Extraction - established patterns to follow
- **0136**: Persona Trait Behavior Detection - peer persona extraction system
- **0137**: Persona Topic Exploration - will benefit from accurate exposure tracking

## Notes

### Why This Matters

**Current problem example:**
- User discusses "Python" in messages 1-5
- Extraction runs after message 5 → sees "Python"
- Extraction runs again after message 10 → doesn't see "Python" in recent 5 messages
- Second extraction thinks "Python" wasn't discussed

**With deferred analysis:**
- Wait until session ends
- Analyze all 10 messages at once
- Accurate view of what was discussed

### Logarithmic Decay Timing

Current decay runs on schedule (heartbeats, ceremony). This is wrong because:
1. Can't distinguish "not discussed yet today" from "discussed earlier"
2. Decay might run mid-conversation, distorting current engagement

Correct timing:
1. Wait for session to end
2. Update exposure for discussed topics
3. THEN decay undiscussed topics
4. Clear distinction between "active" and "stale"

### Future Enhancements

- Track exposure per conversation session (history of engagement over time)
- Adaptive idle threshold (shorter for active users, longer for occasional users)
- Exposure visualization in `/clarify` command
- Session boundaries could inform conversation continuation prompts

## Implementation Priority

**Medium-High**: This affects data quality for topic tracking, but current system is functional (just noisy). Recommend implementing after 0136/0137 complete to establish persona extraction patterns first.
