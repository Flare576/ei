# 0002: Core Types & Enums

**Status**: DONE
**Depends on**: None

## Summary

Create the core TypeScript types and enums as defined in CONTRACTS.md. This is the foundation that all other V1 code will import.

## Acceptance Criteria

- [x] Create `src/core/types.ts` with all entity types from CONTRACTS.md
- [x] All enums defined: `ContextStatus`, `LLMRequestType`, `LLMPriority`, `LLMNextStep`
- [x] All interfaces defined: `HumanEntity`, `PersonaEntity`, `DataItemBase`, `Fact`, `Trait`, `Topic`, `Person`, `Message`
- [x] All supporting types: `HumanSettings`, `Checkpoint`, `LLMRequest`, `LLMResponse`, `ChatMessage`
- [x] Export everything from `src/core/index.ts`
- [x] Types compile without errors

## Implementation Notes

Reference CONTRACTS.md sections:
- "Entity Types" for all entity interfaces
- "LLM Types" for request/response types
- "Ei_Interface" for event handler types
- "Processor API" for supporting types like `PersonaSummary`, `MessageQueryOptions`, `QueueStatus`

Do NOT copy from V0's `types.ts`—it uses different field names (`level_current` vs `exposure_current`) and is missing new fields (`id` on DataItemBase, `context_status` on Message, etc.).

## File Structure

```
src/
└── core/
    ├── types.ts    # All type definitions
    └── index.ts    # Re-exports
```
