# 0079: Validate Command Argument Counts

**Status**: PENDING

## Summary

Add proper CLI-style argument validation to all commands to reject extra/unexpected arguments with helpful error messages.

## Problem

Currently, most commands silently ignore extra arguments. Examples of problematic behavior:
- `/persona thing1 thing2` → Uses "thing1", silently ignores "thing2"
- `/quit cats` → Quits, ignores "cats" 
- `/pause foo bar` → May behave unpredictably

This violates standard CLI expectations where tools like `cp file1 file2 file3` fail with clear errors about argument count.

The `/nick` command (ticket 0002) now properly validates argument counts using `parseCommandArgs()` and should serve as the reference implementation.

## Proposed Solution

Audit all command handlers in `src/blessed/app.ts` and add argument validation:

### Commands to Update

1. **`/persona [name]`** - Should accept 0 or 1 arg (0 = list, 1 = switch/create)
2. **`/quit [--force]`** - Should accept 0 or 1 arg (validates --force format already, but may not reject random text)
3. **`/pause [duration]`** - Should accept 0 or 1 arg (0 = indefinite, 1 = duration)
4. **`/resume [persona]`** - Should accept 0 or 1 arg
5. **`/archive [persona]`** - Should accept 0 or 1 arg
6. **`/unarchive [name|#]`** - Should accept 0 or 1 arg
7. **`/refresh`** - Should accept 0 args
8. **`/help`** - Should accept 0 args
9. **`/editor`** - Should accept 0 args

### Implementation Pattern (from `/nick`)

```typescript
const { parseCommandArgs } = await import('../parse-utils.js');
const parts = parseCommandArgs(args);

if (parts.length !== expectedCount) {
  this.setStatus('Usage: /command <expected args>');
  return;
}
```

### Benefits

- **Consistent CLI behavior** - Matches user expectations from shell tools
- **Early error detection** - Catches typos and misuse immediately
- **Better UX** - Clear error messages instead of silent misbehavior
- **Prevents bugs** - Extra args can't accidentally affect behavior

## Acceptance Criteria

- [ ] All commands validate argument count before processing
- [ ] Extra arguments show usage message
- [ ] Existing valid usage patterns still work
- [ ] `/help` updated if command syntax descriptions need clarification
- [ ] Tests added/updated to verify argument validation
- [ ] Commands properly handle quoted arguments (use `parseCommandArgs()`)

## Edge Cases

- Commands that accept optional args (like `/persona`) need to validate range (0-1, not 0-2)
- `/quit --force` already validates the flag, but should reject `/quit --force extra stuff`
- Some commands may legitimately take variable args in the future - document why if so

## Dependencies

- Completed: 0002 (Nickname Management) - established the pattern with `parseCommandArgs()`

## Effort Estimate

Small-Medium: ~2-3 hours
- 9 commands to update
- Pattern is established, mostly copy-paste-adjust
- Tests need updates

## Notes

This ticket was created while implementing ticket 0002. The `/nick` command now serves as the reference for proper CLI argument validation using the `parseCommandArgs()` utility function from `src/parse-utils.ts`.
