# 0101: FileStorage Implementation

**Status**: PENDING
**Depends on**: 0003

## Summary

Implement the FileStorage backend for TUI mode, writing to EI_DATA_PATH on the local filesystem.

## Acceptance Criteria

- [ ] Implements Storage interface from CONTRACTS.md
- [ ] Reads/writes to `$EI_DATA_PATH` (default: `~/.ei/`)
- [ ] Same checkpoint system as LocalStorage (slots 0-9 auto, 10-14 manual)
- [ ] Atomic writes (write to temp, then rename)
- [ ] File locking for concurrent access safety
- [ ] JSON format, human-readable when needed
- [ ] Migration path from LocalStorage export

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
