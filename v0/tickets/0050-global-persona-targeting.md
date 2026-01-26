# 0050: Global -p Parameter for Command Targeting

**Status**: PENDING

## Summary
Implement global `-p <persona>` parameter that allows any command to target a different persona instead of defaulting to the active one.

## Problem
Most commands currently only work on the active persona, requiring users to switch personas to perform operations. This creates unnecessary context switching and workflow interruption.

## Proposed Solution
Add global `-p` parameter support to all persona-targeting commands:

```typescript
// Global parameter pattern
/pause -p alice 30m        // Pause Alice for 30 minutes
/archive -p bob            // Archive Bob
/poke -p charlie           // Poke Charlie
/clone newname -p diana    // Clone Diana to newname
/edit --force -p eve       // Force edit Eve
```

**Implementation approach:**
- Parse `-p <persona>` parameter in command processor
- Resolve persona name before executing command logic
- Fall back to active persona if no `-p` specified
- Validate persona exists before command execution
- Update help text for all applicable commands

**Applicable commands:**
- `/pause`, `/resume`, `/archive`, `/poke`, `/clone`, `/edit`, `/fresh`
- Any future commands that operate on personas

## Acceptance Criteria
- [ ] `-p <persona>` parameter works with all persona-targeting commands
- [ ] Commands default to active persona when `-p` not specified
- [ ] Invalid persona names show helpful error messages
- [ ] Parameter parsing handles persona names with spaces/special chars
- [ ] `/help` command shows `-p` parameter in syntax for applicable commands
- [ ] Global parameter works consistently across all command implementations
- [ ] Error handling provides clear feedback for non-existent personas
- [ ] Parameter can appear before or after other command arguments
- [ ] Tab completion suggests persona names for `-p` parameter
- [ ] Commands maintain existing behavior when `-p` not used

## Value Statement
Reduces context switching and improves workflow efficiency by allowing users to operate on any persona without changing the active selection.

## Dependencies
- Command parsing system
- Persona name resolution
- All persona-targeting commands

## Effort Estimate
Medium (~3-4 hours)