# 0051: Undo System (In-Memory State)

**Status**: CANCELLED

## Superseded By
**Ticket #0048: Unified State Management System**

This ticket has been superseded by a more comprehensive design that addresses the architectural concerns raised below.

## Why Cancelled

⚠️ **DESIGN WARNING**: This feature had significant conceptual issues with EI's architecture. The original design proposed per-persona undo, which would only roll back individual persona states, not the global human concept map changes. This creates an inconsistent state where a persona's actions are undone but their impact on the human's concept map remains.

With the introduction of:
- Async concept processing
- Group-based visibility (personas affecting each other's visible concepts)
- Cross-persona concept propagation

A **system-wide state management** approach became necessary. Individual persona undo is no longer architecturally sound.

## New Design (See #0048)
The unified state management system in #0048 addresses these issues by:
- Snapshotting the **entire system state** (all personas + human concepts)
- Treating undo as a full system restore, not per-persona
- Providing both in-memory undo (ephemeral) and disk saves (persistent)
- Ensuring consistency across all concept maps during rollback

---

## Original Proposal (For Reference)

### Summary
Implement in-memory undo system that saves persona state before each trigger (message/heartbeat) and allows rollback of unwanted changes.

### Problem
Users may want to undo persona responses or concept map changes when interactions don't go as expected, but currently have no way to revert persona state changes.

### Proposed Solution
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

### Acceptance Criteria (Not Implemented)
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

### Value Statement
Would have provided safety net for experimentation with persona interactions, but with significant limitations due to architectural constraints.

### Dependencies
- Existing persona state management
- Concept map serialization

### Effort Estimate
Large (~6+ hours)

### Notes
This feature fundamentally conflicted with EI's concept-driven architecture where all interactions contribute to persistent learning. The unified state management approach in #0048 resolves these concerns by treating undo as a full system restore.
