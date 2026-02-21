# 0152: OpenCode Import V2 — Session-Aware Pruning, Archive Extraction & Ceremony Fix

**Status**: PENDING
**Depends on**: 0103 (OpenCode Session Importer), 0145 (OpenCode SQLite Integration)
**Blocked by**: None

---

## Summary

Two intertwined problems that must be solved together:

**Problem 1 — Storage Overflow**: The current OpenCode importer writes ALL messages to persona state, which can exceed the 10MB LocalStorage limit and break Web ↔ TUI sync. We need a session-aware import system that:
1. Keeps a bounded number of messages per persona (MIN_MESSAGES=200, MAX_DAYS=14)
2. Reads old sessions directly from OpenCode's SQLite for extraction (never writes them to Ei state)
3. Handles "necro sessions" (old sessions with new messages) via partial session detection

**Problem 2 — Ceremony Phase Ordering**: The current ceremony calls Exposure (which QUEUES async LLM calls) then immediately calls Decay synchronously. This means Decay runs before extraction completes, potentially decaying topics that were just discussed. The ceremony phases MUST execute sequentially — each phase must complete before the next begins. The existing `HandleCeremonyExposure` and `HandleCeremonyDecayComplete` next_steps are no-ops (the handlers literally log "No-op"). Message pruning belongs after Decay completes, which requires fixing the ceremony ordering first.

### Data Volume Context

User's actual OpenCode data (as of 2026-02-20):
- **216 sessions**, **34,269 messages**, ~4.4M tokens total
- Last 14 days: 37 sessions, ~12K messages (~1.5M tokens)
- Older than 14 days: 179 sessions — this is the archive scan workload

## Primary Directives

1. **Process each message once** — never re-extract
2. **Keep MIN_MESSAGES (200) per persona** — even if oldest is 2 years old
3. **Expire excess after MAX_DAYS (14)** — only if above MIN_MESSAGES
4. **Primary state cannot contain partial sessions** — if some messages from a session are in state and others aren't, trigger immediate extraction with full session context
5. **Partial sessions must be scanned immediately** — can't wait for ceremony
6. **Ensure maximum reasonable context** — use SQLite as context source for archive extraction

## Design

### Transient Processing Types

These are used ONLY during import analysis. NOT persisted to state.json.

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
  await ensureSessionTopic(session, reader, stateManager);
}
```

#### Step 2: Pull Messages Since last_sync
```typescript
const sinceDate = lastSync ? new Date(lastSync) : new Date(0);
// For each session, get messages since lastSync
// Convert to ExternalMessage with sessionId + isExternal=true
```

**Note**: When `last_sync` is null (first run), this pulls ALL messages from ALL sessions.

#### Step 3: Merge/Dedup
```typescript
// Convert existing persona messages to MiniMessage
// Combine with ExternalMessages
// Sort by timestamp, deduplicate by id
const merged = dedupeAndSort([...existingMinis, ...externalMessages]);
```

#### Step 4: Prune — MIN_MESSAGES + AGE_OUT
```typescript
function pruneImportMessages(
  merged: (MiniMessage | ExternalMessage)[],
  existingMessages: Message[],  // For checking [p,r,o,f]
  minMessages: number = 200,
  maxAgeDays: number = 14
): string[] {  // Returns IDs to KEEP
  if (merged.length <= minMessages) return merged.map(m => m.id);
  
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  // Sort oldest first
  const sorted = [...merged].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const existingById = new Map(existingMessages.map(m => [m.id, m]));
  
  // Walk from oldest, mark eligible for removal
  const toRemove: string[] = [];
  for (const m of sorted) {
    if (merged.length - toRemove.length <= minMessages) break;
    
    const isOld = new Date(m.timestamp).getTime() < cutoff;
    if (!isOld) break; // Sorted by time, so no more old ones
    
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
    // (need to query reader for full session message list)
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
  // Sort oldest first
  sessions.sort((a, b) => a.time.updated - b.time.updated);
  
  let tokenBudget = 0;
  const TOKEN_LIMIT = 50 * CALL_TOKEN_LIMIT;
  let lastProcessed: OpenCodeSession | null = null;
  
  for (const session of sessions) {
    // Skip if persona already has messages from this session
    const personaId = getPersonaForSession(session, stateManager);
    const personaMessages = stateManager.messages_get(personaId);
    const hasSessionMessages = personaMessages.some(m => 
      /* check if message ID belongs to session — need reader query */
    );
    if (hasSessionMessages) {
      lastProcessed = session;
      continue;
    }
    
    // Read from SQLite (never store in Ei)
    const sessionMessages = await reader.getMessagesForSession(session.id);
    tokenBudget += estimateTokens(sessionMessages);
    
    // Archive Process: extract knowledge, no message references on quotes
    queueArchiveExtraction(session, sessionMessages, extractionPoint, stateManager);
    
    lastProcessed = session;
    if (tokenBudget >= TOKEN_LIMIT) break;
  }
  
  // Advance extraction_point
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
2. Split: messages in persona state = analyze, rest = context
3. Run all 4 extractions with full session as context
4. Mark all session messages in persona state with [p,r,o,f]=true
```

### Archive Process (Old Session Extraction)

**Same as Session Update, but messages never touch persona state.**

```
Inputs: sessionId, extractionPoint, reader, stateManager
1. Fetch ALL messages for sessionId from SQLite
2. Split on extractionPoint: older = context, newer = analyze
3. Run all 4 extractions (facts, traits, people, topics)
4. Quotes extracted here get NO message_id reference (messages aren't in state)
5. Human.topics[sessionId] description gets updated
```

### Ceremony Fix — Sequential Phase Execution

#### The Bug

The current ceremony is broken. `queueExposurePhase()` queues LLM calls for `[p,r,o,f]` extraction, then immediately calls `applyDecayPhase()` synchronously. Decay decreases topic exposure based on time-since-discussion, but the extraction LLM calls haven't returned yet — so Decay doesn't know what was discussed today. Topics that were actively discussed get incorrectly decayed.

The existing `HandleCeremonyExposure` and `HandleCeremonyDecayComplete` enum values and handlers exist but are literally no-ops:
```typescript
function handleCeremonyExposure(_response, _state) {
  console.log("[handleCeremonyExposure] No-op - exposure is handled synchronously in orchestrator");
}
```

#### The Fix — Data-Driven Phase Progression

Use the `data` object on queue items to track ceremony progress (same pattern as `orchestratePersonaGeneration` which carries `partial` + `loop_counter` across LLM calls).

```typescript
// When startCeremony() runs, it plans the full sequence:
data: {
  ceremony_progress: ["exposure", "decay", "expire", "explore"]
}
```

**Phase progression mechanism:**

1. `startCeremony()` queues all Exposure scan items for all active personas. Each queued item carries `ceremony_progress` in its `data` object.

2. Every extraction handler (fact scan, trait scan, topic scan, person scan, item match, item update) already does its normal work. We modify these handlers: if `ceremony_progress` exists in `data`, pass it through to any follow-up queue items AND queue a `HandleCeremonyProgress` check.

3. `HandleCeremonyProgress` is a NEW next_step. It doesn't need an LLM call — we queue it as a no-prompt item (or use a lightweight mechanism). Its handler:
   ```typescript
   function handleCeremonyProgress(response: LLMResponse, state: StateManager): void {
     // Scan queue for ANY remaining items with ceremony_progress
     // (other than this one, which is about to be completed)
     const remaining = state.queue_getAll().filter(item => 
       item.id !== response.request.id && 
       item.data.ceremony_progress
     );
     
     if (remaining.length > 0) return; // Still processing
     
     // Current phase is done — pop and run next
     const progress = response.request.data.ceremony_progress as string[];
     const completed = progress[0]; // "exposure"
     const next = progress.slice(1);  // ["decay", "expire", "explore"]
     
     advanceCeremony(next, state);
   }
   ```

4. `advanceCeremony()` handles phase transitions:
   ```typescript
   function advanceCeremony(remaining: string[], state: StateManager): void {
     if (remaining.length === 0) {
       console.log("[ceremony] Complete");
       return;
     }
     
     const phase = remaining[0];
     const nextProgress = remaining.slice(1);
     
     switch (phase) {
       case "decay":
         // Synchronous: decay ALL personas (not just active ones with messages)
         const personas = state.persona_getAll().filter(p => !p.is_paused && !p.is_archived);
         for (const persona of personas) {
           applyDecayPhase(persona.id, state);
         }
         // Also run Human ceremony (topic/people decay)
         runHumanCeremony(state);
         // Synchronous: prune messages for ALL personas
         for (const persona of personas) {
           prunePersonaMessages(persona.id, state);
         }
         // Decay is sync, proceed immediately
         advanceCeremony(nextProgress, state);
         break;
         
       case "expire":
         // Queue Expire for each persona — handlers chain to Explore per-persona
         // Expire handler already calls queueExplorePhase() or queueDescriptionCheck()
         const activePersonas = state.persona_getAll().filter(p => 
           !p.is_paused && !p.is_archived && !p.is_static
         );
         for (const persona of activePersonas) {
           queueExpirePhase(persona.id, state);
         }
         // Expire→Explore chaining is per-persona, no global gate needed
         break;
         
       case "explore":
         // Already handled by Expire handler chaining
         break;
     }
   }
   ```

#### Ceremony Flow (Fixed)

```
startCeremony()
  → Queue all Exposure scans with ceremony_progress=["exposure","decay","expire","explore"]
  → Each extraction handler: does normal work, passes ceremony_progress to follow-ups,
    queues HandleCeremonyProgress check
  → HandleCeremonyProgress: scans queue for remaining ceremony items
    → If any remain → return (still processing)
    → If empty → pop "exposure", advance to "decay"
  
"decay" phase:
  → applyDecayPhase() for ALL personas (sync)
  → runHumanCeremony() (sync — topic/people decay)
  → prunePersonaMessages() for ALL personas (sync)
  → advance to "expire"

"expire" phase:
  → queueExpirePhase() for each persona
  → Expire handler chains to Explore per-persona (existing behavior, already correct)
  → Explore handler chains to DescriptionCheck (existing behavior, already correct)
```

#### Why This Works

- **No race conditions**: The queue scan for remaining `ceremony_progress` items is deterministic. The current item is about to be `queue_complete()`'d. If any other ceremony items exist, they'll be processed before another progress check runs.
- **Crash-safe**: All state is in the queue. If the system crashes mid-ceremony, the remaining queue items still have `ceremony_progress` and will trigger progress checks on restart.
- **No counters**: We don't need to know how many scan→match→update chains will spawn. We just check "is the queue empty of ceremony items?"

### Message Pruning (Runs During Decay Phase)

After Decay decreases exposure and before Expire removes topics, we prune messages for ALL personas (Ei, External, everyone):

```typescript
function prunePersonaMessages(personaId: string, state: StateManager): void {
  const MIN_MESSAGES = 200;
  const MAX_AGE_DAYS = 14;
  
  const messages = state.messages_get(personaId);
  if (messages.length <= MIN_MESSAGES) return;
  
  const cutoffMs = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  
  const toRemove: string[] = [];
  for (const m of messages) {
    if (messages.length - toRemove.length <= MIN_MESSAGES) break;
    
    const msgMs = new Date(m.timestamp).getTime();
    if (msgMs >= cutoffMs) break;
    
    const fullyExtracted = m.p && m.r && m.o && m.f;
    if (fullyExtracted) {
      toRemove.push(m.id);
    }
  }
  
  if (toRemove.length > 0) {
    state.messages_remove(personaId, toRemove);
    console.log(`[ceremony:prune] Removed ${toRemove.length} old messages from ${personaId}`);
  }
}
```

**Timing**: Runs AFTER Exposure completes (all `[p,r,o,f]` flags from this ceremony are set) and AFTER Decay (exposure values are correct). Messages that were just extracted today are eligible for pruning if they're old enough — no wasted ceremony cycle.

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
- [ ] Pruning keeps MIN_MESSAGES (200) per persona regardless of age
- [ ] Pruning removes messages older than 14 days IF: external OR [p,r,o,f] all true
- [ ] Partial session detection works for "necro sessions" (old session + new messages)
- [ ] SessionUpdate triggers all 4 extractions with full session context from SQLite
- [ ] Initial load (last_sync=null) runs all 4 extractions on surviving messages
- [ ] Archive scan reads from SQLite without writing messages to Ei state
- [ ] Archive scan respects token budget (~50 * CALL_TOKEN_LIMIT per cycle)
- [ ] extraction_point advances after each archive scan cycle
- [ ] Quotes from archive extraction have no message_id reference

### Ceremony Fix

- [ ] Ceremony phases execute sequentially: Exposure completes before Decay starts
- [ ] `ceremony_progress` array carried in queue item `data` for crash-safe tracking
- [ ] `HandleCeremonyProgress` next_step added to LLMNextStep enum
- [ ] All extraction handlers (fact/trait/topic/person scan, item match, item update) pass `ceremony_progress` through to follow-up queue items and queue a progress check
- [ ] `handleCeremonyProgress` handler scans queue for remaining ceremony items, advances phase when empty
- [ ] Decay phase runs synchronously AFTER all Exposure extraction completes (not immediately)
- [ ] Human ceremony (topic/people decay) runs during Decay phase
- [ ] Existing no-op `handleCeremonyExposure` and `handleCeremonyDecayComplete` handlers removed or repurposed
- [ ] Expire→Explore chaining per-persona remains as-is (already correct)

### Ceremony Pruning

- [ ] `prunePersonaMessages()` runs during Decay phase, AFTER extraction completes and AFTER decay math
- [ ] Applies to ALL personas (Ei, External, everyone — same rules)
- [ ] Only removes fully-extracted ([p,r,o,f]=true) messages older than 14 days
- [ ] MIN_MESSAGES floor (200) is always respected
- [ ] Uses existing `messages_remove()` StateManager method

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

- The `[p,r,o,f]` naming convention — it's fact/trait/person/topic (f/r/p/o) but we call them prof because frpo is a p.i.t.a.
- `messages_remove()` already exists on StateManager — no new state methods needed for pruning
- Archive extraction is throttled by token budget, not time — prevents battery-killing queue floods
- External personas being conversational (responding to messages) means pruning rules must be identical to Ei personas
- Future: Consider Anthropic/Haiku for extraction to reduce local LLM load (separate ticket for abstracting token limits per provider)
- `HandleCeremonyProgress` doesn't need a real LLM call — it's pure logic. May need a queue mechanism for "no-prompt" items, or use a trivial prompt that returns immediately. Implementation detail to figure out during dev.
- The `queue_getAll()` or equivalent method may need to be added to StateManager for the ceremony progress check. Currently only `queue_peekHighest()` exists for reading.

## Open Questions

- [ ] How to efficiently determine which session a message belongs to during partial detection? Options: query reader by message ID, or maintain a transient sessionId→messageIds map during import
- [ ] Should MIN_MESSAGES and MAX_DAYS be configurable in human.settings? (Probably yes, but defaults are fine for V1)
- [ ] Archive scan "skip if persona has messages from session" — need efficient lookup. Maintain a Set of known message IDs?
- [ ] `HandleCeremonyProgress` needs a way to execute without an actual LLM call. Options: (a) add a "noop" LLM request type that skips the LLM and goes straight to handler, (b) use a trivial prompt, (c) handle it outside the queue entirely via a processor loop check. Option (a) is cleanest.
