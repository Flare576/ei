# 0108: OpenCode File Watcher

**Status**: PENDING
**Depends on**: 0102, 0103

## Summary

Watch OpenCode session storage for changes and trigger imports/exports automatically, enabling real-time(ish) bidirectional sync.

## Acceptance Criteria

- [ ] Watches `~/.local/share/opencode/storage/session/` for new sessions
- [ ] Watches `~/.local/share/opencode/storage/message/` for new messages
- [ ] Debounced triggers (don't fire on every write)
- [ ] On session end: Trigger import to Ei
- [ ] On Ei state change: Trigger context export
- [ ] Configurable: enable/disable, watched projects, import mode
- [ ] Runs as background process alongside TUI
- [ ] CLI: `ei watch [--projects PATH1,PATH2]`

## Notes

"Real-time" here means:
- Session ends → within seconds, Ei knows about it
- Ei learns something → within seconds, CLAUDE.md is updated

This is NOT streaming individual messages. That's complex and probably not worth it. Session-level granularity is sufficient.

Detection heuristics:
- Session "ended" = no new messages for N minutes, or new session started
- Could also watch for OpenCode process lifecycle if detectable

**Future**: If OpenCode adds lifecycle hooks (on-session-start, on-session-end), we could integrate more cleanly.
