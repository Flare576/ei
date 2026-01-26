# 0069: Concept Schema Overhaul (Epic)

**Status**: DONE

## Summary
Restructure the Concept schema to properly separate three distinct psychological dimensions that were previously conflated:
1. **Exposure** (`level_current`) - How recently/frequently has this concept come up?
2. **Discussion Desire** (`level_ideal`) - How much does the entity want to TALK about this?
3. **Sentiment** (`sentiment`) - How does the entity FEEL about this concept?

Additionally, remove `level_elasticity` as it's replaced by a natural logarithmic decay model.

## Problem
The current schema conflates multiple distinct concepts:

### level_current + level_ideal Confusion
- `level_current` was decaying toward `level_ideal`, treating "ideal" as a baseline
- But "ideal" was also being used to represent "how much they like it"
- Example problem: A human LOVES birthday cake (high ideal?) but only wants to discuss it once a year (low ideal?)

### level_elasticity Redundancy
- Elasticity was meant to control decay rate
- But a logarithmic decay model (fast decay at extremes, slow in middle) is more natural
- Elasticity added complexity without clear benefit

### Missing Sentiment Dimension
- No way to express "I know a lot about X but hate it" vs "I know a lot about X and love it"
- Discussion frequency and emotional valence are independent dimensions

## New Schema

```typescript
interface Concept {
  name: string;
  description: string;
  type: ConceptType;
  learned_by?: string;
  last_updated?: string;
  
  // EXPOSURE: How recently/frequently has this come up?
  // Range: 0.0 to 1.0
  // Decays toward 0.0 over time (logarithmic - fast at extremes)
  // Increases when concept is discussed
  level_current: number;
  
  // DISCUSSION DESIRE: How much does entity want to TALK about this?
  // Range: 0.0 to 1.0
  // Rarely changes - only on explicit preference signals
  // Examples: "I don't want to talk about work" → decrease
  //           User engages deeply with topic → slight increase
  level_ideal: number;
  
  // SENTIMENT: How does entity FEEL about this concept?
  // Range: -1.0 (strongly negative) to 1.0 (strongly positive)
  // 0.0 = neutral
  // Updated when entity expresses emotion about concept
  sentiment: number;
  
  // REMOVED: level_elasticity (replaced by logarithmic decay model)
}
```

## Behavioral Changes

### level_current Decay
- Always decays toward 0.0 (not toward level_ideal)
- Logarithmic rate: `decay = k * level_current * (1 - level_current)`
- This means: high values drop fast, low values drop slow, middle values moderate

### level_ideal Adjustments
Rare, only when:
- Entity explicitly requests more/less discussion ("stop talking about X")
- Sustained engagement pattern (many messages about X → slight increase)
- Clear indifference/avoidance signals (consistently ignoring X → decrease)
- Magnitude influenced by intensity/length/frequency of signals

### sentiment Updates
- Updated when entity expresses emotion about concept
- Model performs sentiment analysis on statements
- Should align with expressed emotion, not predict it
- Can change frequently - emotions are volatile

### Heartbeat Conversation Triggers
With new schema, trigger when:
- `level_current` is low but `level_ideal` is high (entity wants to discuss but hasn't recently)
- AND `sentiment` is not strongly negative (don't bring up painful topics)

## Sub-Tickets

| Ticket | Title | Priority | Effort |
|--------|-------|----------|--------|
| 0070 | Update Concept interface - add sentiment, remove elasticity | High | 1 hour |
| 0071 | Update decay function for logarithmic model | High | 1-2 hours |
| 0072 | Update level_ideal adjustment logic in prompts | High | 2 hours |
| 0073 | Add sentiment field handling in prompts | High | 2 hours |
| 0074 | Update heartbeat trigger logic for new schema | Medium | 1-2 hours |
| 0075 | Update documentation and AGENTS.md | Low | 1 hour |

## Acceptance Criteria
- [x] Concept interface updated with new schema
- [x] level_elasticity removed from all code
- [x] level_current decays toward 0.0 with logarithmic rate
- [x] level_ideal only changes on explicit preference signals
- [x] sentiment field added and updated via sentiment analysis
- [x] Heartbeat triggers use new schema logic
- [x] Existing data migrates cleanly
- [x] All prompts updated with clear guidance
- [x] Documentation reflects new mental model

## Value Statement
**Psychological Realism**: Separating exposure, desire, and sentiment creates a much more accurate model of how entities actually relate to concepts. This enables nuanced behaviors like "I know a lot about X but don't want to discuss it" or "I rarely think about Y but love it when it comes up."

## Dependencies
- 0061 epic should be complete first (or at least 0062-0067)
- This replaces/supersedes 0068 (elasticity guidance)

## Effort Estimate
Medium-Large (~8-10 hours across sub-tickets)

## Technical Notes
- Logarithmic decay formula: `newValue = value - k * value * (1 - value) * hoursSinceUpdate`
- k is a tuning constant (start with 0.1, adjust based on feel)
- sentiment should default to 0.0 for existing concepts
- level_elasticity removal is breaking change - need migration
- Consider: should static concepts have fixed sentiment? Or can personas develop feelings about their core values?
