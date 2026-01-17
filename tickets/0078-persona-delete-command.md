# 0078: Persona Delete Command

**Status**: PENDING

## Summary
Implement a `/delete` command to permanently remove archived personas with safety checks and optional cleanup of human concepts learned from that persona.

## Problem
Users can archive personas but have no way to permanently remove them. Over time, archived personas accumulate, taking up storage and potentially containing outdated or unwanted data.

## Proposed Solution
Implement a safe deletion system that only operates on archived personas:

```typescript
/delete                    // Shows usage message, no action
/delete <persona>          // Deletes archived persona with confirmations
```

**Safety Flow:**
1. Validate persona exists and is archived (error if not archived)
2. Block deletion of `ei` persona (system-critical)
3. First confirmation: "Are you sure? This cannot be undone."
4. Second prompt: "Do you want to delete topics created by this persona?"
   - If yes: Remove human concepts with `learned_by` === persona
   - If no: Keep human concepts intact
5. Delete persona files (history, concept map, metadata)

## Acceptance Criteria
- [ ] `/delete` without argument shows usage message, does not delete anything
- [ ] `/delete <name>` errors if persona is not archived with helpful message
- [ ] `/delete ei` is blocked with clear error message
- [ ] `/delete <archived_persona>` shows confirmation prompt with "cannot be undone" warning
- [ ] User can cancel at confirmation prompt (y/n, default to no)
- [ ] After first confirmation, asks "Do you want to delete topics created by this persona?" (y/n)
- [ ] If yes, removes all human concepts where `learned_by` matches persona
- [ ] If no, preserves all human concepts
- [ ] Successfully deletes persona history file
- [ ] Successfully deletes persona concept map file
- [ ] Removes persona from any in-memory state
- [ ] Displays success message with what was deleted
- [ ] `/help` documents `/delete` command syntax and safety features

## Value Statement
Provides users with data hygiene control while preventing accidental deletions through multiple safety checks and archive-only restriction.

## Dependencies
- 0043: Archive/Unarchive Personas (must be able to identify archived personas)

## Implementation Notes

### Files to Delete
- `{dataPath}/history/{persona}.jsonc` - Chat history
- `{dataPath}/concepts/{persona}.jsonc` - Persona's concept map

### Concept Cleanup Logic
```typescript
// Human concepts with learned_by matching deleted persona
const humanConcepts = loadConceptMap('human');
const updatedConcepts = Object.fromEntries(
  Object.entries(humanConcepts).filter(
    ([_, concept]) => concept.learned_by !== deletedPersona
  )
);
```

### Safety Checks (in order)
1. No argument provided → usage message
2. Persona === 'ei' → block with error
3. Persona not found → error
4. Persona not archived → error with suggestion to `/archive` first
5. User confirmation #1 (delete persona) → can cancel
6. User confirmation #2 (delete topics) → can cancel

### Error Messages
- "Usage: /delete <persona> - Deletes an archived persona (cannot be undone)"
- "Cannot delete 'ei' - this persona is system-critical"
- "Cannot delete '{persona}' - persona not found"
- "Cannot delete '{persona}' - only archived personas can be deleted. Use /archive first."
- "Delete '{persona}'? This cannot be undone. (y/n): "
- "Delete topics created by '{persona}'? This will remove concepts from human's map. (y/n): "

### Success Message
```
Deleted persona '{persona}':
- Chat history (N messages)
- Concept map (N concepts)
[- Human topics learned from this persona (N concepts)]
```

## Effort Estimate
Small (~2-3 hours)

## Testing Considerations
- Test with non-existent persona
- Test with active (non-archived) persona
- Test with 'ei' persona
- Test cancellation at each confirmation
- Test concept deletion (yes and no paths)
- Test file deletion success
- Verify human concept map integrity after deletion
