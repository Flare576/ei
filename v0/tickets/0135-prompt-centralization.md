# 0135: Prompt Centralization

**Status**: DONE

## Problem

Prompts are scattered across multiple files:

| File | Lines | Contents |
|------|-------|----------|
| `src/prompts.ts` | ~610 | Response prompts, verification prompts, section builders |
| `src/extraction.ts` | ~970 | Fast-scan prompts, detail update prompts |
| `src/persona-creator.ts` | ~180 | Persona generation, description generation |

This makes prompts hard to:
- Find when debugging
- Update consistently
- Test independently
- Share patterns between similar prompts

## Solution

Create `src/prompts/` folder with organized structure:

```
src/prompts/
├── index.ts              # Re-exports all prompt builders
│
├── response/             # Response generation prompts
│   ├── index.ts          # Re-exports response prompts
│   ├── persona.ts        # Regular persona system prompt builder
│   ├── ei.ts             # Ei-specific system prompt builder
│   └── sections.ts       # Shared section builders (traits, topics, etc.)
│
├── extraction/           # Three-step extraction prompts
│   ├── index.ts          # Re-exports extraction prompts
│   ├── step1/            # Blind scan prompts
│   │   ├── facts.ts
│   │   ├── traits.ts
│   │   ├── topics.ts
│   │   └── people.ts
│   ├── step2/
│   │   └── match.ts      # Generic matching prompt
│   ├── step3/
│   │   └── update.ts     # Update/create prompt
│   └── field-mapping.ts  # level_* ↔ exposure_* mapping
│
├── persona/              # Persona-specific extraction
│   ├── index.ts
│   ├── traits.ts         # Behavior change detection (3-tier)
│   └── topics.ts         # Topic exploration
│
├── generation/           # Creation prompts
│   ├── index.ts
│   └── persona.ts        # New persona generation
│
├── verification/         # Data verification prompts
│   ├── index.ts
│   └── response-parser.ts # Parse verification responses
│
└── templates/            # Human-facing templates
    └── persona-builder.md # Guided persona creation template
```

## Implementation

### Phase 1: Create Folder Structure

```bash
mkdir -p src/prompts/{response,extraction/{step1,step2,step3},persona,generation,verification,templates}
```

### Phase 2: Move Response Prompts

From `src/prompts.ts`, extract:

**`src/prompts/response/sections.ts`**:
- `buildIdentitySection()`
- `buildGuidelinesSection()`
- `buildTraitsSection()`
- `buildTopicsSection()`
- `buildHumanSection()`
- `buildPrioritiesSection()`
- `buildAssociatesSection()`
- `filterByVisibility()` (and related types)
- `getVisiblePersonas()`

**`src/prompts/response/persona.ts`**:
- `buildResponseSystemPrompt()` (non-Ei version)
- `buildResponseUserPrompt()` (will be simplified in 0133)

**`src/prompts/response/ei.ts`**:
- `EI_IDENTITY` constant
- `EI_GUIDELINES` constant
- `EI_DESCRIPTIONS` constant
- `buildEiContextSection()`
- `buildEiSystemSection()`
- `buildEiSystemPrompt()`

### Phase 3: Move Extraction Prompts

From `src/extraction.ts`, extract:

**`src/prompts/extraction/legacy/`** (keep for migration):
- `buildFastScanSystemPrompt()`
- `buildFastScanUserPrompt()`
- `buildFactDetailPrompt()`
- `buildTraitDetailPrompt()`
- `buildTopicDetailPrompt()`
- `buildPersonDetailPrompt()`
- `buildDetailPromptByType()`

**New files** (created as part of 0134):
- `src/prompts/extraction/step1/*.ts`
- `src/prompts/extraction/step2/match.ts`
- `src/prompts/extraction/step3/update.ts`

### Phase 4: Move Generation Prompts

From `src/persona-creator.ts`, extract:

**`src/prompts/generation/persona.ts`**:
- `SEED_TRAIT_IDENTITY` constant
- `SEED_TRAIT_GROWTH` constant
- Persona generation system prompt (inline string → exported function)
- `generatePersonaDescriptions()` prompt builder

### Phase 5: Move Verification Prompts

From `src/prompts.ts`, extract:

**`src/prompts/verification/response-parser.ts`**:
- `buildVerificationResponsePrompt()`

### Phase 6: Create Index Files

Each subfolder gets an `index.ts` that re-exports:

```typescript
// src/prompts/response/index.ts
export * from "./sections.js";
export * from "./persona.js";
export * from "./ei.js";
```

Root index re-exports everything:

```typescript
// src/prompts/index.ts
export * from "./response/index.js";
export * from "./extraction/index.js";
export * from "./persona/index.js";
export * from "./generation/index.js";
export * from "./verification/index.js";

// Types that consumers need
export type { FilteredHumanData, PersonaIdentity, VisiblePersona } from "./response/sections.js";
```

### Phase 7: Update Imports

Update all files that import from old locations:

```typescript
// Before
import { buildResponseSystemPrompt } from "./prompts.js";

// After
import { buildResponseSystemPrompt } from "./prompts/index.js";
// OR more specific
import { buildResponseSystemPrompt } from "./prompts/response/persona.js";
```

### Phase 8: Add Persona Builder Template

Create `src/prompts/templates/persona-builder.md`:

```markdown
# Quick Generation

Tell me about this persona; the more detail you provide initially, the quicker you'll be having the conversations you're hoping for!

# Potential Details

Use these sections, or create your own, to help me build the Persona you're hoping for!

## Core Traits

Is this persona friendly? Gruff? Are they an expert in something?

## Personification

Do they have a gender identity? An age? A physical appearance?

## Topics

Are there certain things you feel this persona would be interested in? Things they'd avoid talking about?
```

Load this template in persona creation flow when user says "y" to create.

## Acceptance Criteria

- [x] Create `src/prompts/` folder structure
- [x] Move response prompts to `src/prompts/response/`
- [x] Move extraction prompts to `src/prompts/extraction/` (already done in 0134, refactored to use fragment+HEREDOC pattern)
- [x] Move generation prompts to `src/prompts/generation/`
- [x] Move verification prompts to `src/prompts/verification/`
- [x] Create index files for re-exports
- [x] Update all import statements
- [x] Add persona builder template
- [x] Delete empty old files (or leave as re-export shims) - used re-export shim for backward compatibility
- [x] All tests pass (build passes)
- [x] App runs correctly

## Migration Notes

### Backward Compatibility

Option A: **Delete old files** (clean but breaking)
- Remove `src/prompts.ts`, move all code
- Update all imports at once

Option B: **Re-export shim** (safer, gradual)
- Keep `src/prompts.ts` as re-export:
```typescript
// src/prompts.ts (shim for backward compatibility)
export * from "./prompts/index.js";
```
- Gradually update imports, delete shim when done

**Recommendation**: Option B - safer migration.

### Type Exports

Ensure these types remain accessible:
- `FilteredHumanData`
- `PersonaIdentity`
- `VisiblePersona`

## Files Changed

| Action | File |
|--------|------|
| Create | `src/prompts/**/*.ts` (new folder structure) |
| Modify | `src/prompts.ts` → re-export shim |
| Modify | `src/extraction.ts` → move prompt builders out |
| Modify | `src/persona-creator.ts` → move prompt builders out |
| Modify | `src/processor.ts` → update imports |
| Modify | `src/llm-queue.ts` → update imports |
| Create | `src/prompts/templates/persona-builder.md` |

## Dependencies

None - can be done independently. However, doing this first makes 0133, 0134, 0136, 0137 cleaner.

## Testing

1. **Build passes**: `npm run build`
2. **App runs**: `npm start`
3. **Manual test**: Have a conversation, verify responses work
4. **Manual test**: Create new persona, verify generation works

## Notes

- This is mostly mechanical refactoring
- No logic changes, just organization
- Makes future prompt work much easier
- Test prompts in `tests/model/prompts/` remain separate (they're test fixtures, not production code)
