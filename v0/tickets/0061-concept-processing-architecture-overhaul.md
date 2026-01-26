# 0061: Concept Processing Architecture Overhaul (Epic)

**Status**: DONE

## Summary
Decouple concept map updates from the conversational loop to dramatically improve response times. Currently, each message triggers 3-4 sequential LLM calls (response + system concepts + human concepts + optional descriptions), creating 60-120 second delays. This epic restructures the system to generate responses immediately while processing concept updates asynchronously.

## Problem
The current architecture couples concept learning with conversation:

1. **Serial LLM Calls**: Response generation waits for concept updates to complete
2. **UX Bottleneck**: Users wait minutes for each response, even though concepts don't affect immediate response quality (LLM has full conversation context)
3. **Diminishing Returns**: Concept updates provide most value in early interactions; after an hour or two, the model stabilizes and frequent updates waste cycles
4. **Wasted Heartbeat Cycles**: Heartbeats currently trigger full LLM calls for concept updates, even when nothing meaningful changed

## Proposed Architecture

### Core Changes
1. **Response-Only Conversation Loop**: `processEvent()` only generates responses; concept updates happen asynchronously
2. **Background Concept Queue**: Dedicated queue processes concept updates for both personas and human concepts
3. **Smart Update Triggers**: Concept processing triggered by persona switch, stale messages (>20 min), not by every message
4. **Programmatic Concept Decay**: Heartbeats apply elasticity-based decay to concepts, eliminating LLM calls for routine maintenance
5. **Concept-Driven Conversation**: When decay creates significant deltas, personas naturally initiate relevant conversations

### Data Model Changes
- Add `concept_processed` flag to Message interface
- Add `last_updated` timestamp to each Concept
- Preserve `learned_by` field for human concepts (tracks which persona discovered what)

## Sub-Tickets

| Ticket | Title | Status |
|--------|-------|--------|
| 0062 | Add concept_processed flag to messages | DONE |
| 0063 | Add last_updated timestamp to concepts | DONE |
| 0064 | Implement ConceptQueue background processor | DONE |
| 0065 | Decouple processEvent from concept updates | DONE |
| 0066 | Implement queue triggers (switch, stale messages) | DONE |
| 0067 | Replace heartbeat LLM calls with programmatic decay | DONE |
| 0068 | Refine elasticity guidance and defaults | CANCELLED (superseded by 0069) |

> **Note**: 0069 (Concept Schema Overhaul) replaced elasticity with logarithmic decay and added sentiment field.

## Acceptance Criteria
- [x] Response generation completes in single LLM call time (~20-40 seconds vs current 60-120)
- [x] Concept maps continue to update accurately (just asynchronously)
- [x] No data loss - human concepts preserve learned_by attribution
- [x] Heartbeats trigger conversation based on concept deltas, not LLM re-evaluation
- [x] Personas naturally drift toward topics based on logarithmic decay (elasticity removed per 0069)
- [x] All existing tests pass with new architecture

## Value Statement
**Dramatic UX Improvement**: Reduces perceived response time by 60-70%. Users get immediate conversational flow while the system learns in the background. Enables more natural persona behavior through concept decay mechanics.

## Dependencies
- 0054: Human Concept Map Race Condition Protection (needed for queue writes)

## Effort Estimate
Large (~12-16 hours total across sub-tickets)

## Technical Notes
- ConceptQueue should be singleton, shared across all persona states
- Queue processor should handle graceful shutdown (drain queue or persist)
- Consider persisting queue to disk for crash recovery
- Elasticity decay formula needs tuning - start conservative
- 20-minute stale threshold is configurable, may need adjustment
