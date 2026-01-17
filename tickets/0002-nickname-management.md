# 0002: Nickname Management Commands

**Status**: QA

## Summary

Add `/nick add <alias>` and `/nick remove <alias>` commands to manage persona aliases at runtime.

## Problem

Currently, persona aliases are only set during creation (LLM-generated) or by manually editing system.jsonc. Users should be able to add/remove aliases without editing files.

## Proposed Solution

Add commands:
- `/nick add <alias>` - Add alias to active persona
- `/nick remove <alias>` - Remove alias from active persona
- `/nick` or `/nick list` - Show aliases for active persona

### Multi-word Alias Handling

**Decision**: Support quoted strings (Option 1) with intelligent partial matching for removal.

**Adding aliases**:
- `/nick add "Bob the Builder"` - Adds "Bob the Builder" as alias
- Quote parsing required (support both single and double quotes)
- Unquoted multi-word input takes first word only: `/nick add Bob the Builder` → alias "Bob" (standard CLI behavior)

**Removing aliases**:
- `/nick remove "Bob the Builder"` - Exact match removal
- `/nick remove "Bob the"` - Partial match removal IF only one alias matches
- If partial match is ambiguous (matches multiple aliases), error with list of matches
- Case-insensitive matching

**Rationale**: Flexibility for natural language aliases (matching LLM-generated names like "Mike the Mechanic") while preventing accidental bulk deletion.

### Edge Cases

- Adding alias that already exists on another persona → Error with helpful message
- Removing alias that doesn't exist → Warning, no-op
- Removing the last alias → Allowed (folder name is canonical)
- Case sensitivity → Store as-provided, match case-insensitively

## Acceptance Criteria

- [x] `/nick add mike` adds "mike" as alias to active persona
- [x] `/nick add "Bob the Builder"` adds multi-word alias with quotes
- [x] `/nick add Bob the Builder` (no quotes) adds "Bob" only (first word)
- [x] `/nick remove mike` removes exact match "mike" from active persona
- [x] `/nick remove "Bob the"` removes alias IF only one partial match exists
- [x] `/nick remove "Bob"` errors with list of matches IF multiple aliases contain "Bob"
- [x] `/nick` lists current aliases for active persona
- [x] Changes persist to system.jsonc immediately
- [x] Duplicate aliases (cross-persona) are rejected with clear error
- [x] `/help` updated to show nick commands with quote examples

## Test Coverage

### Unit Tests
- **parseQuotedArgs** (`tests/unit/parse-utils.test.ts`):
  - ✅ 17/17 tests passing (parseCommandArgs + parseQuotedArgs)
  - Covers empty input, single/multi-word strings, quoted strings, unclosed quotes, edge cases, CLI validation

- **findPersonaByAlias** (`tests/unit/storage.test.ts`):
  - ✅ Tests added for case-insensitive matching, exact match, null returns

### Integration Tests  
- **Command handler** (`tests/integration/command-flow.test.ts`):
  - ✅ 38/38 tests passing (includes 16 Nick Command Flow tests + 3 persona partial match tests)
  - Tests add/remove operations, partial matching, ambiguous cases, validation
  - **Bug Fix**: Changed `vi.clearAllMocks()` to `vi.resetAllMocks()` to properly reset mock implementations between tests

### Build Status
- ✅ TypeScript compilation successful
- ✅ LSP diagnostics clean on all changed files
- ✅ All acceptance criteria verified via integration tests

## Value Statement

Reduces friction for persona customization. Users can name personas naturally without editing JSON.

## Dependencies

- Persona system (complete)

## Effort Estimate

Small: ~1 hour
