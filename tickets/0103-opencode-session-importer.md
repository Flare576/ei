# 0103: OpenCode Session Importer

**Status**: DONE
**Depends on**: 0102, 0109

## Summary

Integrate OpenCode session reading into the Ei processor loop, creating Topics for sessions and importing messages to the appropriate agent personas.

## Acceptance Criteria

### Settings
- [x] `Human.settings.opencode_integration?: boolean` (default false)
- [x] `Human.settings.opencode_polling_interval_ms?: number` (default 1800000 = 30min)
- [x] `Human.last_opencode_sync?: string` (ISO timestamp)

### Processor Integration
- [x] TUI-only check (skip on web - no local filesystem access)
- [x] Respects `opencode_integration` setting
- [x] Respects polling interval (skip if not enough time elapsed)
- [x] Updates `last_opencode_sync` after processing

### Session → Topic Mapping
- [x] One OpenCode session = one Human.Topic
- [x] `topic.id` = session.id (for deduplication)
- [x] `topic.name` = session.title
- [x] `topic.description` = session summary (if available) or empty
- [x] `topic.persona_groups` = `["General", "Coding", "OpenCode"]`
- [x] `topic.learned_by` = first agent in session's message history
- [x] Creates topic if not exists, updates if session.title changed

### Message → Persona Mapping
- [x] Group messages by `message.agent` field
- [x] Create persona for each unique agent (via 0109)
- [x] Append messages to persona, sorted by timestamp globally
- [x] All sessions processed, THEN personas updated (single write per persona)

### Post-Processing
- [x] Trigger Human.Topic extraction on new messages (existing pipeline)
- [x] Trigger Human.Person extraction on new messages (existing pipeline)

## Notes

### Flow Diagram

```
Processor Loop (every 100ms)
  │
  ├─ Is TUI? (skip on web)
  ├─ opencode_integration enabled?
  ├─ Interval elapsed since last_opencode_sync?
  │
  ▼ YES to all
  
A. Get sessions with time.updated > last_opencode_sync
   │
   ├─ For each session:
   │   ├─ Check Human.Topics for session.id
   │   ├─ Create/update Topic with session title, groups
   │   └─ Get messages for session (since last sync)
   │
   └─ Collect all messages, grouped by agent

B. For each unique agent:
   ├─ Ensure persona exists (0109)
   └─ Collect messages for this agent

C. After ALL sessions processed:
   ├─ For each impacted persona:
   │   └─ Append messages sorted by timestamp
   └─ Update last_opencode_sync

D. Trigger extraction on new messages
```

### Trade-offs Accepted

1. **Linear message history**: If user jumps between sessions, messages are interleaved by timestamp. May not make logical sense to read linearly, but maintains chronological accuracy.

2. **All agents → separate personas**: Each OpenCode agent (build, sisyphus, atlas, etc.) becomes a separate Ei persona. Could consolidate later if desired.

3. **Static personas only**: Agent personas don't participate in ceremonies. Traits/topics come from Human-side extraction, not persona generation.

### Privacy Consideration

Session content may contain sensitive code, API keys, etc. Future enhancement: configurable patterns to redact.
