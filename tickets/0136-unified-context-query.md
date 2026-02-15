# 0136: Unified Context Query (Experimental)

**Status**: PENDING
**Depends on**: 0102, 0103

## Summary

Add an `ei context --snippet "..."` command that aggregates results from all entity types in a single query. This is the "unified export" concept from 0104, adapted for the query-based paradigm.

## Background

The original 0104 (Context Exporter) assumed all context could fit in a markdown file. With 9MB+ messages and ~1MB entity data, that's not feasible. The query-based CLI commands work well for targeted retrieval, but sometimes you want a holistic view—"tell me everything relevant to X".

This ticket also captures experimental features from 0104 that weren't implemented in the basic CLI commands.

## Acceptance Criteria

### Core Command

- [ ] `ei context --snippet "..."` queries ALL entity types (quotes, facts, traits, people, topics)
- [ ] Returns aggregated results with type labels
- [ ] Respects `--limit` per entity type (default: 3 each)
- [ ] Output: JSON (default) or markdown (`--format markdown`)

### Experimental Features (lower priority)

- [ ] **Sentiment trends**: Aggregate recent message sentiment by persona
- [ ] **Exposure filtering**: Filter topics by `exposure_current > threshold`
- [ ] **Recency weighting**: Boost results from recently-updated entities
- [ ] **Relationship mapping**: Show how entities connect (e.g., person→topics they're mentioned with)

## Example Output

```bash
ei context --snippet "work stress" --format markdown
```

```markdown
## Ei Context: "work stress"

### Quotes (2)
- "I need to stop checking Slack after 6pm" (2026-02-10)
- "The deadline moved again and I'm losing it" (2026-02-08)

### Facts (3)
- Works at ASU as Solutions Architect
- Prefers async communication over meetings
- Currently managing IDP project migration

### Traits (2)
- Perfectionist tendencies (strength: 0.7)
- Stress response: withdrawal then hyperfocus

### People (1)
- Morgan (wife) - supportive during work stress

### Topics (3)
- ASU IDP project (exposure: 0.8)
- Work-life balance (exposure: 0.6)
- Burnout prevention (exposure: 0.4)
```

## Notes

This is marked experimental because:
1. The aggregation logic may need tuning (how many of each type? how to rank across types?)
2. Sentiment trends require new computation not currently in the codebase
3. Exposure filtering needs threshold tuning and UX decisions

Start with the core command, iterate on experimental features based on actual usage.

## API Design Notes

```typescript
// Potential implementation approach
interface ContextQueryResult {
  query: string;
  quotes: Quote[];
  facts: HumanFact[];
  traits: HumanTrait[];
  people: HumanPerson[];
  topics: HumanTopic[];
  meta?: {
    sentiment_summary?: Record<string, number>; // persona → avg sentiment
    exposure_summary?: Record<string, number>;  // topic → exposure
  };
}
```
