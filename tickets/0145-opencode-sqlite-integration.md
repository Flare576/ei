# 0145: OpenCode 1.2 SQLite Integration

**Status**: PENDING
**Depends on**: None (existing OpenCode integration works, this adds parallel support)
**Priority**: High (users upgrading to OpenCode 1.2 will break without this)

## Summary

OpenCode 1.2 migrated from flat JSON files to a SQLite database. Ei's `OpenCodeReader` currently reads the JSON files directly. We need to add SQLite support while maintaining JSON fallback for users who haven't upgraded yet, and handle the migration transition gracefully.

## Background

### OpenCode 1.2 Changes

From the release notes:
> This release includes a data migration that will execute on first run. It will migrate all flat files in data directory to a single sqlite database.

**Before (1.1.x)**: 
```
~/.local/share/opencode/storage/
├── session/{project_hash}/ses_xxx.json
├── message/{session_id}/msg_xxx.json
└── part/{msg_id}/prt_xxx.json
```

**After (1.2.x)**:
```
~/.local/share/opencode/
├── opencode.db          # SQLite database
├── opencode.db-shm      # WAL mode files
├── opencode.db-wal
└── storage/             # Old files preserved (for now)
```

### SQLite Schema (verified from actual DB)

```sql
-- Sessions
CREATE TABLE `session` (
  `id` text PRIMARY KEY,              -- ses_xxx (SAME format!)
  `project_id` text NOT NULL,
  `parent_id` text,
  `slug` text NOT NULL,
  `directory` text NOT NULL,
  `title` text NOT NULL,
  `version` text NOT NULL,
  `time_created` integer NOT NULL,    -- Unix ms (SAME format!)
  `time_updated` integer NOT NULL,    -- Unix ms (SAME format!)
  -- ... additional fields
);

-- Messages  
CREATE TABLE `message` (
  `id` text PRIMARY KEY,              -- msg_xxx (SAME format!)
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,    -- Unix ms
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,               -- JSON blob with role, agent, etc.
);

-- Parts
CREATE TABLE `part` (
  `id` text PRIMARY KEY,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL,               -- JSON blob with type, text, etc.
);
```

### Critical Compatibility Findings

1. **IDs preserved**: `ses_xxx`, `msg_xxx` format unchanged
2. **Timestamps preserved**: Unix milliseconds, same as JSON
3. **`extraction_point` still valid**: Our timestamp-based tracking will work
4. **Data in JSON columns**: Message/part payload is JSON in `data` column

## Acceptance Criteria

### Phase 1: SQLite Reader Implementation

- [ ] Add `better-sqlite3` dependency (sync SQLite for Node.js)
- [ ] Create `SqliteReader` class implementing same interface as `OpenCodeReader`
- [ ] `getSessionsUpdatedSince(since)` - query session table with `time_updated > ?`
- [ ] `getMessagesForSession(sessionId, since)` - query message + part tables
- [ ] `getAgentInfo(agentName)` - same as current (no DB storage for this)
- [ ] Parse `data` JSON column for message/part payloads
- [ ] Handle WAL mode (read-only, don't interfere with OpenCode writes)

### Phase 2: Dual-Source Detection

- [ ] On init, check for `opencode.db` existence
- [ ] If SQLite exists: use `SqliteReader` as primary
- [ ] If SQLite missing: fall back to JSON `OpenCodeReader`
- [ ] Log which mode is active: `[OpenCode] Using SQLite reader` or `[OpenCode] Using JSON reader (legacy)`

### Phase 3: Migration Transition Handling

- [ ] First run after migration: verify sample IDs match between SQLite and JSON
- [ ] Log verification result: `[OpenCode] SQLite migration verified: N sessions matched`
- [ ] If mismatch detected, warn user and fall back to JSON
- [ ] Track `last_json_update` timestamp in human settings
- [ ] Stop checking JSON files when they're stale (older than SQLite data)

### Phase 4: Cleanup & Deprecation Path

- [ ] Add `EI_OPENCODE_FORCE_JSON=1` env var for debugging
- [ ] Add `EI_OPENCODE_FORCE_SQLITE=1` env var for testing
- [ ] Document migration in README or CHANGELOG
- [ ] After 3 months: remove JSON reader code (separate ticket)

## Technical Design

### New File Structure

```
src/integrations/opencode/
├── reader.ts              # KEEP - rename to json-reader.ts
├── sqlite-reader.ts       # NEW - SQLite implementation
├── reader-factory.ts      # NEW - Detects and returns correct reader
├── types.ts               # KEEP - shared types
├── importer.ts            # MODIFY - use reader factory
├── gradual-extraction.ts  # KEEP - no changes needed
└── index.ts               # MODIFY - export factory
```

### Reader Interface (extract from current OpenCodeReader)

```typescript
// src/integrations/opencode/reader-interface.ts
export interface IOpenCodeReader {
  getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]>;
  getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]>;
  getAgentInfo(agentName: string): Promise<OpenCodeAgent | null>;
  getAllUniqueAgents(sessionId: string): Promise<string[]>;
  getFirstAgent(sessionId: string): Promise<string | null>;
}
```

### SQLite Reader Implementation

```typescript
// src/integrations/opencode/sqlite-reader.ts
import Database from 'better-sqlite3';
import type { IOpenCodeReader } from './reader-interface.js';

export class SqliteReader implements IOpenCodeReader {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    // Open read-only to not interfere with OpenCode
    this.db = new Database(dbPath, { readonly: true });
  }
  
  async getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]> {
    const sinceMs = since.getTime();
    const stmt = this.db.prepare(`
      SELECT id, title, directory, project_id, parent_id, time_created, time_updated
      FROM session
      WHERE time_updated > ? AND parent_id IS NULL
      ORDER BY time_updated DESC
    `);
    
    const rows = stmt.all(sinceMs);
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      directory: row.directory,
      projectId: row.project_id,
      parentId: row.parent_id,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }));
  }
  
  async getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]> {
    const sinceMs = since?.getTime() ?? 0;
    
    // Get messages
    const msgStmt = this.db.prepare(`
      SELECT id, session_id, time_created, data
      FROM message
      WHERE session_id = ? AND time_created > ?
      ORDER BY time_created ASC
    `);
    
    const messages = msgStmt.all(sessionId, sinceMs);
    const result: OpenCodeMessage[] = [];
    
    for (const msg of messages) {
      const msgData = JSON.parse(msg.data);
      const content = await this.getMessageContent(msg.id);
      if (!content) continue;
      
      result.push({
        id: msg.id,
        sessionId: msg.session_id,
        role: msgData.role,
        agent: (msgData.agent || 'build').toLowerCase(),
        content,
        timestamp: new Date(msg.time_created).toISOString(),
      });
    }
    
    return result;
  }
  
  private async getMessageContent(messageId: string): Promise<string | null> {
    const stmt = this.db.prepare(`
      SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC
    `);
    
    const parts = stmt.all(messageId);
    const textParts: string[] = [];
    
    for (const part of parts) {
      const partData = JSON.parse(part.data);
      if (partData.type !== 'text') continue;
      if (partData.synthetic === true) continue;
      if (!partData.text) continue;
      textParts.push(partData.text);
    }
    
    return textParts.length > 0 ? textParts.join('\n\n') : null;
  }
  
  // ... other methods similar to JSON reader
}
```

### Reader Factory

```typescript
// src/integrations/opencode/reader-factory.ts
import { existsSync } from 'fs';
import { join } from 'path';
import type { IOpenCodeReader } from './reader-interface.js';
import { JsonReader } from './json-reader.js';
import { SqliteReader } from './sqlite-reader.js';

export function createOpenCodeReader(basePath?: string): IOpenCodeReader {
  const dataDir = basePath ?? getDefaultDataDir();
  const dbPath = join(dataDir, 'opencode.db');
  const storagePath = join(dataDir, 'storage');
  
  // Check for force flags
  if (process.env.EI_OPENCODE_FORCE_JSON === '1') {
    console.log('[OpenCode] Using JSON reader (forced via EI_OPENCODE_FORCE_JSON)');
    return new JsonReader(storagePath);
  }
  
  if (process.env.EI_OPENCODE_FORCE_SQLITE === '1') {
    console.log('[OpenCode] Using SQLite reader (forced via EI_OPENCODE_FORCE_SQLITE)');
    return new SqliteReader(dbPath);
  }
  
  // Auto-detect
  if (existsSync(dbPath)) {
    console.log('[OpenCode] Using SQLite reader (opencode.db detected)');
    return new SqliteReader(dbPath);
  }
  
  if (existsSync(storagePath)) {
    console.log('[OpenCode] Using JSON reader (legacy storage detected)');
    return new JsonReader(storagePath);
  }
  
  console.log('[OpenCode] No OpenCode data found');
  return new JsonReader(storagePath); // Will return empty results
}

function getDefaultDataDir(): string {
  return join(process.env.HOME || '~', '.local', 'share', 'opencode');
}
```

### Importer Modification

```typescript
// src/integrations/opencode/importer.ts - modify imports
import { createOpenCodeReader } from './reader-factory.js';

export async function importOpenCodeSessions(
  since: Date,
  options: OpenCodeImporterOptions
): Promise<ImportResult> {
  const { stateManager, interface: eiInterface } = options;
  // Use factory instead of direct instantiation
  const reader = options.reader ?? createOpenCodeReader();
  
  // ... rest unchanged
}
```

## File Changes

```
src/integrations/opencode/
├── reader.ts           → json-reader.ts    # Rename existing
├── sqlite-reader.ts                         # NEW
├── reader-interface.ts                      # NEW (extract interface)
├── reader-factory.ts                        # NEW
├── types.ts                                 # No changes
├── importer.ts                              # Update to use factory
├── gradual-extraction.ts                    # No changes
└── index.ts                                 # Update exports
```

## Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0"
  }
}
```

**Note**: `better-sqlite3` is synchronous and requires native compilation. Consider:
- May need `node-gyp` on some systems
- Won't work in browser (but OpenCode reader is Node-only anyway)
- Alternative: `sql.js` (WASM-based, works everywhere but slower)

## Testing

### Prerequisites

Before starting work:
- [ ] Run `npm run test:all` from project root - all tests must pass
- [ ] Have OpenCode 1.2+ installed with some session history

### Unit Tests

- [ ] `SqliteReader.getSessionsUpdatedSince()` returns correct sessions
- [ ] `SqliteReader.getMessagesForSession()` returns filtered messages
- [ ] `SqliteReader.getMessageContent()` concatenates text parts correctly
- [ ] `SqliteReader` skips synthetic parts and non-text parts
- [ ] Reader factory detects SQLite DB and returns `SqliteReader`
- [ ] Reader factory falls back to `JsonReader` when no DB
- [ ] Force flags override auto-detection

### Integration Tests

- [ ] Import from SQLite produces same topic/message count as JSON (on same data)
- [ ] `extraction_point` timestamps work correctly with SQLite data
- [ ] Gradual extraction works with SQLite reader
- [ ] WAL mode doesn't cause locking issues with OpenCode running

### Manual Verification

- [ ] Downgrade OpenCode to 1.1.x, verify JSON reader still works
- [ ] Upgrade OpenCode to 1.2.x, verify SQLite reader activates
- [ ] Run import while OpenCode session is active (no locking)

### Post-Implementation

- [ ] Run `npm run test:all` - all tests still pass
- [ ] Run full import cycle with SQLite, verify data integrity

## Performance Expectations

| Metric | JSON Reader | SQLite Reader |
|--------|-------------|---------------|
| Sessions query | ~8 file reads/session | 1 SQL query |
| Messages query | ~N file reads/message | 1 SQL query |
| Parts query | ~M file reads/message | 1 SQL query |
| Expected speedup | baseline | 5-10x faster |

## Notes

- SQLite WAL mode means we can read while OpenCode writes
- `better-sqlite3` is synchronous but that's fine for our use case (bulk reads)
- The `data` JSON column means we still parse JSON, just less file I/O
- Keep JSON reader for at least 3 months to support gradual user migration
- OpenCode said "original data is not yet deleted" - eventually they will delete it

## Future Considerations

- [ ] 0146: Remove JSON reader after deprecation period (3 months)
- [ ] Consider caching frequently-accessed sessions in memory
- [ ] Could expose SQLite directly for advanced queries (session search, etc.)
