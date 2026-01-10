# 0002: Nickname Management Commands

**Status**: PENDING

## Summary

Add `/nick add <alias>` and `/nick remove <alias>` commands to manage persona aliases at runtime.

## Problem

Currently, persona aliases are only set during creation (LLM-generated) or by manually editing system.jsonc. Users should be able to add/remove aliases without editing files.

## Proposed Solution

Add commands:
- `/nick add <alias>` - Add alias to active persona
- `/nick remove <alias>` - Remove alias from active persona
- `/nick` or `/nick list` - Show aliases for active persona

### Open Questions

**Multi-word aliases**: How to handle aliases with spaces?

Options:
1. **Quotes**: `/nick add "my buddy"` - Requires parsing quoted strings, but also expected from command line-style interfaces
2. **No spaces allowed**: Reject aliases with spaces - Simplest, maybe too restrictive
3. **Rest-of-line**: Everything after `add ` is the alias - Simple, but `/nick add foo bar` becomes alias "foo bar" (ambiguous intent)
4. **Comma-separated**: `/nick add foo, my buddy` - Allows multiple at once, clear delimiter

**Recommendation**: Start with Option 2 (no spaces). Aliases are typically short identifiers. If users request multi-word support, implement Option 1 (quotes).

**Flare Note**: If we go with Option 2 (no spaces), we'll need to add prompts to guard the LLM from creating nicknames with spaces- "Mike the Mechanic" was the first one it created.

### Edge Cases

- Adding alias that already exists on another persona → Error with helpful message
- Removing alias that doesn't exist → Warning, no-op
- Removing the last alias → Allowed (folder name is canonical)
- Case sensitivity → Store as-provided, match case-insensitively

## Acceptance Criteria

- [ ] `/nick add mike` adds "mike" as alias to active persona
- [ ] `/nick remove mike` removes "mike" from active persona  
- [ ] `/nick` lists current aliases
- [ ] Changes persist to system.jsonc immediately
- [ ] Duplicate aliases (cross-persona) are rejected with clear error
- [ ] `/help` updated to show nick commands

## Value Statement

Reduces friction for persona customization. Users can name personas naturally without editing JSON.

## Dependencies

- Persona system (complete)

## Effort Estimate

Small: ~1 hour
