# 0153: CLI Search Signature Redesign

**Status**: QA
**Depends on**: None
**Blocked by**: None

## Summary

Redesign the `ei` CLI search interface so it works naturally without requiring `--snippet` flags. A bare string argument searches all data types and returns the best matches across them. Subcommands narrow to a specific type. The `--limit`/`-n` flag replaces `--limit`/`-l`.

## Current Behavior

```bash
ei quotes --snippet "debugging"        # type-specific, requires --snippet flag
ei facts -s "API design" -s "patterns" # multiple snippets via -s
```

## Target Behavior

```bash
# Global search (all types, balanced results)
ei "the string of text"               # Top 10 results across all data types
ei -n 5 "the string of text"          # Limit to 5 results

# Type-specific subcommands
ei quote "you guessed it"             # Top 10 quotes matching string
ei quote -n 5 "you guessed it"        # Limit to 5
ei fact "API design"
ei trait "problem solving"
ei person "collaboration"
ei topic "architecture"
```

## Acceptance Criteria

### CLI Signature

- [x] `ei "text"` — searches all data types, returns top N results (default 10)
- [x] `ei -n <number> "text"` — adjusts result count (`--number`/`-n`)
- [x] `ei <type> "text"` — searches single type (same N default)
- [x] `ei <type> -n <number> "text"` — type-specific with limit
- [x] Old `--snippet`/`-s` flag removed; positional string argument required
- [x] Old `--limit`/`-l` replaced by `--number`/`-n`

### Subcommand Aliases

Accept both singular and plural for subcommands (e.g. `quote` and `quotes` both work):
- [x] `quote` / `quotes`
- [x] `fact` / `facts`
- [x] `trait` / `traits`
- [x] `person` / `people`
- [x] `topic` / `topics`

### Global Search Balancing

- [x] When searching all types, ensure at least 1 result per type that meets the similarity threshold (0.3), up to the limit
- [x] After the floor is satisfied, fill remaining slots with the highest-similarity results across all types
- [x] Result output includes a `type` field so the caller knows what kind of result each entry is

### Output Format

Preserve existing JSON output. Add `type` field to each result for global searches:

```json
[
  { "type": "quote", "id": "...", "text": "...", ... },
  { "type": "fact",  "id": "...", "name": "...", ... }
]
```

Type-specific searches may omit the `type` field (already implied).

### Help / Error Messages

- [x] `ei --help` updated to reflect new signature
- [x] Clear error if no search string provided
- [x] Clear error for unknown subcommand

## Notes

- Current entry point: `src/cli.ts`
- Search logic: `src/cli/retrieval.ts` (`retrieve()` function)
- Per-type commands live in `src/cli/commands/{quotes,facts,traits,people,topics}.ts`
- Balancing logic is new — add a `retrieveBalanced()` helper in `retrieval.ts`
- The `--snippet` flag existed to support multiple search terms; a single positional string covers the same use case (caller can quote a multi-word phrase)
