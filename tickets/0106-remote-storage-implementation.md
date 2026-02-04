# 0106: RemoteStorage Implementation

**Status**: DONE
**Depends on**: 0003, 0096

## Summary

Implement encrypted cloud sync to flare576.com, enabling cross-device state sharing. This includes:
- Client-side encryption (server never sees plaintext)
- Simple PHP API with rate limiting
- GitHub Actions deployment pipeline
- Conflict resolution with GUID-based merge option
- Layout refactor to add "Save and Exit" button

## Acceptance Criteria

### API Endpoints (PHP on flare576.com)

- [x] `POST /ei/api` - Upsert encrypted state
  - Expects: `{ "id": "encrypted_id", "data": "encrypted_data" }`
  - Rate limit: 3 uploads/hour per user (429 with retry-after if exceeded)
  - Returns: 200 on success
- [x] `GET /ei/api/{encrypted_id}` - Retrieve encrypted state
  - Returns: Raw encrypted blob (200) or 404
- [x] `HEAD /ei/api/{encrypted_id}` - Check last_updated timestamp
  - Returns: `Last-Modified` header (200) or 404

### Database Schema

- [x] Single table: `ei_sync`
  - `encrypted_id` (VARCHAR, PK)
  - `data` (LONGTEXT - encrypted blob)
  - `last_updated` (TIMESTAMP)
  - `rate_limit` (JSON - array of upload timestamps)

### Client-Side Encryption

- [x] Username + passphrase → PBKDF2 key derivation (310k iterations, SHA-256)
- [x] Deterministic user ID: encrypt static string "the_answer_is_42" with derived key
- [x] State encryption: AES-GCM with random 12-byte IV per encryption
- [x] IV stored alongside ciphertext (required for decryption)
- [x] Encryption module in `src/storage/crypto.ts`

### RemoteStorage Adapter

- [x] Implements Storage interface from CONTRACTS.md
- [x] `sync()` method: POST current state to server
- [x] `fetch()` method: GET state from server, decrypt
- [x] `checkRemote()` method: HEAD to get last_updated timestamp
- [x] Handles offline gracefully (operations fail silently, log warning)

### Conflict Resolution

- [x] On app startup with remote credentials: HEAD check remote timestamp
- [x] If remote newer than local: show conflict dialog
- [x] Three options:
  1. **Keep Local** - Optional: "Update Remote?" prompt → POST if yes
  2. **Keep Remote** - Load remote into memory, discard local
  3. **YOLO Merge** - GUID-based merge:
     - Add new personas (match by name)
     - Add new messages by GUID
     - For DataItems/Quotes: add new GUIDs, keep newer `last_updated` on collision
- [x] Conflict dialog shows timestamps for both versions

### UI Changes

#### Layout Refactor
- [x] Move ControlArea out of resizable left panel
- [x] Position ControlArea at top-right, aligned with ChatPanel header row
- [x] Desktop: absolute positioning in top-right
- [x] Mobile: first item in flex flow (before personas)
- [x] Fix SavePanel popover positioning (no longer needs viewport gymnastics)

#### Save and Exit Button
- [x] Add to ControlArea (6th button)
- [x] Icon: door/exit symbol
- [x] Action: Remote backup (if configured) → processor.stop()
- [x] Confirmation if remote backup fails: "Backup failed. Exit anyway?"

#### Settings Tab Additions
- [x] Username/passphrase fields for remote sync (in HumanSettingsTab)
- [ ] "Test Connection" button (optional, nice-to-have)
- [x] Manual backup section:
  - [x] "Download Backup" button - exports localStorage JSON as file
  - [x] "Upload Backup" button - imports JSON, validates with JSON.parse()

### Auto-Sync Triggers

- [x] Before daily ceremony: auto-backup to remote (if configured)
- [x] On "Save and Exit": backup to remote (if configured)
- [x] No other auto-sync (no hourly, no configurable intervals)

### GitHub Actions Deployment

- [x] Workflow: `.github/workflows/deploy.yml`
- [x] Trigger: push to `main` branch
- [x] Build step: `npm run build` (Vite output to `dist/`)
- [x] Deploy step: SFTP upload to flare576.com
- [x] Secrets (Repository level):
  - `SFTP_HOST`
  - `SFTP_USERNAME`
  - `SFTP_PASSWORD`
- [x] Secrets (Environment: Prod):
  - `DB_HOSTNAME`
  - `DB_DATABASE`
  - `DB_USERNAME`
  - `DB_PASSWORD`

### E2E Tests

- [ ] Encryption round-trip test (encrypt → decrypt = original) → Deferred to 0107
- [ ] Conflict dialog appears when remote is newer → Deferred to 0107
- [ ] "Keep Local" / "Keep Remote" work correctly → Deferred to 0107
- [ ] YOLO Merge adds new entities without losing existing → Deferred to 0107

> **Note**: Encryption/conflict E2E tests require server mocking. Deferred to 0107 (Sync Orchestrator) where the sync logic lives.

## Implementation Notes

### Security Model

```
1. User enters username + passphrase
2. Client derives key: PBKDF2(username:passphrase, salt=static, iterations=310000)
3. Client generates user ID: AES-GCM-encrypt("the_answer_is_42", key) → base64
4. State encrypted with same key + random IV
5. Server stores: { encrypted_id: encrypted_blob }
6. Server cannot decrypt anything
```

### Rate Limiting Logic (PHP)

```php
// On POST:
// 1. Fetch rate_limit array for this encrypted_id
// 2. Filter out timestamps older than 1 hour
// 3. If count >= 3: return 429 with Retry-After header
// 4. Add NOW() to array
// 5. Save data + updated rate_limit array
```

### YOLO Merge Algorithm

```typescript
function yoloMerge(local: Checkpoint, remote: Checkpoint): Checkpoint {
  const merged = structuredClone(local);
  
  // Personas: match by name (add new, merge messages)
  for (const remotePersona of remote.personas) {
    const localPersona = merged.personas.find(p => p.name === remotePersona.name);
    if (!localPersona) {
      merged.personas.push(remotePersona);
    } else {
      // Add messages by GUID
      for (const msg of remotePersona.messages) {
        if (!localPersona.messages.some(m => m.id === msg.id)) {
          localPersona.messages.push(msg);
        }
      }
      // Sort messages by timestamp
      localPersona.messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
  }
  
  // Human data items: add new, keep newer on collision
  for (const type of ['facts', 'traits', 'topics', 'people']) {
    for (const remoteItem of remote.human[type]) {
      const localItem = merged.human[type].find(i => i.id === remoteItem.id);
      if (!localItem) {
        merged.human[type].push(remoteItem);
      } else if (remoteItem.last_updated > localItem.last_updated) {
        Object.assign(localItem, remoteItem);
      }
    }
  }
  
  // Quotes: add new by GUID
  for (const quote of remote.quotes || []) {
    if (!merged.quotes?.some(q => q.id === quote.id)) {
      merged.quotes = merged.quotes || [];
      merged.quotes.push(quote);
    }
  }
  
  return merged;
}
```

### Project Structure

```
/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Build + SFTP deploy
├── api/                        # PHP endpoints (deployed to flare576.com/ei/api/)
│   ├── index.php               # Router
│   ├── config.php              # DB config (reads env vars)
│   └── sync.php                # POST/GET/HEAD handlers
├── src/
│   └── storage/
│       ├── crypto.ts           # PBKDF2 + AES-GCM
│       └── remote.ts           # RemoteStorage adapter
└── web/
    └── src/
        └── components/
            └── Layout/
                └── ...         # Updated layout components
```

### V1 Backward Reference

From v1.md:
- "Username/pass phrase should run encryption flow and get latest settings from flare576.com"
- "FOR REALLY REAL, DO NOT LOOSE THIS USERNAME OR PASS PHRASE"

## Related Tickets

- **0096**: Provider Accounts (DONE) - Added `accounts` to HumanSettings, UI for account management
- **0090**: Onboarding Flow (PENDING) - Will use "I have an account" flow to trigger remote fetch
- **NEW**: Persona GUIDs - Currently personas identified by name; may cause merge issues if same name created on different devices

## Scope Decisions (2026-02-04)

1. **No BYOS** - Only flare576.com storage, plus manual download/upload for offline backup
2. **Simple validation** - Upload just checks `JSON.parse()` succeeds
3. **Rate limit per user** - 3 uploads/hour, stored in DB alongside encrypted data
4. **One auto-sync point** - Before ceremony only (not hourly, not configurable)
5. **YOLO Merge is opt-in** - Users can always choose Keep Local or Keep Remote
6. **Layout refactor included** - ControlArea moves to fix resize/positioning issues
