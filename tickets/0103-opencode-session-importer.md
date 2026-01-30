# 0103: OpenCode Session Importer

**Status**: PENDING
**Depends on**: 0102, 0060-0065

## Summary

Import OpenCode sessions into Ei, either as conversation history with a "Sisyphus" persona or by running through the extraction pipeline.

## Acceptance Criteria

- [ ] Creates "Sisyphus" persona if not exists (static, non-dynamic)
- [ ] Imports sessions as Message[] to Sisyphus persona
- [ ] Option: Run extraction pipeline on imported messages
- [ ] Option: Import as read-only context (no extraction)
- [ ] Tracks last-imported session per project (avoid duplicates)
- [ ] Handles incremental imports (only new sessions/messages)
- [ ] CLI command: `ei import-sessions [--project PATH] [--since DATE]`

## Notes

Import modes:
1. **Full import**: Messages become Sisyphus conversation history
2. **Extract only**: Run fact/trait/topic extraction, don't store messages
3. **Summary only**: Just extract session summaries as Human facts

The Sisyphus persona should be:
- `is_dynamic: false` (no ceremony, no heartbeat)
- Represents the coding agent's perspective
- Traits reflect "helpful", "technical", "thorough"

**Privacy consideration**: Session content may contain sensitive code, API keys, etc. Import should sanitize or flag sensitive patterns.
