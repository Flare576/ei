# 0100: TUI Frontend Skeleton

**Status**: PENDING
**Depends on**: 0006, 0007

## Summary

Create the terminal-based frontend for Ei using OpenTUI or similar framework. This is the foundation for local-first Ei that integrates with the filesystem and OpenCode.

## Acceptance Criteria

- [ ] TUI framework selected and scaffolded (OpenTUI, Ink, or similar)
- [ ] Implements same Ei_Interface as web frontend
- [ ] Connects to same Processor/StateManager/QueueProcessor
- [ ] Basic 3-panel layout: persona list, chat history, input
- [ ] Keyboard navigation (vim-style preferred)
- [ ] Graceful terminal resize handling
- [ ] Can run alongside OpenCode sessions

## Notes

The TUI version is the **integration point** for:
- OpenCode session awareness
- CLAUDE.md context injection
- Filesystem-based storage (EI_DATA_PATH)
- Local LLM providers

This enables the daily workflow:
```
Morning: TUI + OpenCode → work all day with shared context
Evening: Sync to flare576.com → use web version on phone
Next morning: TUI pulls latest → loop continues
```

**V1 Backward Reference**:
- "I intend to start with a web-based FrontEnd, but to build the system in such a way that we can add a better, more robust CLI/TUI with OpenTUI (or similar)."
