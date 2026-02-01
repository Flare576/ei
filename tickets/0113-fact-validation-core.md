# 0113: Fact Validation System (Core)

**Status**: DONE
**Depends on**: 0064, 0065, 0067
**Completed**: 2026-02-01

## Summary

Replace unreliable LLM confidence scores with explicit validation tracking. Research shows small models (< 20B) cannot provide meaningful self-assessment—verbalized confidence is "a linguistic artifact, not a reliable epistemic signal." This ticket introduces a `ValidationLevel` enum to track whether facts have been acknowledged by Ei or explicitly confirmed by the user.

## Acceptance Criteria

### Schema Changes

- [x] Add `ValidationLevel` enum to `src/core/types.ts`:
  ```typescript
  enum ValidationLevel {
    None = "none",   // Fresh data, never acknowledged
    Ei = "ei",       // Ei mentioned it to user (don't mention again)
    Human = "human", // User explicitly confirmed (locked)
  }
  ```
- [x] Update `Fact` interface:
  - [x] Remove `confidence: number` field
  - [x] Remove `last_confirmed?: string` field
  - [x] Add `validated: ValidationLevel` field
  - [x] Add `validated_date: string` field
- [x] Update CONTRACTS.md with new schema

### Extraction Flow Changes (Step 1 - Scan)

- [x] Remove `confidence` from `FactScanCandidate` type
- [x] Update `buildHumanFactScanPrompt` to not request confidence
- [x] Update handler to not expect confidence in results

### Extraction Flow Changes (Step 2 - Match)

- [x] Rewrite `ItemMatchPromptData` to include ALL data types:
  ```typescript
  interface ItemMatchPromptData {
    candidate_type: DataItemType;
    candidate_name: string;
    candidate_value: string;
    all_items: Array<{
      data_type: DataItemType;
      data_id: string;
      data_name: string;
      data_description: string; // Full if same type, truncated (255 chars + "...") otherwise
    }>;
  }
  ```
- [x] Simplify `ItemMatchResult` to just: `{ matched_guid: string | null }`
- [x] Rewrite `buildHumanItemMatchPrompt` for new schema
- [x] Update `queueItemMatch` to gather ALL human items with truncation logic
- [x] Add validation check: if `matched_guid` resolves to item with `validated === "human"`, silently exit (don't modify locked facts)

### Extraction Flow Changes (Step 3 - Update)

- [x] Update `queueItemUpdate` to lookup by GUID, not name
- [x] On any update, set `validated: "none"` and `validated_date: now()`
- [x] Handle type mismatch: if matched item is different type than candidate, queue Ei_Validation

### Ei Validation Changes

- [x] Update `handleEiValidation` to set `validated: "ei"` after notifying user
- [ ] Add to Ei prompt: "If the user mentions something that contradicts a known fact, and that fact is locked (human validated), offer a gentle reminder that they can edit their facts directly via the menu (web) or command system (TUI)." — DEFERRED to UI tickets (0114/0115)

### Migration

- [x] Add migration logic for existing facts:
  - `confidence` → dropped
  - `last_confirmed` → `validated_date` (if exists), else `last_updated`
  - `validated` → `"none"` (all existing facts start unvalidated)

## Notes

**Why this change**: Research on LLM calibration (2024-2026) shows small models are "significantly miscalibrated" and verbalized confidence has "poor correlation with accuracy." Rather than pretend we have reliable confidence data, we shift to explicit validation states that represent actual human/system actions.

**Scope**: This ticket covers FACTS only. Traits, Topics, and People may get similar treatment later, but "validated" has different semantics for those types.

**Cross-type matching**: Step 2 now receives ALL human data to prevent duplicates across types (e.g., "Birthday" as both a Fact and Topic). On type mismatch, we queue Ei_Validation to notify the user rather than silently creating duplicates.

**Files to modify**:
- `src/core/types.ts` - Schema changes
- `src/prompts/human/types.ts` - Prompt data types
- `src/prompts/human/fact-scan.ts` - Remove confidence
- `src/prompts/human/item-match.ts` - Complete rewrite
- `src/core/orchestrators/human-extraction.ts` - Flow changes
- `src/core/handlers/index.ts` - Handler updates
- `src/prompts/ei/` - Locked fact reminder
- `CONTRACTS.md` - Schema documentation
