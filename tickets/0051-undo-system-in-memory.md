# 0051: Undo System (In-Memory State)

**Status**: PENDING

⚠️ **DESIGN WARNING**: This feature has significant conceptual issues with EI's architecture. The undo system would only roll back individual persona states, not the global human concept map changes. This creates an inconsistent state where a persona's actions are undone but their impact on the human's concept map remains. This may not align with EI's design philosophy of persistent concept evolution.

## Summary
Implement in-memory undo system that saves persona state before each trigger (message/heartbeat) and allows rollback of unwanted changes.

## Problem
Users may want to undo persona responses or concept map changes when interactions don't go as expected, but currently have no way to revert persona state changes.

## Proposed Solution
Implement per-persona undo stack with in-memory state snapshots:

```typescript
// Undo system structure
interface UndoState {
  conceptMap: ConceptMap;
  chatHistory: Message[];
  timestamp: Date;
}

interface PersonaUndoStack {
  states: UndoState[];
  maxStates: number; // Default: 10
}

// Commands
/undo [persona]     // Undo last action for persona (default: active)
/undo 3 [persona]   // Undo last 3 actions
```

**Implementation approach:**
- Save persona state before every trigger (message, heartbeat, poke)
- Keep configurable number of undo states in memory (default: 10)
- Roll back concept map and chat history to previous state
- **LIMITATION**: Cannot undo changes to human concept map

## Acceptance Criteria
- [ ] Save persona state before every message/heartbeat trigger
- [ ] `/undo` rolls back active persona to previous state
- [ ] `/undo <persona>` rolls back specified persona
- [ ] `/undo 3` rolls back 3 states for active persona
- [ ] Undo stack maintains configurable number of states (default: 10)
- [ ] Undo restores both concept map and chat history
- [ ] Clear warning that human concept map changes are NOT undone
- [ ] Undo states stored in memory only (not persisted)
- [ ] `/help` command documents undo limitations and syntax
- [ ] Visual confirmation shows what was undone

## Value Statement
Provides safety net for experimentation with persona interactions, though with significant limitations due to architectural constraints.

## Dependencies
- Existing persona state management
- Concept map serialization

## Effort Estimate
Large (~6+ hours)

## Notes
This feature may fundamentally conflict with EI's concept-driven architecture where all interactions contribute to persistent learning. Consider whether this aligns with the system's design philosophy.