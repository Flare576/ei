# 0048: Save/Restore State System

**Status**: PENDING

## Summary
Implement state management system to save and restore complete EI data snapshots, with options for full system or single persona backups.

## Problem
Users need the ability to backup and restore their EI data for experimentation, recovery, or state management. No current mechanism exists to save/restore persona states, conversations, or concept maps.

## Proposed Solution
Implement comprehensive state management:

```typescript
// Save/restore commands
/saveState [name]              // Save full system state with optional name
/saveState --persona [name]    // Save only active persona state
/restoreState                  // Show numbered list of saved states
/restoreState <name|number>    // Restore specific state
```

**Implementation approach:**
- Full state: ZIP entire data folder with timestamp/name
- Persona state: Save individual persona files with metadata
- State storage: `.ei-states/` directory in data folder
- Metadata: Creation date, description, state type (full/persona)

**State file structure:**
```
.ei-states/
  full-20260111-143022.zip     # Timestamped full backup
  persona-ei-20260111.zip      # Named persona backup
  states.json                  # State metadata and descriptions
```

## Acceptance Criteria
- [ ] `/saveState` creates ZIP backup of entire data folder
- [ ] `/saveState <name>` creates named backup with user-provided identifier
- [ ] `/saveState --persona` saves only active persona's files
- [ ] `/restoreState` shows numbered list of available states with dates
- [ ] `/restoreState <name>` restores state by name
- [ ] `/restoreState <number>` restores state by list position
- [ ] State metadata includes creation date and description
- [ ] Full restore replaces entire data folder contents
- [ ] Persona restore replaces only that persona's files
- [ ] `/help` command documents save/restore syntax and options
- [ ] State files stored in `.ei-states/` subdirectory
- [ ] Restore process confirms before overwriting current state

## Value Statement
Enables safe experimentation with personas and conversations, provides backup/recovery capabilities, and allows users to manage different conversation contexts or persona configurations.

## Dependencies
- File system operations (ZIP creation/extraction)
- Existing data folder structure

## Effort Estimate
Large (~6+ hours)