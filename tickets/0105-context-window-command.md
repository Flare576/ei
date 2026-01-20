# 0105: Context Window Command

**Status**: PENDING

## Problem

When conversations span long time gaps (e.g., roleplay session at night, resume in morning), the 8-hour default context window means the LLM loses specific details. Concept maps preserve abstract knowledge ("Human likes roleplay with Frodo") but not scene-specific context ("The dragon had just appeared when we stopped").

Users need a way to **expand** the context window to include older messages.

## Solution

Add a `/context` command that allows users to adjust the per-persona context window. The window is **sliding** (always relative to now) and **persisted** in `system.jsonc`.

### New Schema Field

Add to `ConceptMap` (system entities only):

```typescript
/**
 * CONTEXT_HOURS: How far back (in hours) to include messages in LLM context
 * Range: 1 to 168 (7 days, matching HISTORY_MAX_DAYS)
 * Default: 8 (current hardcoded behavior)
 * Only meaningful for entity: "system"
 */
context_hours?: number;
```

### Commands

```
/context                    Show current context window and usage hint
/context 24h                Set window to 24 hours (default action: set)
/context set 24h            Explicitly set window to 24 hours
/context add 8h             Add 8 hours to current window
/context sub 4h             Subtract 4 hours from current window
/context reset              Reset to default (8h)
/context edit               Advanced: open full history in $EDITOR
```

### Time Parsing

Use libraries for natural language time parsing:

- **chrono-node**: For relative dates ("yesterday", "tomorrow", "last monday")
- **parse-duration**: For duration strings ("24h", "2 days", "1 week")

Supported formats:
- Duration: `24h`, `2d`, `1 week`, `48 hours`, `2h 30m`
- Relative: `yesterday`, `tomorrow` (converted to hours from now)
- Keywords: `reset`, `default` (restore 8h)

### `/context edit` (Advanced Mode)

Opens `$EDITOR` with full message history (excluding `[CONTEXT_CLEARED]` markers):

```
# EI Context Editor - Frodo
# 
# This file contains your conversation history with Frodo.
# When you save and close:
#   1. A new context boundary will be created
#   2. The remaining messages become the persona's context
#
# Delete any messages you don't want included.
# Save empty file to cancel.

---

[2025-01-18 22:15:03] Human: Let's continue our journey...
[2025-01-18 22:15:45] Frodo: *adjusts pack* The path ahead looks treacherous...
[2025-01-18 22:20:12] Human: I see smoke in the distance
...
```

On save:
1. Parse remaining messages
2. Insert `[CONTEXT_CLEARED]` marker
3. Insert `[PRIOR_CONTEXT_PROVIDED]` marker with summary or first line preview
4. Feed parsed messages as synthetic history

This also serves as the mechanism to "erase" past `/new` calls - user must rebuild context manually.

## Constraints

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Minimum | 1h | Prevent useless 0h window |
| Maximum | 168h (7 days) | Match `HISTORY_MAX_DAYS` |
| Default | 8h | Current behavior |

## Persistence Behavior

- Window is per-persona (stored in persona's `system.jsonc`)
- Survives app restart
- Survives persona switches (each persona has own window)
- Does NOT affect `/new` markers - those are absolute boundaries

## Interaction with `/new`

- `/new` creates a `[CONTEXT_CLEARED]` marker - an absolute boundary
- `/context` adjusts the time-based window
- Both limits apply: messages must be within time window AND after last clear marker
- `/context edit` is the only way to recover messages from before a `/new` marker

## Dependencies

New npm packages:
- `chrono-node` - natural language date parsing
- `parse-duration` - duration string parsing

## Acceptance Criteria

### Schema & Storage
- [ ] Add `context_hours?: number` to `ConceptMap` interface
- [ ] Default to 8 when undefined (backward compatible)
- [ ] Validate range [1, 168] on save

### Command: `/context` (no args)
- [ ] Display current window: "Context window: 24h (default: 8h)"
- [ ] Show usage hint with examples

### Command: `/context <duration>`
- [ ] Parse duration using parse-duration
- [ ] Parse relative times using chrono-node ("yesterday" -> hours since yesterday)
- [ ] Default action is SET
- [ ] Clamp to [1, 168] range with warning if clamped
- [ ] Save to persona's system.jsonc
- [ ] Display confirmation: "Context window set to 24h"

### Command: `/context set|add|sub <duration>`
- [ ] `set`: Replace current value
- [ ] `add`: Add to current value
- [ ] `sub`: Subtract from current value (floor at 1h)
- [ ] All respect [1, 168] bounds

### Command: `/context reset`
- [ ] Remove `context_hours` from schema (use default)
- [ ] Display: "Context window reset to default (8h)"

### Command: `/context edit`
- [ ] Load full history (all messages, ignoring time window)
- [ ] Exclude `[CONTEXT_CLEARED]` marker messages from display
- [ ] Format with timestamps and speaker labels
- [ ] Include instruction header
- [ ] Open in `$EDITOR` (or `vi` fallback)
- [ ] On save: parse messages, create new boundary, inject as context
- [ ] On empty save: cancel operation
- [ ] Show `[PRIOR_CONTEXT_PROVIDED]` or similar marker in chat

### Integration
- [ ] `getRecentMessages()` reads `context_hours` from persona's concept map
- [ ] Pass persona parameter through call chain
- [ ] Maintain backward compatibility (undefined = 8h)

### Help Text
- [ ] Update `/help` with `/context` documentation

## Testing

- [ ] Unit: Duration parsing (various formats)
- [ ] Unit: Relative time conversion ("yesterday" -> hours)
- [ ] Unit: Bounds clamping
- [ ] Unit: add/sub arithmetic
- [ ] Integration: Persistence across restart
- [ ] Integration: Per-persona isolation
- [ ] E2E: Full workflow with actual persona

## Implementation Notes

### Time Parsing Logic

```typescript
import * as chrono from 'chrono-node';
import parseDuration from 'parse-duration';

function parseContextTime(input: string): number | null {
  const lower = input.toLowerCase().trim();
  
  // Special keywords
  if (lower === 'reset' || lower === 'default') return null; // Signal to reset
  
  // Try duration first (most common case)
  const durationMs = parseDuration(input);
  if (durationMs && durationMs > 0) {
    return Math.round(durationMs / (1000 * 60 * 60)); // Convert to hours
  }
  
  // Try relative date
  const date = chrono.parseDate(input);
  if (date) {
    const hoursAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60);
    if (hoursAgo > 0) {
      return Math.ceil(hoursAgo);
    }
  }
  
  return null; // Unparseable
}
```

### getRecentMessages Update

```typescript
export async function getRecentMessages(
  history: ConversationHistory,
  maxHours?: number,  // Now optional, loaded from persona if not provided
  maxMessages: number = 100,
  persona?: string
): Promise<Message[]> {
  // If maxHours not provided, load from persona's context_hours
  if (maxHours === undefined && persona) {
    const conceptMap = await loadConceptMap("system", persona);
    maxHours = conceptMap.context_hours ?? 8;
  }
  maxHours = maxHours ?? 8;
  
  // ... rest of existing logic
}
```

## Open Questions

1. Should `/context edit` preserve original timestamps or regenerate them?
   - **Decision**: Preserve original timestamps - they're part of the context

2. What marker to show for edited context?
   - **Decision**: `[PRIOR_CONTEXT_PROVIDED]` with truncated first line or message count

## Related Tickets

- 0044: New Conversation Command (created `/new`)
- 0048: Unified State Management (undo/save/restore)
