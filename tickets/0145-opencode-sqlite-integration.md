# 0145: OpenCode 1.2 SQLite Integration

**Status**: DONE
**Depends on**: None
**Priority**: High (users upgrading to OpenCode 1.2 will break without this)

## Summary

OpenCode 1.2 migrated from flat JSON files to a SQLite database. Ei's `OpenCodeReader` currently reads the JSON files directly. Add SQLite support with automatic detection: if `opencode.db` exists, use it; otherwise fall back to JSON.

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
CREATE TABLE `session` (
  `id` text PRIMARY KEY,              -- ses_xxx (SAME format!)
  `project_id` text NOT NULL,
  `parent_id` text,
  `slug` text NOT NULL,
  `directory` text NOT NULL,
  `title` text NOT NULL,
  `version` text NOT NULL,
  `time_created` integer NOT NULL,    -- Unix ms (SAME format!)
  `time_updated` integer NOT NULL
);

CREATE TABLE `message` (
  `id` text PRIMARY KEY,              -- msg_xxx (SAME format!)
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL                -- JSON blob with role, agent, etc.
);

CREATE TABLE `part` (
  `id` text PRIMARY KEY,
  `message_id` text NOT NULL,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL                -- JSON blob with type, text, etc.
);
```

### Key Compatibility Facts

1. **IDs preserved**: `ses_xxx`, `msg_xxx` format unchanged
2. **Timestamps preserved**: Unix milliseconds, same as JSON
3. **Data in JSON columns**: Message/part payload is JSON in `data` column

## Acceptance Criteria

- [x] Create `SqliteReader` class with same interface as `OpenCodeReader`
- [x] Auto-detect: if `opencode.db` exists, use SQLite; otherwise use JSON
- [x] Use `bun:sqlite` (built into Bun, zero dependencies)
- [x] Open database read-only (don't interfere with OpenCode)
- [x] Log which reader is active on startup
- [x] Rename env var from `EI_OPENCODE_STORAGE_PATH` to `EI_OPENCODE_DATA_PATH`

## Technical Design

### Use `bun:sqlite` (Zero Dependencies)

Bun has built-in SQLite support - no npm packages needed:

```typescript
import { Database } from "bun:sqlite";

const db = new Database(dbPath, { readonly: true });
```

Benefits:
- Zero npm dependencies (vs `better-sqlite3` which requires native compilation)
- 3-6x faster than `better-sqlite3`
- Same synchronous API
- WAL mode works automatically for concurrent reads

### File Structure

```
src/integrations/opencode/
├── reader.ts              # RENAME to json-reader.ts
├── sqlite-reader.ts       # NEW
├── reader-factory.ts      # NEW - auto-detection logic
├── types.ts               # Add IOpenCodeReader interface
├── importer.ts            # Update to use factory
├── gradual-extraction.ts  # No changes
└── index.ts               # Update exports
```

### Reader Interface

Extract interface from current `OpenCodeReader` (add to types.ts):

```typescript
export interface IOpenCodeReader {
  getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]>;
  getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]>;
  getAgentInfo(agentName: string): Promise<OpenCodeAgent | null>;
  getAllUniqueAgents(sessionId: string): Promise<string[]>;
  getFirstAgent(sessionId: string): Promise<string | null>;
}
```

### SQLite Reader

```typescript
// src/integrations/opencode/sqlite-reader.ts
import { Database } from "bun:sqlite";
import type { IOpenCodeReader, OpenCodeSession, OpenCodeMessage, OpenCodeAgent } from "./types.js";
import { BUILTIN_AGENTS } from "./types.js";

export class SqliteReader implements IOpenCodeReader {
  private db: Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
  }
  
  async getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]> {
    const sinceMs = since.getTime();
    const rows = this.db.query(`
      SELECT id, title, directory, project_id, parent_id, time_created, time_updated
      FROM session
      WHERE time_updated > ?1 AND parent_id IS NULL
      ORDER BY time_updated DESC
    `).all(sinceMs);
    
    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      directory: row.directory,
      projectId: row.project_id,
      parentId: row.parent_id ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
    }));
  }
  
  async getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]> {
    const sinceMs = since?.getTime() ?? 0;
    
    const messages = this.db.query(`
      SELECT id, session_id, time_created, data
      FROM message
      WHERE session_id = ?1 AND time_created > ?2
      ORDER BY time_created ASC
    `).all(sessionId, sinceMs);
    
    const result: OpenCodeMessage[] = [];
    
    for (const msg of messages as any[]) {
      const msgData = JSON.parse(msg.data);
      const content = this.getMessageContent(msg.id);
      if (!content) continue;
      
      result.push({
        id: msg.id,
        sessionId: msg.session_id,
        role: msgData.role,
        agent: (msgData.agent || "build").toLowerCase(),
        content,
        timestamp: new Date(msg.time_created).toISOString(),
      });
    }
    
    return result;
  }
  
  private getMessageContent(messageId: string): string | null {
    const parts = this.db.query(`
      SELECT data, time_created FROM part 
      WHERE message_id = ?1 
      ORDER BY time_created ASC
    `).all(messageId);
    
    const textParts: string[] = [];
    
    for (const part of parts as any[]) {
      const partData = JSON.parse(part.data);
      if (partData.type !== "text") continue;
      if (partData.synthetic === true) continue;
      if (!partData.text) continue;
      textParts.push(partData.text);
    }
    
    return textParts.length > 0 ? textParts.join("\n\n") : null;
  }
  
  async getAgentInfo(agentName: string): Promise<OpenCodeAgent | null> {
    const normalized = agentName.toLowerCase();
    if (BUILTIN_AGENTS[normalized]) {
      return BUILTIN_AGENTS[normalized];
    }
    return { name: agentName, description: "OpenCode coding agent" };
  }
  
  async getAllUniqueAgents(sessionId: string): Promise<string[]> {
    const messages = await this.getMessagesForSession(sessionId);
    return [...new Set(messages.map(m => m.agent))];
  }
  
  async getFirstAgent(sessionId: string): Promise<string | null> {
    const row = this.db.query(`
      SELECT data FROM message 
      WHERE session_id = ?1 
      ORDER BY time_created ASC 
      LIMIT 1
    `).get(sessionId) as any;
    
    if (!row) return null;
    const msgData = JSON.parse(row.data);
    return (msgData.agent || "build").toLowerCase();
  }
  
  close(): void {
    this.db.close();
  }
}
```

### Reader Factory

```typescript
// src/integrations/opencode/reader-factory.ts
import { existsSync } from "fs";
import { join } from "path";
import type { IOpenCodeReader } from "./types.js";
import { JsonReader } from "./json-reader.js";
import { SqliteReader } from "./sqlite-reader.js";

export function createOpenCodeReader(basePath?: string): IOpenCodeReader {
  const dataDir = basePath ?? getDefaultDataDir();
  const dbPath = join(dataDir, "opencode.db");
  const storagePath = join(dataDir, "storage");
  
  if (existsSync(dbPath)) {
    console.log("[OpenCode] Using SQLite reader");
    return new SqliteReader(dbPath);
  }
  
  if (existsSync(storagePath)) {
    console.log("[OpenCode] Using JSON reader (legacy)");
    return new JsonReader(storagePath);
  }
  
  console.log("[OpenCode] No OpenCode data found");
  return new JsonReader(storagePath); // Will return empty results
}

function getDefaultDataDir(): string {
  return process.env.EI_OPENCODE_DATA_PATH ?? 
    join(process.env.HOME || "~", ".local", "share", "opencode");
}
```

### Importer Update

```typescript
// src/integrations/opencode/importer.ts
// Change:
const reader = options.reader ?? new OpenCodeReader();

// To:
import { createOpenCodeReader } from "./reader-factory.js";
const reader = options.reader ?? createOpenCodeReader();
```

## Testing

### Unit Tests

- [ ] `SqliteReader.getSessionsUpdatedSince()` returns sessions correctly
- [ ] `SqliteReader.getMessagesForSession()` returns filtered messages
- [ ] `SqliteReader` skips synthetic parts and non-text parts
- [ ] Factory returns `SqliteReader` when `opencode.db` exists
- [ ] Factory returns `JsonReader` when only `storage/` exists
- [ ] `EI_OPENCODE_DATA_PATH` env var is respected

### Manual Verification

- [ ] With OpenCode 1.1.x data: JSON reader activates, import works
- [ ] With OpenCode 1.2.x data: SQLite reader activates, import works
- [ ] Run import while OpenCode session is active (no locking issues)

## Performance

| Metric | JSON Reader | SQLite Reader |
|--------|-------------|---------------|
| Sessions query | ~N file reads | 1 SQL query |
| Messages query | ~N file reads | 1 SQL query |
| Expected speedup | baseline | 5-10x faster |

## Notes

- SQLite WAL mode allows concurrent reads while OpenCode writes
- `bun:sqlite` is synchronous but wrapped in async for interface compatibility
- Keep JSON reader indefinitely for users on older OpenCode versions
