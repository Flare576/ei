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

OpenCode storage structure:
```
~/.local/share/opencode/storage/
├── session/{project_hash}/
│   └── ses_xxx.json         # {id, title, directory, time: {created, updated}}
├── message/ses_xxx/
│   └── msg_xxx.json         # {id, role, time, agent, model}
└── part/msg_xxx/
    └── prt_xxx.json         # {id, type, text}  ← actual content
```

Sessions are project-scoped via `project_hash` (derived from directory path).

This module is READ-ONLY. It never modifies OpenCode data.
