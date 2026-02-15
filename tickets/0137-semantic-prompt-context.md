# 0137: Semantic Prompt Context Selection

**Status**: PENDING
**Depends on**: None (embedding infrastructure exists)
**Priority**: High (quality + efficiency win)

## Summary

Replace the naive "grab and shove" context selection in response prompts with embedding-based semantic retrieval. Instead of including all facts and top-N topics by exposure, include only entities semantically relevant to the current conversation.

## Background

Current `buildResponsePromptData()` includes:
- **All** human facts (filtered only by visibility groups)
- **All** human traits
- **Top 10** human topics where `exposure_current > 0.3`
- **Top 10** human people by `exposure_current`
- **Most recent 10** quotes

This approach:
1. **Wastes tokens** on irrelevant context
2. **Dilutes signal** - persona sees hobby facts when discussing work stress
3. **Ignores semantic relevance** entirely

The embedding infrastructure already exists and is proven (used in extraction to reduce prompts by 20x). We should use it here.

## Acceptance Criteria

### Core Implementation

- [ ] Create `buildSemanticContext()` function that:
  - Takes recent messages (or conversation summary)
  - Embeds the query text
  - Finds top-K similar items per entity type
  - Returns filtered context

- [ ] Integrate with `Processor.buildResponsePromptData()`:
  - Call semantic retrieval before building prompt
  - Replace arbitrary filtering with relevance-based selection

- [ ] Respect existing constraints:
  - Visibility group filtering still applies
  - Ei still sees everything (but semantically sorted)

### Configuration

- [ ] Configurable limits per entity type (default: 5 facts, 5 traits, 8 topics, 5 people, 5 quotes)
- [ ] Minimum similarity threshold (default: 0.3)
- [ ] Fallback: If embeddings unavailable, use current behavior

### Hybrid Approach (exposure + relevance)

- [ ] Don't completely ignore exposure—high-exposure items the persona wants to discuss should still appear
- [ ] Blend: top 3 by relevance + top 2 by exposure gap (configurable)

## Technical Design

### Query Text Options

What text do we embed to find relevant context?

| Option | Pros | Cons |
|--------|------|------|
| Last user message | Simple, direct | May miss conversational thread |
| Last 3 messages | Better context | More tokens to embed |
| Conversation summary | Captures theme | Requires LLM call (expensive) |
| **Last user message + recent assistant topic mentions** | Balanced | Slightly more complex |

**Recommendation**: Start with last user message. Iterate based on results.

### Implementation Location

```
src/core/
├── semantic-context.ts    # NEW: Semantic context builder
├── embedding-service.ts   # Existing: Reuse embed() and findTopK()
└── processor.ts           # Modify: Call semantic context in buildResponsePromptData()
```

### Pseudo-implementation

```typescript
// src/core/semantic-context.ts
import { getEmbeddingService, findTopK, cosineSimilarity } from "./embedding-service.js";

interface SemanticContextConfig {
  limits: {
    facts: number;     // default 5
    traits: number;    // default 5
    topics: number;    // default 8
    people: number;    // default 5
    quotes: number;    // default 5
  };
  minSimilarity: number;  // default 0.3
  exposureBlend: number;  // default 2 (top N by exposure to always include)
}

export async function buildSemanticContext(
  queryText: string,
  human: HumanEntity,
  config: SemanticContextConfig
): Promise<FilteredHumanData> {
  const service = getEmbeddingService();
  const queryEmbedding = await service.embed(queryText);
  
  // Find relevant items per type
  const relevantFacts = findTopK(queryEmbedding, human.facts, config.limits.facts, config.minSimilarity);
  const relevantTraits = findTopK(queryEmbedding, human.traits, config.limits.traits, config.minSimilarity);
  // ... etc
  
  // Blend with exposure-based selection for topics
  const byRelevance = findTopK(queryEmbedding, human.topics, config.limits.topics - config.exposureBlend);
  const byExposure = human.topics
    .filter(t => !byRelevance.some(r => r.id === t.id))
    .sort((a, b) => (b.exposure_desired - b.exposure_current) - (a.exposure_desired - a.exposure_current))
    .slice(0, config.exposureBlend);
  const relevantTopics = [...byRelevance, ...byExposure];
  
  return { facts: relevantFacts, traits: relevantTraits, topics: relevantTopics, ... };
}
```

### Performance Considerations

- **Embedding query**: ~100-500ms (one-time per response)
- **findTopK**: Near-instant (cosine similarity on pre-computed vectors)
- **Total overhead**: <1s, acceptable for response generation
- **Optimization**: Could cache query embeddings for multi-turn conversations

## Example Impact

**Scenario**: User says "I'm stressed about the IDP project deadline"

**Before (naive)**:
```
### Key Facts
- Drives a 1987 Porsche 944
- Has a daughter named Luna
- Works at ASU as Solutions Architect  ← relevant
- Prefers vim keybindings
- Enjoys cooking Italian food
... (all 30 facts)
```

**After (semantic)**:
```
### Key Facts
- Works at ASU as Solutions Architect  ← 0.89 similarity
- Managing IDP project migration       ← 0.85 similarity
- Prefers async communication          ← 0.72 similarity
- Tends toward perfectionism under pressure ← 0.68 similarity
- Wife Morgan is supportive during stress  ← 0.61 similarity
```

## Metrics to Track

- Token count reduction (expect 30-50% reduction)
- Response relevance (qualitative—do responses stay on topic better?)
- Embedding query latency (should be <500ms)

## Notes

This is the natural evolution of the CLI query system (0102, 0103, 0136) applied internally. The same embedding infrastructure serves both external queries (MCP tools) and internal context curation.

**Risk**: Over-filtering could make personas seem forgetful. The exposure-blend ensures they still bring up topics they care about, even if not directly relevant.

## Related Tickets

- 0136: Unified Context Query (external facing, similar concept)
- 0102: OpenCode Session Reader (embedding infrastructure)
- 0103: OpenCode Session Importer (embedding infrastructure)
