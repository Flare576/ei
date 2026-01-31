# 0102: OpenCode Session Reader

**Status**: PENDING
**Depends on**: 0101

## Summary

Create a module that reads OpenCode session history from `~/.local/share/opencode/storage/` and transforms it into Ei-compatible data.

## Acceptance Criteria

- [ ] Reads session metadata from `storage/session/{project_hash}/`
- [ ] Reads message metadata from `storage/message/ses_xxx/`
- [ ] Reads message content from `storage/part/msg_xxx/`
- [ ] Filters by project path (optional)
- [ ] Filters by date range
- [ ] Transforms to Ei Message format
- [ ] Handles large sessions gracefully (streaming/pagination)
- [ ] Extracts session summaries (title, duration, project)

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

Sessions are project-scoped via `project_hash` (derived from directory path).

### Part Types (Critical for Filtering)

Each message has multiple "parts" in `storage/part/{msg_id}/`:

| Part Type | `type` | `synthetic` | Action |
|-----------|--------|-------------|--------|
| User/Assistant text | `"text"` | `false`/absent | **KEEP** - actual conversation |
| Tool call summary | `"text"` | `true` | **SKIP** - "Called the Read tool..." |
| File attachment | `"file"` | — | **SKIP** - file metadata, not content |

### jq Filter for Conversation Extraction

```bash
# Extract only conversational text (no tool calls, no file contents)
jq -r 'select(.type == "text" and .synthetic != true) | .text // empty'
```

### Why This Matters

A 4000+ line session with tool calls and file reads becomes ~200-400 lines of actual human/assistant dialogue. This is what we want for Sisyphus persona context:
- User questions, decisions, context
- Assistant reasoning, explanations, plans
- NOT: file contents, tool invocations, embedded code

### Implementation Approach

1. **No OpenCode tooling required** — pure `jq` + filesystem
2. **Message metadata** → role, timestamp from `message/{session}/{msg}.json`
3. **Content** → filtered parts from `part/{msg_id}/*.json`
4. **Assembly** → timestamp-ordered conversation turns

This module is READ-ONLY. It never modifies OpenCode data.
