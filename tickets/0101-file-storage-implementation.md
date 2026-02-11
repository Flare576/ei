# 0101: FileStorage Implementation

**Status**: DONE
**Depends on**: 0003

## Summary

Implement the FileStorage backend for TUI mode, writing to EI_DATA_PATH on the local filesystem.

## Acceptance Criteria

- [x] Implements Storage interface from CONTRACTS.md
- [x] Reads/writes to `$EI_DATA_PATH` (default: `~/.local/share/ei/` per XDG spec)
- [x] Same checkpoint system as LocalStorage (slots 0-9 auto, 10-14 manual)
- [x] JSON format, human-readable when needed
- [x] Handles disk quota errors gracefully

### Moved to 0133

- Atomic writes (write to temp, then rename)
- File locking for concurrent access safety

### Out of Scope

- Migration path from LocalStorage export (web → TUI sync handled by 0106/0107)

## Notes

Directory structure:
```
~/.ei/
├── state.json           # Current state
├── checkpoints/
│   ├── auto/            # Slots 0-9
│   │   └── {timestamp}.json
│   └── manual/          # Slots 10-14
│       └── {slot}-{name}.json
├── context-export.md    # For CLAUDE.md injection
└── opencode-import/     # Staging area for session imports
```

**V1 Backward Reference**:
- "This is where the future TUI-based tool will write its data."
- EI_DATA_PATH pattern from V0
