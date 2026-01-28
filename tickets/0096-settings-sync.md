# 0096: Settings Sync (flare576.com)

**Status**: PENDING
**Depends on**: 0081

## Summary

Sync user settings to flare576.com for cross-device continuity.

## Acceptance Criteria

- [ ] Username/passphrase authentication
- [ ] Encrypted settings payload
- [ ] Upload settings on change (debounced)
- [ ] Download settings on login
- [ ] Conflict resolution: remote wins (with warning) or manual merge
- [ ] Offline-first: works without sync, syncs when available
- [ ] Clear indication of sync status

## Notes

**V1 Backward Reference**:
- "Username/pass phrase should run encryption flow and get latest settings from flare576.com"

This is V1.2 territory - RemoteStorage implementation.
