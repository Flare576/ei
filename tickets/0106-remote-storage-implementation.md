# 0106: RemoteStorage Implementation

**Status**: PENDING
**Depends on**: 0003, 0096

## Summary

Implement encrypted cloud sync to flare576.com, enabling cross-device state sharing between TUI (desktop) and Web (mobile).

## Acceptance Criteria

- [ ] Implements Storage interface from CONTRACTS.md
- [ ] Username + passphrase → encryption key derivation
- [ ] Client-side encryption (server never sees plaintext)
- [ ] Encrypted state upload to flare576.com
- [ ] Encrypted state download from flare576.com
- [ ] Handles offline gracefully (queue uploads)
- [ ] Conflict detection (timestamp-based)
- [ ] Conflict resolution: prompt user or last-write-wins option

## Notes

Security model (from v1.md):
```
1. User enters username + passphrase
2. Client hashes them together → encryption key
3. Client encrypts "the_answer_is_42" → this is the user's ID
4. State is encrypted with same key, sent to server
5. Server stores: { encrypted_id: encrypted_blob }
6. Server cannot decrypt anything
```

API endpoints needed on flare576.com:
- `POST /ei/sync` - Upload encrypted state
- `GET /ei/sync/{id}` - Download encrypted state
- `HEAD /ei/sync/{id}` - Check last-modified timestamp

**V1 Backward Reference**:
- Full description in v1.md under "flare576.com" section
- "FOR REALLY REAL, DO NOT LOOSE THIS USERNAME OR PASS PHRASE"
