# 0107: Sync Orchestrator

**Status**: PENDING
**Depends on**: 0101, 0106

## Summary

Orchestrate the full sync loop between FileStorage (TUI), RemoteStorage (flare576.com), and LocalStorage (Web).

## Acceptance Criteria

- [ ] TUI startup: Pull from RemoteStorage if newer
- [ ] TUI shutdown: Push to RemoteStorage
- [ ] Web startup: Pull from RemoteStorage
- [ ] Web shutdown/blur: Push to RemoteStorage
- [ ] Periodic sync while running (configurable interval)
- [ ] Manual sync command: `ei sync`
- [ ] Sync status indicator in both UIs
- [ ] Handles network failures gracefully
- [ ] Logs sync history for debugging

## Notes

The daily loop:
```
06:00 - TUI starts, pulls latest from flare576.com
        (includes changes made on phone last night)
06:00-18:00 - Work with TUI + OpenCode
        Periodic syncs to flare576.com
18:00 - TUI closes, final sync to flare576.com
20:00 - Web (phone) opens, pulls from flare576.com
        Chat with personas while relaxing
22:00 - Web syncs back to flare576.com
06:00 - Loop continues...
```

Conflict scenarios:
1. **TUI and Web both offline, then sync**: Compare timestamps, prompt user
2. **Fast switching**: Last-write-wins with short grace period
3. **Merge conflicts**: For now, whole-state replacement (future: field-level merge)
