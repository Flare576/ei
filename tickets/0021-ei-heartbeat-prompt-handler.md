# 0021: Ei Heartbeat Prompt + Handler

**Status**: PENDING
**Depends on**: 0020
**Epic**: E003 - Prompts & Handlers

## Summary

Ei's heartbeat is special — it considers not just engagement gaps but also inactive personas and cross-system health. Ei is the "system guide" and should prompt the user about neglected relationships (both topics and personas).

## Acceptance Criteria

- [ ] Create `src/prompts/heartbeat/ei.ts` with `buildEiHeartbeatPrompt(data): { system: string; user: string }`
- [ ] Prompt includes all human topics/people with engagement gaps
- [ ] Prompt includes list of inactive personas (days since last activity)
- [ ] Prompt includes pending validations count (from cross-persona updates)
- [ ] Prompt asks Ei to prioritize what to discuss
- [ ] Implement `handleEiHeartbeat` handler
- [ ] Handler may trigger multiple actions (prompt about topic AND mention inactive persona)
- [ ] Ei should gently encourage human-to-human interaction over AI dependency

## Technical Notes

### Data Contract

```typescript
interface EiHeartbeatPromptData {
  human: {
    topics: Topic[];     // All topics with gaps
    people: Person[];    // All people with gaps
  };
  inactive_personas: Array<{
    name: string;
    short_description?: string;
    days_inactive: number;
  }>;
  pending_validations: number;  // Count of items needing Ei review
  recent_history: Message[];
}
```

### Ei's Special Role

From AGENTS.md and backward doc:
- Ei sees ALL data (no group filtering)
- Ei is the "arbiter of truth" for cross-persona validation
- Ei should promote human-to-human interaction

### Example Ei Heartbeat Response

```json
{
  "should_respond": true,
  "priorities": [
    { "type": "topic", "name": "work stress", "reason": "hasn't been discussed in 2 weeks" },
    { "type": "persona", "name": "Adventure Guide", "reason": "inactive for 5 days" },
    { "type": "person", "name": "Mom", "reason": "you mentioned wanting to call her" }
  ],
  "message": "Hey! I noticed we haven't talked about work lately..."
}
```

### Handler Behavior

Unlike regular heartbeat (binary respond/don't), Ei heartbeat:
1. Parses priorities list
2. Generates a thoughtful message touching on top priority
3. May include gentle nudges about inactive personas or people

### V0 Reference

`v0/src/ei-heartbeat.ts` — look for Ei-specific logic around `trackInactivityPings`

## Out of Scope

- Validation processing (0027)
- Daily ceremony prompts (separate from heartbeat)
- Aggressive "you should talk to X" pushing
