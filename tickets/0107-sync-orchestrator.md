# 0107: Sync Orchestrator

**Status**: PENDING
**Depends on**: 0106

## Summary

Wire up the sync flow in the Web UI. The building blocks exist (RemoteSync, ConflictResolutionModal, yoloMerge) but aren't connected to the app lifecycle yet. This ticket connects them.

**Note**: TUI sync (0101 FileStorage) is a separate concern. This ticket is Web-only.

## The Big Picture

This is part of E010 (TUI & OpenCode Integration). The vision:

```
The daily loop:

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

**This ticket handles the Web side** (20:00-22:00 in the diagram). The TUI side comes from 0101 (FileStorage) + future orchestration work.

Conflict scenarios this enables:
1. **TUI and Web both offline, then sync**: Compare timestamps, prompt user
2. **Fast switching**: Last-write-wins with short grace period
3. **Merge conflicts**: YOLO merge combines both (future: field-level merge)

## What Already Exists (from 0106)

| Component | Location | Status |
|-----------|----------|--------|
| `RemoteSync` class | `src/storage/remote.ts` | ✅ Complete |
| `yoloMerge()` function | `src/storage/merge.ts` | ✅ Complete |
| `ConflictResolutionModal` | `web/src/components/Sync/` | ✅ Complete |
| Cloud Sync credentials UI | `HumanSettingsTab.tsx` | ✅ Complete |
| Save & Exit button | `ControlArea.tsx` | ✅ Complete |
| PHP API | `api/` | ✅ Complete |

## Acceptance Criteria

### Startup Sync Check

- [ ] On app mount, if sync credentials exist in `human.settings.sync`:
  - [ ] Call `remoteSync.configure()` with credentials
  - [ ] Call `remoteSync.checkRemote()` to get remote timestamp
  - [ ] Compare with local `state.timestamp`
  - [ ] If remote newer → show `ConflictResolutionModal`
  - [ ] If local newer or equal → continue normally (no modal)
  - [ ] If remote doesn't exist (404) → continue normally
  - [ ] If network error → continue normally (log warning)

### Conflict Resolution Handlers

- [ ] **Keep Local**: 
  - [ ] Close modal, proceed with local state
  - [ ] If "Also update remote?" checked → call `remoteSync.sync(localState)`
- [ ] **Keep Remote**:
  - [ ] Call `remoteSync.fetch()`
  - [ ] Replace local state with fetched state via `processor.importState()`
  - [ ] Close modal
- [ ] **YOLO Merge**:
  - [ ] Call `remoteSync.fetch()`
  - [ ] Call `yoloMerge(localState, remoteState)`
  - [ ] Replace local state with merged result via `processor.importState()`
  - [ ] Optionally push merged state back to remote
  - [ ] Close modal

### Save & Exit Sync

- [ ] When Save & Exit clicked:
  - [ ] If sync configured → call `remoteSync.sync(currentState)`
  - [ ] If sync succeeds → call `processor.stop()`
  - [ ] If sync fails → show confirmation: "Backup failed. Exit anyway?"
  - [ ] If user confirms → `processor.stop()` anyway
  - [ ] If user cancels → stay in app

### Pre-Ceremony Sync

- [ ] Before daily ceremony starts:
  - [ ] If sync configured → call `remoteSync.sync(currentState)`
  - [ ] Log result (success/failure) but don't block ceremony

### Sync Status Indicator

- [ ] Add visual indicator when sync is in progress (spinner on cloud icon?)
- [ ] Show last sync time somewhere (maybe tooltip on Settings button?)
- [ ] Consider: toast notification on sync success/failure?

### Error Handling

- [ ] Network errors fail silently with console warning (don't block app)
- [ ] Rate limit (429) → show user-friendly message with retry time
- [ ] Decryption errors → warn user (wrong passphrase?)

## E2E Tests (Deferred from 0106)

These require mocking the remote API:

- [ ] Encryption round-trip test (encrypt → decrypt = original)
- [ ] Conflict dialog appears when remote is newer
- [ ] "Keep Local" works correctly
- [ ] "Keep Remote" works correctly  
- [ ] YOLO Merge adds new entities without losing existing
- [ ] Save & Exit syncs before stopping
- [ ] Sync failure shows confirmation dialog

### E2E Test Strategy

```typescript
// Mock the fetch API for remote sync tests
await page.route('**/flare576.com/ei/api/**', async (route) => {
  const method = route.request().method();
  
  if (method === 'HEAD') {
    // Return remote timestamp
    await route.fulfill({
      status: 200,
      headers: { 'Last-Modified': remoteTimestamp.toUTCString() }
    });
  } else if (method === 'GET') {
    // Return encrypted state
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ data: encryptedRemoteState })
    });
  } else if (method === 'POST') {
    // Accept sync
    await route.fulfill({ status: 200 });
  }
});
```

## Implementation Notes

### App.tsx Changes

```typescript
// Pseudo-code for startup sync
useEffect(() => {
  async function checkRemoteSync() {
    const syncCreds = processor?.getHuman()?.settings?.sync;
    if (!syncCreds?.username || !syncCreds?.passphrase) return;
    
    await remoteSync.configure(syncCreds);
    const remote = await remoteSync.checkRemote();
    
    if (!remote.exists || !remote.lastModified) return;
    
    const localTimestamp = new Date(processor.getStorageState().timestamp);
    if (remote.lastModified > localTimestamp) {
      setShowConflictModal(true);
      setRemoteTimestamp(remote.lastModified);
      setLocalTimestamp(localTimestamp);
    }
  }
  
  if (processor) checkRemoteSync();
}, [processor]);
```

### Conflict Resolution Callbacks

```typescript
const handleKeepLocal = useCallback(async (updateRemote: boolean) => {
  setShowConflictModal(false);
  if (updateRemote) {
    const state = processor.getStorageState();
    await remoteSync.sync(state);
  }
}, [processor]);

const handleKeepRemote = useCallback(async () => {
  const result = await remoteSync.fetch();
  if (result.success && result.state) {
    await processor.importState(JSON.stringify(result.state));
  }
  setShowConflictModal(false);
}, [processor]);

const handleYoloMerge = useCallback(async () => {
  const result = await remoteSync.fetch();
  if (result.success && result.state) {
    const local = processor.getStorageState();
    const merged = yoloMerge(local, result.state);
    await processor.importState(JSON.stringify(merged));
    // Optionally sync merged state back
    await remoteSync.sync(merged);
  }
  setShowConflictModal(false);
}, [processor]);
```

## Non-Goals (Future Tickets)

- **Periodic sync while running** - Decided against this in 0106. Only sync on ceremony + exit.
- **TUI sync** - Separate concern, depends on 0101 FileStorage
- **Sync history/audit log** - Nice to have, not MVP
- **Field-level merge UI** - YOLO merge is automatic; no manual conflict resolution

## Related

- **0106**: RemoteStorage Implementation (the building blocks)
- **0101**: FileStorage Implementation (TUI storage, not Web)
- **0128**: Persona GUIDs (needed for proper merge - personas currently match by name)
