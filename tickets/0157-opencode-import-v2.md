# 0157: OpenCode Import V2 — Session-Aware Pruning & Archive Extraction

**Status**: PENDING
**Depends on**: 0103 (OpenCode Session Importer), 0145 (OpenCode SQLite Integration), 0152 (Ceremony Fix)
**Blocked by**: None

---

## Summary

The current OpenCode importer writes ALL messages to persona state, which will exceed the 10MB LocalStorage limit and break Web ↔ TUI sync. We need a session-aware import system that:

1. Keeps a bounded number of messages per persona (MIN_MESSAGES=200, MAX_DAYS=14)
2. Reads old sessions directly from OpenCode's SQLite for extraction (never writes them to Ei state)
3. Handles "necro sessions" (old sessions with new messages) via partial session detection
4. Replaces `gradual-extraction.ts` entirely with a SQLite-based archive scan

### Data Volume Context

User's actual OpenCode data (as of 2026-02-20):
- **216 sessions**, **34,269 messages**, ~4.4M tokens total
- Last 14 days: 37 sessions, ~12K messages (~1.5M tokens)
- Older than 14 days: 179 sessions — this is the archive scan workload

### What Already Exists

| File | Current Behavior |
|------|-----------------|
| `importer.ts` | Writes ALL messages to persona state. No pruning. |
| `gradual-extraction.ts` | Processes extraction_point day-by-day from persona state messages. **Being replaced.** |
| `IOpenCodeReader` | `getSessionsUpdatedSince`, `getMessagesForSession`, agent info methods |
| `StateManager` | `messages_remove(personaId, ids)`, `messages_sort(personaId)` already exist |
| Ceremony `prunePersonaMessages()` | Already done (0152). Prunes fully-extracted old messages during ceremony. **Separate concern from import pruning.** |

### What Changes

| File | Change |
|------|--------|
| `importer.ts` | Rewrite to add merge/dedup/prune, partial session detection, archive scan |
| `gradual-extraction.ts` | **Delete entirely** — replaced by archive scan in importer |
| `types.ts` | Add `MiniMessage`, `ExternalMessage` transient types |
| `IOpenCodeReader` | Add `getSessionsInRange(from, to)` |
| `sqlite-reader.ts` | Implement `getSessionsInRange` |
| `json-reader.ts` | Implement `getSessionsInRange` (or throw "not supported") |

## Primary Directives

1. **Process each message once** — never re-extract
2. **Keep MIN_MESSAGES (200) per persona** — even if oldest is 2 years old
3. **Expire excess after MAX_DAYS (14)** — only if above MIN_MESSAGES
4. **Primary state cannot contain _un-processed_ partial sessions** — if some messages from a session are in state and others aren't, trigger immediate extraction with full session context
5. **Partial sessions must be scanned immediately** — can't wait for ceremony
6. **Ensure maximum reasonable context** — use SQLite as context source for archive extraction

## Design

### Transient Processing Types

Used ONLY during import analysis. NOT persisted to state.json.

```typescript
interface MiniMessage {
  id: string;
  timestamp: string;
}

interface ExternalMessage extends MiniMessage {
  isExternal: true;
  sessionId: string;
}
```

During import, we convert both existing persona messages and newly-fetched external messages to this shape for merge/dedup/pruning analysis. The `isExternal` flag tells the pruning function that a message can be dropped even without `[p,r,o,f]` flags (since it was never in state to be extracted).

### Import Flow (9 Steps)

#### Step 1: Pull All Sessions → Verify/Write Human.topics

```typescript
const sessions = await reader.getSessionsUpdatedSince(new Date(0));
for (const session of sessions) {
  await ensureSessionTopic(session, reader, stateManager); // already exists
}
```

This already exists. The `new Date(0)` ensures we always see all sessions for topic verification.

#### Step 2: Pull Messages Since last_sync

```typescript
const sinceDate = lastSync ? new Date(lastSync) : new Date(0);
// For each session, get messages since lastSync
// Convert to ExternalMessage with sessionId + isExternal=true
```

When `last_sync` is null (first run), this pulls ALL messages from ALL sessions.

#### Step 3: Merge/Dedup

```typescript
// Convert existing persona messages to MiniMessage
// Combine with ExternalMessages
// Sort by timestamp, deduplicate by id
const merged = dedupeAndSort([...existingMinis, ...externalMessages]);
```

#### Step 4: Prune — MIN_MESSAGES + AGE_OUT

**This is a NEW function, separate from ceremony's `prunePersonaMessages`.**

Ceremony pruning only sees messages already in state (all have `[p,r,o,f]` flags). Import pruning sees a mix of state messages AND external messages that were never persisted.

```typescript
function pruneImportMessages(
  merged: (MiniMessage | ExternalMessage)[],
  existingMessages: Message[],  // For checking [p,r,o,f]
  minMessages: number = 200,
  maxAgeDays: number = 14
): string[] {  // Returns IDs to KEEP
  if (merged.length <= minMessages) return merged.map(m => m.id);
  
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const sorted = [...merged].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const existingById = new Map(existingMessages.map(m => [m.id, m]));
  
  const toRemove: string[] = [];
  for (const m of sorted) {
    if (merged.length - toRemove.length <= minMessages) break;
    
    const isOld = new Date(m.timestamp).getTime() < cutoff;
    if (!isOld) break;
    
    const isExternal = "isExternal" in m && m.isExternal;
    const existing = existingById.get(m.id);
    const fullyExtracted = existing?.p && existing?.r && existing?.o && existing?.f;
    
    if (isExternal || fullyExtracted) {
      toRemove.push(m.id);
    }
  }
  
  const removeSet = new Set(toRemove);
  return merged.filter(m => !removeSet.has(m.id)).map(m => m.id);
}
```

#### Step 5: Write to Persona State

- Add new external messages that survived pruning
- Remove messages that were pruned
- Call `messages_sort` to ensure order

#### Step 6: Detect Partial Sessions → Trigger SessionUpdate

```typescript
function findPartialSessions(
  keptIds: Set<string>,
  externalMessages: ExternalMessage[],
  reader: IOpenCodeReader
): string[] {
  // Group external messages by sessionId
  const sessionGroups = groupBy(externalMessages, m => m.sessionId);
  const partials: string[] = [];
  
  for (const [sessionId, msgs] of sessionGroups) {
    const hasKeptExternal = msgs.some(m => keptIds.has(m.id));
    if (!hasKeptExternal) continue;
    
    // Check if ALL messages from this session are in kept set
    const allSessionMsgs = await reader.getMessagesForSession(sessionId);
    const hasMissing = allSessionMsgs.some(m => !keptIds.has(m.id));
    
    if (hasMissing) {
      partials.push(sessionId);
    }
  }
  return partials;
}
```

For each partial session, trigger **SessionUpdate** (see below).

#### Step 7: Initial Load (last_sync === null)

Run all 4 extractions on all persona messages. This is the "fun" moment where quotes start rolling in.

#### Step 8: Archive Scan

**Replaces `gradual-extraction.ts` entirely.** Reads from SQLite, temporarily injects messages into persona state for extraction.

```typescript
function processArchiveScan(
  stateManager: StateManager,
  reader: IOpenCodeReader,
  extractionPoint: string,
  maxAgeDays: number = 14
): void {
  const cutoffMs = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const extractionPointMs = new Date(extractionPoint).getTime();
  
  // Sessions between extraction_point and cutoff (archive territory)
  const sessions = await reader.getSessionsInRange(
    new Date(extractionPointMs),
    new Date(cutoffMs)
  );
  sessions.sort((a, b) => a.time.updated - b.time.updated);
  
  let tokenBudget = 0;
  const TOKEN_LIMIT = 50 * CALL_TOKEN_LIMIT;
  let lastProcessed: OpenCodeSession | null = null;
  
  for (const session of sessions) {
    const personaId = getPersonaForSession(session, stateManager);
    const personaMessages = stateManager.messages_get(personaId);
    const hasSessionMessages = personaMessages.some(m => /* belongs to session */);
    if (hasSessionMessages) {
      lastProcessed = session;
      continue;
    }
    
    // Read from SQLite, inject into persona state for extraction
    const sessionMessages = await reader.getMessagesForSession(session.id);
    tokenBudget += estimateTokens(sessionMessages);
    
    injectAndQueueArchiveExtraction(session, sessionMessages, personaId, extractionPoint, stateManager);
    
    lastProcessed = session;
    if (tokenBudget >= TOKEN_LIMIT) break;
  }
  
  if (lastProcessed) {
    updateExtractionPoint(stateManager, new Date(lastProcessed.time.updated).toISOString());
  } else if (sessions.length === 0) {
    updateExtractionPoint(stateManager, new Date().toISOString());
  }
}
```

#### Step 9: Update last_sync

```typescript
stateManager.setHuman({ settings: { opencode: { last_sync: new Date().toISOString() } } });
```

### Session Update (Partial Session Handling)

**Why**: User tacked new messages onto an old session. We have the new messages in state but lack the historical context of WHY that session exists.

```
Inputs: personaId, sessionId, reader
1. Fetch ALL messages for sessionId from SQLite
2. Inject missing session messages into persona state (messages_add)
3. Run all 4 extractions with full session context
4. Extraction marks all messages [p,r,o,f]=true via normal handler flow
5. Ceremony prune later removes the old injected messages (self-cleaning)
```

### Archive Process (Old Session Extraction)

Same injection approach as Session Update — messages are temporarily added to persona state so the existing extraction pipeline (including `validateAndStoreQuotes`) works unchanged.

```
Inputs: personaId, sessionId, extractionPoint, reader, stateManager
1. Fetch ALL messages for sessionId from SQLite
2. Inject into persona state (messages_add)
3. Split on extractionPoint: older = context, newer = analyze
4. Run all 4 extractions (facts, traits, people, topics + quotes)
5. Extraction marks messages [p,r,o,f]=true via normal handler flow
6. Human.topics[sessionId] description gets updated
7. Ceremony prune later removes these old messages (self-cleaning)
```

**Why inject instead of processing externally**: The extraction pipeline — especially `validateAndStoreQuotes` (handlers/index.ts:742) — does exact string matching against `state.messages_get(personaId)` and stores `message.id` as the quote reference. Quotes, facts, traits, people, and topics all flow through handlers that assume messages are in state. Rather than duplicating or bypassing that pipeline, we inject temporarily and let ceremony clean up. State inflation is bounded by the archive scan's token budget (~50 calls per cycle).

### Reader Interface Addition

```typescript
// Add to IOpenCodeReader
getSessionsInRange(from: Date, to: Date): Promise<OpenCodeSession[]>;
```

SqliteReader implementation:
```sql
SELECT id, title, directory, project_id, parent_id, time_created, time_updated
FROM session
WHERE time_updated > ?1 AND time_updated <= ?2 AND parent_id IS NULL
ORDER BY time_updated ASC
```

## Acceptance Criteria

### Import V2

- [ ] Import uses MiniMessage/ExternalMessage for merge analysis (transient, not persisted)
- [ ] `pruneImportMessages` keeps MIN_MESSAGES (200) per persona regardless of age
- [ ] `pruneImportMessages` removes messages older than 14 days IF: external OR [p,r,o,f] all true
- [ ] Partial session detection works for "necro sessions" (old session + new messages)
- [ ] SessionUpdate triggers all 4 extractions with full session context from SQLite
- [ ] Initial load (last_sync=null) runs all 4 extractions on surviving messages
- [ ] `gradual-extraction.ts` deleted — archive scan replaces it entirely
- [ ] Archive scan injects messages into persona state temporarily for extraction
- [ ] Archive scan respects token budget (~50 * CALL_TOKEN_LIMIT per cycle)
- [ ] extraction_point advances after each archive scan cycle
- [ ] Injected archive messages get marked [p,r,o,f]=true by normal extraction flow
- [ ] Ceremony prune self-cleans injected archive messages (old + fully extracted)

### Reader Changes

- [ ] `getSessionsInRange(from, to)` added to IOpenCodeReader interface
- [ ] SqliteReader implements the new method
- [ ] JsonReader implements the new method (or throws "not supported")

### Integration

- [ ] Web LocalStorage stays under 10MB with active OpenCode import
- [ ] Sync to flare576.com works correctly (no oversized personas)
- [ ] Return after long gap (e.g., 1 month) handles correctly:
  - New sessions discovered and topics created
  - Old messages pruned during import
  - Necro sessions detected and processed
  - Archive scan resumes from last extraction_point

## Scenario Walkthrough

See `.sisyphus/human/opencode_v2.md` for the full scenario trace covering:
- First install (Jan 1): Sessions s-a through s-c, initial import, pruning, archive scan, ceremony
- Return after gap (Feb 19): Sessions s-d and s-e discovered, necro session s-b detected, archive catchup

## Notes

- Ceremony pruning (`prunePersonaMessages` in ceremony.ts) is a **separate concern** — it runs during ceremony for all personas. Import pruning (`pruneImportMessages`) handles the merge of external + state messages during import. Both use the shared `MESSAGE_MIN_COUNT` and `MESSAGE_MAX_AGE_DAYS` constants from `src/core/types.ts`.
- The `[p,r,o,f]` naming convention — it's fact/trait/person/topic (f/r/p/o) but we call them prof because frpo is a p.i.t.a.
- `messages_remove()` already exists on StateManager — no new state methods needed for pruning
- Archive extraction is throttled by token budget, not time — prevents battery-killing queue floods
- External personas being conversational (responding to messages) means pruning rules must be identical to Ei personas
- Future: Consider Anthropic/Haiku for extraction to reduce local LLM load (separate ticket 0156 for abstracting token limits per provider)
