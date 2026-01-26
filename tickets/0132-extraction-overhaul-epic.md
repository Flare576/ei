# 0132: Extraction System Overhaul (Epic)

**Status**: DONE

## Overview

Complete overhaul of the extraction system based on lessons learned from LLM prompt benchmarking. This epic addresses fundamental issues with how we extract and process conversational data.

**Key Insight**: The current extraction prompts are too complex and give models too much context to hallucinate with. By splitting into focused, single-purpose prompts and removing "known items" from initial scans, we get more accurate and consistent results.

## Problems Being Solved

1. **Model confusion**: Showing 20+ known topics biases the model toward "finding" them even when not present
2. **Naming inconsistency**: Model returns "Name" vs "Legal Name" vs "Full Name" unpredictably
3. **mentioned vs new_items confusion**: Model puts most findings in wrong bucket
4. **Prompt sprawl**: Prompts scattered across 3 files, hard to maintain
5. **Suboptimal API usage**: Response generation dumps history as text blobs instead of using native message format
6. **Field semantics**: `level_current` and `level_ideal` are abstract; models benefit from clearer naming

## Architecture Changes

### 1. Native Message Format for Responses (0133)

Switch response generation from text-blob history to native OpenAI message format:

```typescript
// Before (current)
messages: [
  { role: "system", content: megaPrompt },
  { role: "user", content: "[human]: Hi\n[ei]: Hello\n..." },
]

// After
messages: [
  { role: "system", content: personaPrompt },
  { role: "user", content: "Hi" },
  { role: "assistant", content: "Hello!" },
  { role: "user", content: "Current message" },
]
```

**Note**: Extraction prompts stay as text blobs (analytical task, not conversation continuation).

### 2. Three-Step Extraction Flow (0134)

Replace current two-phase (fast-scan + detail) with three-step:

```
Step 1: "What DPs exist in this text?" (blind scan, no prior data)
    ↓
Step 2: "Does this DP match something we know?" (match against known list)
    ↓
Step 3: "Update/create this DP" (focused extraction per item)
```

**Key difference**: Step 1 runs without showing existing data, preventing bias.

### 3. Prompt Centralization (0135)

Create `src/prompts/` folder structure:

```
src/prompts/
├── index.ts              # Re-exports all prompt builders
├── response/             # Response generation prompts
│   ├── persona.ts        # Regular persona prompts
│   └── ei.ts             # Ei-specific prompts
├── extraction/           # Three-step extraction prompts
│   ├── step1/            # Blind scan prompts
│   ├── step2/            # Match prompts
│   └── step3/            # Update prompts
├── persona/              # Persona-specific extraction
│   ├── traits.ts         # Behavior change detection
│   └── topics.ts         # Topic exploration
├── generation/           # Creation prompts
│   └── persona.ts        # New persona generation
└── templates/            # Human-facing templates
    └── persona-builder.md
```

### 4. Field Name Mapping (Part of 0134)

Map code field names to prompt-friendly names:

| Code (types.ts) | Prompt | Rationale |
|-----------------|--------|-----------|
| `level_current` | `exposure_current` | How recently/much exposed to this |
| `level_ideal` | `exposure_desired` | How much they want to discuss |

Mapping happens at prompt generation and response parsing boundaries.

### 5. Persona Extraction Updates (0136, 0137)

Use existing extraction pipeline with new prompts:

- **Persona Traits (0136)**: Absorbs 0128, uses three-tier behavior change detection
- **Persona Topics (0137)**: Adds generative exploration during extraction

### 6. Persona Builder Template (0138)

Guided template for persona creation that helps users provide structured input.

## Sub-Tickets

| Ticket | Title | Dependencies | Priority |
|--------|-------|--------------|----------|
| 0133 | Native Message Format for Responses | None | High |
| 0134 | Three-Step Human Extraction Flow | 0133 | High |
| 0135 | Prompt Centralization | None | Medium |
| 0136 | Persona Trait Behavior Detection | 0134, 0135 | High |
| 0137 | Persona Topic Exploration | 0134, 0135 | Medium |
| 0138 | Persona Builder Template | 0135 | Low |

## Implementation Order

1. **0135 - Prompt Centralization** (can start immediately, enables cleaner work on others)
2. **0133 - Native Message Format** (foundation for response quality)
3. **0134 - Three-Step Extraction** (core extraction overhaul)
4. **0136 - Persona Traits** (absorbs 0128, depends on new prompt structure)
5. **0137 - Persona Topics** (uses new extraction, adds exploration)
6. **0138 - Persona Builder** (nice-to-have, low priority)

## Success Criteria

- [x] All prompts live in `src/prompts/` folder
- [x] Response generation uses native message format
- [x] Human extraction uses 3-step flow
- [x] Persona traits only update on explicit behavior requests
- [x] Persona topics include exploration/generation
- [x] Field naming is consistent and semantic
- [x] Benchmark tests show improved accuracy (fewer hallucinations)

## Out of Scope

- Evaluation framework improvements (POC sufficient for now)
- Automated prompt regression testing
- UI changes

## Related Tickets

- 0128: Persona Trait Change Detection (absorbed into 0136)
- 0127: Persona Facts/People as Topics (future, not part of this epic)
- 0107: Entity Data Architecture (completed, this epic builds on it)

## Notes

- Test prompts are in `tests/model/prompts/` - these are the source of truth for new prompt content
- Current extraction flow is in `src/extraction.ts` (~970 lines)
- Response prompts are in `src/prompts.ts` (~610 lines)
- Persona creation is in `src/persona-creator.ts` (~180 lines)

## Completion Summary

Epic completed successfully with all 6 sub-tickets done:

1. **0133 - Native Message Format**: Responses now use proper message arrays instead of text blobs
2. **0134 - Three-Step Extraction**: Blind scan → match → update flow eliminates hallucinations
3. **0135 - Prompt Centralization**: All prompts organized in `src/prompts/` with clear structure
4. **0136 - Persona Traits**: Three-tier behavior change detection prevents spurious updates
5. **0137 - Persona Topics**: Generative exploration discovers natural topic extensions
6. **0138 - Persona Builder**: Rich guided template for persona creation

**Impact**:
- Extraction accuracy significantly improved (verified through benchmarking)
- Prompt maintenance centralized and organized
- Field naming semantically clear (`exposure_current`/`exposure_desired`)
- System more maintainable and testable
