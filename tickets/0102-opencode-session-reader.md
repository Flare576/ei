# 0102: OpenCode Session Reader

**Status**: PENDING
**Depends on**: 0101

## Summary

Create a module that reads OpenCode session history from `~/.local/share/opencode/storage/` and transforms it into Ei-compatible data structures.

## Acceptance Criteria

- [ ] Reads session metadata from `storage/session/{project_hash}/ses_xxx.json`
- [ ] Reads message metadata from `storage/message/ses_xxx/msg_xxx.json`
- [ ] Reads message content from `storage/part/msg_xxx/prt_xxx.json`
- [ ] Filters parts: KEEP `type="text" && !synthetic`, SKIP everything else
- [ ] Returns sessions updated since a given timestamp
- [ ] Transforms to Ei Message format with agent attribution
- [ ] Extracts agent info (name, description) from OpenCode Agent config
- [ ] Handles large sessions gracefully (streaming/pagination)

## Notes

### OpenCode Storage Structure

```
~/.local/share/opencode/storage/
├── session/{project_hash}/
│   └── ses_xxx.json         # {id, title, directory, time: {created, updated}}
├── message/ses_xxx/
│   └── msg_xxx.json         # {id, sessionID, role, time: {created}, agent, model}
└── part/msg_xxx/
    └── prt_xxx.json         # Content parts (see below)
```

Sessions are project-scoped via `project_hash` (git root commit hash, or "global" for non-git).

### Part Types (Critical for Filtering)

Each message has multiple "parts" in `storage/part/{msg_id}/`:

| Part Type | `type` | `synthetic` | Action |
|-----------|--------|-------------|--------|
| User/Assistant text | `"text"` | `false`/absent | **KEEP** - actual conversation |
| Tool call summary | `"text"` | `true` | **SKIP** - "Called the Read tool..." |
| File attachment | `"file"` | — | **SKIP** - file metadata, not content |

### Output Types

```typescript
interface OpenCodeSession {
  id: string;                    // ses_xxx
  title: string;                 // Session title (may be auto-generated)
  directory: string;             // Full path to project
  time: { created: number; updated: number };
}

interface OpenCodeMessage {
  id: string;                    // msg_xxx
  sessionId: string;             // ses_xxx
  role: "user" | "assistant";
  agent: string;                 // "build", "sisyphus", etc.
  content: string;               // Filtered, concatenated text parts
  timestamp: string;             // ISO from time.created
}

interface OpenCodeAgent {
  name: string;
  description?: string;
}
```

### API Surface

```typescript
// Main entry points
async function getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]>
async function getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]>
async function getAgentInfo(agentName: string): Promise<OpenCodeAgent | null>
```

### Why This Matters

A 4000+ line session with tool calls and file reads becomes ~200-400 lines of actual human/assistant dialogue. This is what we want for persona context:
- User questions, decisions, context
- Assistant reasoning, explanations, plans
- NOT: file contents, tool invocations, embedded code

### Implementation Approach

1. **No OpenCode tooling required** — pure filesystem reads
2. **Message metadata** → role, timestamp, agent from `message/{session}/{msg}.json`
3. **Content** → filtered parts from `part/{msg_id}/*.json`
4. **Agent info** → from OpenCode config or defaults
5. **Assembly** → timestamp-ordered conversation turns

This module is READ-ONLY. It never modifies OpenCode data.
