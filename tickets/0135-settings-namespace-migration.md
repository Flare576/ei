# 0135: Settings Namespace Migration

**Status**: PENDING
**Depends on**: None

## Summary

Migrate legacy root-level HumanEntity settings to the namespaced `settings.*` structure for consistency with the new OpenCode pattern (`settings.opencode.*`).

## Acceptance Criteria

### Migration Targets
- [ ] `ceremony_config` → `settings.ceremony`
- [ ] `last_seeded_fact` → `settings.seed.last_fact`
- [ ] `last_seeded_trait` → `settings.seed.last_trait`
- [ ] `last_seeded_topic` → `settings.seed.last_topic`
- [ ] `last_seeded_person` → `settings.seed.last_person`

### Implementation
- [ ] Update `HumanEntity` interface in types.ts
- [ ] Update `createDefaultHumanEntity()` in state/human.ts
- [ ] Update all references in Processor
- [ ] Update Ceremony orchestrator references
- [ ] Add migration logic in StateManager.load() to auto-upgrade old saves

### Backward Compatibility
- [ ] Old saves with root-level fields still load correctly
- [ ] Migration is automatic and silent (no user action needed)

## Notes

Pattern established by 0103: `settings.opencode.{integration, polling_interval_ms, last_sync}`

**Future consideration**: Personas should have GUIDs instead of relying on names as identifiers. This became apparent when OpenCode data had both `sisyphus` and `Sisyphus` as separate agents (case-sensitivity bug). GUIDs would prevent similar issues and enable safe renames. Consider adding to this ticket or creating a separate one.

New structure:
```typescript
settings: {
  opencode?: OpenCodeSettings;
  ceremony?: CeremonyConfig;
  seed?: {
    last_fact?: string;
    last_trait?: string;
    last_topic?: string;
    last_person?: string;
  };
  // existing flat fields stay:
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
  // ...etc
}
```
