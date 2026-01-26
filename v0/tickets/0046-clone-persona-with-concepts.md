# 0046: Clone Persona with Concept Map

**Status**: PENDING

## Summary
Implement `/clone <new_name>` command to create a new persona based on the active persona's concept map, with optional chat history copying.

## Problem
Users may want to create variations of existing personas or branch conversations while preserving the learned concepts and personality traits that have developed over time.

## Proposed Solution
Implement persona cloning with concept inheritance:

```typescript
// Clone command with options
/clone <new_name>                    // Clone concepts only
/clone <new_name> --with-history     // Clone concepts + chat history
```

**Cloning process:**
1. Prompt user for modifications (similar to persona creation)
2. Copy active persona's concept map to new persona
3. Run persona generator with existing concepts + user modifications
4. Optionally copy chat history if `--with-history` specified
5. Create new persona files with cloned data

**User modification prompts:**
- "What should be different about this persona?"
- "Any personality traits to modify?"
- "Different expertise or interests?"

## Acceptance Criteria
- [ ] `/clone <name>` creates new persona with active persona's concept map
- [ ] Cloning process prompts user for desired modifications
- [ ] New persona generator receives existing concept map as input
- [ ] `--with-history` flag copies chat history to new persona
- [ ] Cloned persona has unique identity while preserving learned concepts
- [ ] New persona appears in persona list immediately after creation
- [ ] Cloning preserves concept relationships and personality traits
- [ ] `/help` command documents clone syntax and options
- [ ] Clone process validates new persona name doesn't conflict
- [ ] User can modify core traits while keeping learned knowledge

## Value Statement
Enables users to create persona variations and conversation branches while preserving valuable concept development, reducing the need to rebuild persona knowledge from scratch.

## Dependencies
- Existing persona creation system
- Concept map storage and loading

## Effort Estimate
Medium (~3-4 hours)