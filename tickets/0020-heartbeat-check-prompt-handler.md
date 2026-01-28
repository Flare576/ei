# 0020: Heartbeat Check Prompt + Handler

**Status**: DONE
**Depends on**: 0011
**Epic**: E003 - Prompts & Handlers

## Summary

Create the prompt and handler for heartbeat checks — when a persona decides whether to proactively reach out after a period of inactivity. The Processor already queues these checks; this ticket makes them actually work.

## Acceptance Criteria

- [x] Create `src/prompts/heartbeat/check.ts` with `buildHeartbeatCheckPrompt(data): { system: string; user: string }`
- [x] Prompt includes persona identity and topics
- [x] Prompt includes human topics/people with engagement gaps (exposure_current < exposure_desired)
- [x] Prompt includes recent message history for context
- [x] Prompt asks: "Should you reach out? If yes, what about?"
- [x] Expected response format: `{ should_respond: boolean, topic?: string, message?: string }`
- [x] Implement `handleHeartbeatCheck` handler in `src/core/handlers/`
- [x] Handler parses JSON response
- [x] If `should_respond: true`, enqueue response generation with suggested topic
- [x] If `should_respond: false`, update `last_heartbeat` timestamp and done
- [ ] Unit tests for prompt structure and handler logic (deferred to E004)

## Technical Notes

### Data Contract

```typescript
interface HeartbeatCheckPromptData {
  persona: {
    name: string;
    traits: Trait[];
    topics: Topic[];
  };
  human: {
    topics: Topic[];     // Filtered, sorted by engagement gap
    people: Person[];    // Filtered, sorted by engagement gap
  };
  recent_history: Message[];  // Last N messages for context
  inactive_days: number;      // Days since last activity
}
```

### Engagement Gap

`engagement_gap = exposure_desired - exposure_current`

Topics/people with high positive gaps are "under-discussed" — good candidates for heartbeat topics.

### Handler Flow

```
handleHeartbeatCheck(response, stateManager):
  1. Parse JSON from response.parsed
  2. If should_respond === false:
     - Update persona.last_heartbeat = now
     - Done
  3. If should_respond === true:
     - Build ResponsePromptData (like 0011, but with topic hint)
     - Enqueue LLMRequest with next_step: HandlePersonaResponse
     - Include suggested topic in data for prompt customization
```

### V0 Reference

`v0/src/ei-heartbeat.ts` — `buildEiHeartbeatPrompt`, `gatherEiHeartbeatContext`

Note: V0 combined Ei-specific and general heartbeat. V1 separates them (this ticket = general, 0021 = Ei-specific).

### Integration

Processor already calls `queueHeartbeatCheck()` in `checkScheduledTasks()`. Currently it creates a stub request. This ticket:
1. Updates that to build proper HeartbeatCheckPromptData
2. Call `buildHeartbeatCheckPrompt(data)`
3. Handler processes result

## Out of Scope

- Ei-specific heartbeat logic (0021)
- Ceremony-triggered heartbeats
- Heartbeat frequency tuning
