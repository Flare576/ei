# 0139: Human Entity Data Compression

**Status**: PENDING

## Problem

Over time, the human entity's data buckets can accumulate:
1. **Duplicate entries** - Same concept stored multiple times (e.g., two "Facts" both named "Juliet")
2. **Miscategorized entries** - Items placed in wrong bucket (e.g., "Juliet" stored as FACT when it should be PERSON)

This creates noise, confusion, and degrades the quality of prompts that reference this data.

## Solution

Add a periodic "compression" task to Ei's heartbeat cycle that:
1. **Deduplicates** entries within each bucket
2. **Re-categorizes** entries that don't match their bucket's definition
3. **Escalates** uncertain decisions to Ei validation queue for ceremony review

## Functional Requirements

### Compression Trigger
- Runs during Ei persona's heartbeat cycle
- Only processes human entity (not personas)
- Frequency: TBD (daily? every N messages? configurable?)

### Step 1: Deduplication

For each data type (FACT, TRAIT, TOPIC, PERSON):
1. Identify duplicates (same or very similar `name` field)
2. For each duplicate set:
   - If confident they're the same → merge into single entry
   - Combine descriptions (preserve unique details from both)
   - Use most recent sentiment/confidence/other fields
   - Preserve all change_log entries
   - If uncertain → create `ei_validation` queue entry

**Example:**
- **Before**: 
  - FACT: `{ name: "Juliet", description: "User's wife" }`
  - FACT: `{ name: "Juliet", description: "Married in 2015" }`
- **After**: 
  - FACT: `{ name: "Juliet", description: "User's wife, married in 2015" }`

### Step 2: Re-categorization

For FACT, TRAIT, and PEOPLE buckets (not TOPIC - it's a catch-all):

1. **Validate categorization** against bucket definition
   - Load Step 1 prompt for current bucket type
   - Compare entry against "A [TYPE] Is" and "A [TYPE] Is Not" sections
   - If entry doesn't match current bucket definition → proceed to re-categorization

2. **Find correct bucket**
   - Test against TRAIT definition (if not already there)
   - Test against PERSON definition (if not already there)
   - Test against TOPIC definition (always matches - catch-all)
   - Use first matching bucket

3. **Move to correct bucket**
   - Run Step 1 for target bucket to identify if:
     - New entry (no match) → create in target bucket
     - Existing match → merge with existing entry
   - Remove from original bucket
   - If uncertain about merge → create `ei_validation` queue entry

**Example:**
- **Before**: FACT: `{ name: "Juliet", description: "User's wife, married in 2015" }`
- **Analysis**: "Juliet" is a person, not a biographical fact
- **After**: PERSON: `{ name: "Juliet", relationship: "Wife", description: "Married in 2015" }`

### Step 3: Validation Queue Escalation

When the system is uncertain about:
- Whether two entries are duplicates
- Which bucket an entry belongs in
- How to merge conflicting information

Create an `ei_validation` queue entry with:
```typescript
{
  type: "compression_review",
  category: "duplicate" | "categorization" | "merge_conflict",
  entries: [...], // The entries in question
  reasoning: "Why this needs human review",
  suggested_action: "What the LLM thinks should happen"
}
```

Ei will review these during Daily Ceremony.

## Technical Design

### New Files
- `src/compression.ts` - Core compression logic
  - `compressHumanEntity()` - Main orchestrator
  - `deduplicateBucket()` - Merge duplicates within bucket
  - `recategorizeBucket()` - Move miscategorized entries
  - `shouldMerge()` - LLM call to decide if two entries are same
  - `findCorrectBucket()` - LLM call to categorize entry

### New Prompts
- `src/prompts/compression/duplicate-detection.ts` - Identify duplicates
- `src/prompts/compression/merge-decision.ts` - Decide if two entries should merge
- `src/prompts/compression/categorization.ts` - Determine correct bucket

### Integration Point
- Call `compressHumanEntity()` from `heartbeat.ts` during Ei's heartbeat
- Add compression state tracking (last run, frequency control)

### Configuration
Add to `ei_state.jsonc`:
```jsonc
{
  "compression": {
    "last_run": "2026-01-24T...",
    "frequency_hours": 24, // How often to compress
    "enabled": true
  }
}
```

## Acceptance Criteria

- [ ] Compression runs automatically during Ei heartbeat cycle
- [ ] Duplicate entries are merged within each bucket
- [ ] Miscategorized entries are moved to correct bucket
- [ ] Uncertain decisions create `ei_validation` queue entries
- [ ] Change logs are preserved during merge operations
- [ ] Configuration allows enabling/disabling and frequency control
- [ ] Debug logging tracks compression operations
- [ ] Tests cover:
  - [ ] Duplicate detection and merging
  - [ ] Re-categorization logic
  - [ ] Validation queue escalation
  - [ ] Edge cases (conflicting data, ambiguous categories)

## Dependencies

- Requires: 0134 (Three-Step Extraction) - uses Step 1 prompts for categorization
- Requires: 0115 (Data Verification Flow) - uses `ei_validation` queue

## Open Questions

1. **Compression frequency**: Daily? Every N messages? Configurable?
2. **ei_validation queue entry structure**: Does the proposed format work for ceremony prompts?
3. **Merge strategy**: How to handle conflicting sentiment/confidence values when merging?
4. **Performance**: Should we limit compression to only "recently changed" entries?
5. **Recursion**: After moving an entry, should we immediately check if it needs another move?

## Notes

- TOPIC bucket is intentionally excluded from re-categorization (it's the catch-all)
- This is a **background cleanup task**, not user-facing
- Should be low-priority, interruptible work (don't block heartbeats)
- Consider adding `/compress` command for manual triggering during development
