# 0105: CLAUDE.md Context Injector

**Status**: PENDING
**Depends on**: 0104

## Summary

Automatically inject Ei's exported context into `~/.claude/CLAUDE.md` (or project-specific AGENTS.md files), enabling OpenCode to start sessions with full awareness of Flare's current state.

## Acceptance Criteria

- [ ] Reads context from `~/.ei/context-export.md`
- [ ] Injects into `~/.claude/CLAUDE.md` between markers
- [ ] Preserves existing CLAUDE.md content outside markers
- [ ] Supports project-specific injection to AGENTS.md
- [ ] Idempotent: re-running updates rather than duplicates
- [ ] CLI command: `ei inject-context [--target PATH]`
- [ ] Option: Auto-run on Ei state changes
- [ ] Option: Auto-run before OpenCode session starts (if hook available)

## Notes

Injection markers:
```markdown
<!-- EI_CONTEXT_START -->
... auto-generated content ...
<!-- EI_CONTEXT_END -->
```

The injector should:
1. Find markers in target file
2. Replace content between markers
3. If no markers, append to end with markers

This completes the "Ei → OpenCode" direction. Combined with 0103 (OpenCode → Ei), we have the full bidirectional loop.

**Future**: If OpenCode supports pre-session hooks, auto-inject could be triggered automatically.
