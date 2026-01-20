# 0107: Entity Data Architecture Overhaul (Epic)

**Status**: IN_PROGRESS

## Summary

Complete redesign of how EI stores and processes information about humans and personas. Replaces the monolithic "Concept" system with structured data buckets (Facts, Traits, Topics, People), introduces two-phase LLM extraction, and expands Ei's role as system orchestrator/validator.

## Background

The current "Concept" system has fundamental problems:
- Single `type` field conflates personality traits, biographical facts, discussion topics, and relationships
- `type: "persona"` means "trait" but confuses with "AI persona"
- `type: "person"` gets conflated with personas when users discuss them
- Prompts are bloated with redundant sections
- No compaction/expiration strategy (maps grow unbounded)
- Same vague prompt for all extraction (leads to garbage data)
- `static` concepts with level fields don't make sense for behavioral guardrails

## Design Decisions (from discussion with Flare)

### Terminology

| Term | Definition |
|------|------------|
| **Entity** | Human or Persona in the system |
| **Human** | The real user (one per profile) |
| **Persona** | An AI entity the human interacts with |
| **Fact** | Immutable biographical data about an entity |
| **Trait** | Core characteristic/behavior pattern of an entity |
| **Topic** | Discussable subject with engagement dynamics |
| **Person** | Real human in the user's life (human entity only) |

### New Entity Schema

**Human Entity:**
```typescript
interface HumanEntity {
  entity: "human";
  facts: Fact[];      // Birthday, location, occupation, constraints
  traits: Trait[];    // Personality patterns, communication style
  topics: Topic[];    // Interests with engagement levels
  people: Person[];   // Relationships
  last_updated: string | null;
}
```

**Persona Entity:**
```typescript
interface PersonaEntity {
  entity: "system";
  // Identity
  aliases?: string[];
  short_description?: string;
  long_description?: string;
  model?: string;
  // Visibility
  group_primary?: string | null;
  groups_visible?: string[];
  // Data (simpler than human)
  traits: Trait[];    // Character personality
  topics: Topic[];    // What this persona cares about
  // No facts (personas don't have birthdays)
  // No people (relationships are just topics for personas)
  // State flags...
  last_updated: string | null;
}
```

### Data Structures

```typescript
interface DataItemBase {
  name: string;
  description: string;
  sentiment: number;           // -1 to 1 (kept for programmatic filtering)
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
  change_log?: ChangeEntry[];  // For Ei validation
}

interface ChangeEntry {
  date: string;
  persona: string;
  delta_size: number;          // Rough magnitude of change
}

interface Fact extends DataItemBase {
  confidence: number;          // 0-1, affects re-verification frequency
  last_confirmed?: string;     // When user last confirmed
}

interface Trait extends DataItemBase {
  strength?: number;           // 0-1, how strongly this manifests
}

interface Topic extends DataItemBase {
  level_current: number;       // 0-1, exposure/recency
  level_ideal: number;         // 0-1, discussion desire
}

interface Person extends DataItemBase {
  relationship: string;        // "daughter", "boss", "friend"
  level_current: number;
  level_ideal: number;
}
```

### Two-Phase Extraction

Instead of one massive "update all concepts" call:

**Phase 1: Fast-Scan**
- Lightweight prompt with just names/titles
- Returns: which known items were mentioned + potential new items
- Includes confidence levels (high/medium/low)
- Low-confidence items queue for Ei validation instead of detail extraction

**Phase 2: Detail Update**
- One focused prompt per flagged item
- Can be parallelized
- Better accuracy than "update this whole JSON blob"

### Extraction Frequency

| Data Type | Frequency | Notes |
|-----------|-----------|-------|
| **Facts** | Taper off | Aggressive when empty, rare when full |
| **Traits** | Taper off | Aggressive early, rare once established |
| **Topics** | Every conversation | Engagement levels change frequently |
| **People** | Hybrid | New = immediate; updates = less frequent |

### Ei's Expanded Role

1. **Fact Verification**: "I noticed you mentioned X - is that right?"
2. **Cross-Persona Validation**: "Frodo updated a general topic - intentional?"
3. **Trait Confirmation**: "Based on our chats, you seem introverted - fair?"
4. **Conflict Resolution**: "You told Mike X but Lena Y - which is true?"
5. **Staleness Check**: "Haven't talked about X in months - still into it?"
6. **Data Editing**: `/clarify` command triggers conversational edit flow

### Static Concepts → Prompt Templates

**Baked into ALL persona prompts:**
- Respect Conversational Boundaries
- Emotional Authenticity Over Sycophancy

**Baked into Ei prompt only:**
- Promote Human-to-Human Interaction
- Transparency About Nature
- Encourage Growth Over Comfort

**Seeded as initial traits:**
- Maintain Identity Coherence

**Dropped (operational, not personality):**
- Context-Aware Proactive Timing (system behavior)

### Change Log Strategy

- Only Ei cares about change logs
- Store full previous value (enables "Frodo changed description" detection)
- Ei clears change log after assessment
- No unbounded growth

### LLM Queue Persistence

- New file: `data/llm_queue.jsonc`
- Survives Ctrl+C
- Contains pending extractions, validations, etc.

## Sub-Tickets

### Schema & Storage
- [x] 0108: New Entity Type Definitions (QA - ready for integration testing)
- [x] 0109: Storage Migration (concepts → facts/traits/topics/people) (QA - ready for integration testing)
- [x] 0110: LLM Queue Persistence File (DONE)
- [ ] 0124: Scheduled Jobs Infrastructure (NEW)

### Queue Processing
- [x] 0126: LLM Queue Processor (QA - ready for integration testing)

### Extraction System
- [x] 0111: Fast-Scan Prompt Implementation (QA - ready for integration testing)
- [x] 0112: Detail Update Prompts (QA - all prompts implemented, tests passing)
- [x] 0113: Extraction Frequency Controller (QA - ready for integration testing)
- [x] 0114: Known Personas in Prompts (DONE - completed during 0111/0112)

### Ei Orchestration
- [x] 0115: Data Verification Flow (Daily Ceremony) (QA - ready for integration testing)
- [x] 0116: Cross-Persona Validation (QA - ready for integration testing)
- [x] 0117: /clarify Command (QA - command routing complete, natural language editing via Ei conversation)
- [x] 0118: Ei Heartbeat Simplification (DONE)

### Prompt Restructuring
- [x] 0119: Response Prompt Overhaul (QA - new entity-based prompt structure, tests passing)
- [x] 0120: Static Concepts → Prompt Templates (QA - static concepts removed, seed traits added, tests passing)
- [x] 0121: Ei-Specific System Prompt (QA - Ei has dedicated prompt showing omniscient view, system awareness, and orchestrator role)

### Cleanup
- [ ] 0122: Remove Old Concept System
- [ ] 0123: Update AGENTS.md Documentation

### Future Exploration
- [ ] 0125: Group Chat Exploration (FUTURE - not blocking)

## Acceptance Criteria

- [ ] Human entity has four separate data buckets (facts, traits, topics, people)
- [ ] Persona entity has two data buckets (traits, topics)
- [ ] Two-phase extraction implemented and working
- [ ] Ei validates low-confidence extractions
- [ ] Ei validates cross-persona global updates
- [ ] `/clarify` command enables conversational data editing
- [ ] Static concepts removed, behavior baked into prompts
- [ ] Change logs enable Ei to detect significant modifications
- [ ] LLM queue persists across restarts
- [ ] No backward compatibility needed (fresh start OK)

## Dependencies

- Supersedes: 0102, 0103 (absorbed into this epic)

## Effort Estimate

Large (~20-30 hours across all sub-tickets)

## Open Questions (from sub-ticket creation)

### Answered by Research
1. **Numeric formatting in prompts**: Use 0.0-1.0 for levels, -1.0 to 1.0 for sentiment (industry standard)

### Answered by Flare (2026-01-19)
2. **Ei's initial traits**: Just "Warm but Direct" - System Guide is prompt, not trait
3. **Ei's initial topics**: Empty - Ei has plenty to manage without topic backlog
4. **Dead letter handling**: Log to debug if debug mode, then drop
5. **Validation batching**: Daily Ceremony at 9am (configurable), up to 5 items
6. **Fullness thresholds**: Use `total_extractions` directly: `messages_since > MAX(10, total_extractions)`
7. **Significant revelation**: Not needed - fast-scan handles it, message stays in history until extracted
8. **Verification rate limit**: Daily Ceremony handles this
9. **Batch priority**: Categories first (facts→people→traits→topics), then confidence (low first), max 5
10. **Validation interruptibility**: N/A - validations are async, just another message from Ei
11. **Rate limits**: Daily Ceremony handles this (one ceremony per day)
12. **Emoji indicators**: Yes! LLMs parse emoji efficiently - use them everywhere in prompts
13. **Human data filtering**: Start with 70%/top 10, can adjust based on experience
14. **Trait strength**: Keep it - enables "talk like a pirate occasionally" (strength 0.3)
15. **Person facts**: Use flat `description` field, same as other DataItemBase types

### Additional Design Decisions
- **Extraction trigger**: Every message pair, but extraction is low-priority/interruptible
- **Persona filtering**: Prompt-only, no code validation - let Ei handle ambiguous cases
- **Stale messages**: Check every few minutes for messages >10min old without extraction
- **Ei heartbeat after ceremony**: Pauses until user responds (high confidence next msg is validation response)

## Notes

This is a fundamental architecture change. The goal is:
- Cleaner data model that matches how humans think about information
- More accurate extraction via focused prompts
- Ei as intelligent orchestrator, not just another chatbot
- Sustainable growth (compaction via smart extraction, not unbounded accumulation)

## Known Unsolved Problems

**Roleplay Character Overlap** (documented in 0116):
If human's real daughter is "Betty" but roleplay character has daughter "Alice", we rely on:
1. LLM creating appropriately named entries ("Alice, fictional daughter" as topic)
2. Daily Ceremony catching mistakes
3. Groups isolating roleplay context

May need revisiting if it causes real problems in practice.
