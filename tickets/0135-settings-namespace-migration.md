# 0135: Settings Namespace Migration

**Status**: PENDING
**Depends on**: None
**Blocked by**: None

## Summary

Migrate legacy root-level HumanEntity settings to the namespaced `settings.*` structure for consistency with the new OpenCode pattern (`settings.opencode.*`).

## Complete Settings Inventory

### ROOT-LEVEL FIELDS (Need Migration)

These are scattered at the HumanEntity root level and need to move under `settings.*`:

| Current Location | Target Location | Type |
|------------------|-----------------|------|
| `ceremony_config` | `settings.ceremony` | `CeremonyConfig` |
| `last_seeded_fact` | `settings.seed.last_fact` | `string` |
| `last_seeded_trait` | `settings.seed.last_trait` | `string` |
| `last_seeded_topic` | `settings.seed.last_topic` | `string` |
| `last_seeded_person` | `settings.seed.last_person` | `string` |

### ALREADY IN `settings.*` (No Migration Needed)

These are correctly namespaced:

```typescript
settings: {
  // Display preferences
  name_display?: string           // How Human's name appears
  name_color?: string             // Color for Human's name  
  time_mode?: "absolute" | "relative"  // Timestamp format

  // System behavior
  auto_save_interval_ms?: number  // Auto-save frequency (0146 may remove)
  default_model?: string          // Global default LLM model
  queue_paused?: boolean          // Queue processing paused
  skip_quote_delete_confirm?: boolean  // Skip confirmation dialogs

  // Provider accounts
  accounts?: ProviderAccount[]    // LLM provider credentials

  // Cloud sync
  sync?: SyncCredentials          // Remote sync configuration

  // OpenCode integration
  opencode?: {
    integration?: boolean         // Feature enabled
    polling_interval_ms?: number  // How often to check for new sessions
    last_sync?: number           // Unix timestamp of last sync
    extraction_point?: number    // Message timestamp watermark
  }
}
```

### HARDCODED VALUES (Not Migrated, But Documented)

These are constants in code, not user settings:

| Location | Value | Purpose |
|----------|-------|---------|
| `processor.ts:252` | `1800000` (30min) | Heartbeat delay |
| `processor.ts:88` | `60000` (60s) | Auto-save interval default |
| `processor.ts:84` | `100` (100ms) | Main loop interval |
| `queue-processor.ts` | `30000` (30s) | Queue processing timeout |

## Acceptance Criteria

### Phase 1: Type Updates
- [ ] Add `seed` namespace to `HumanSettings` interface in types.ts:
  ```typescript
  seed?: {
    last_fact?: string
    last_trait?: string
    last_topic?: string
    last_person?: string
  }
  ```
- [ ] Move `ceremony_config` type from `HumanEntity` root to `settings.ceremony`
- [ ] Mark root-level fields as deprecated with `@deprecated` JSDoc

### Phase 2: Code References
- [ ] Update `createDefaultHumanEntity()` in state/human.ts
- [ ] Update Processor ceremony references (`human.ceremony_config` → `human.settings?.ceremony`)
- [ ] Update Ceremony orchestrator references
- [ ] Update seeding logic (facts/traits/topics/people seed timestamps)
- [ ] Grep for all `last_seeded_*` references and update

### Phase 3: Migration Logic
- [ ] Add migration in `StateManager.load()`:
  ```typescript
  // Auto-upgrade old saves
  if (human.ceremony_config && !human.settings?.ceremony) {
    human.settings = {
      ...human.settings,
      ceremony: human.ceremony_config
    }
    delete human.ceremony_config
  }
  // Similar for last_seeded_* fields
  ```
- [ ] Migration runs silently on load (no user action)
- [ ] Old saves with root-level fields load correctly

### Phase 4: Cleanup
- [ ] After migration period (30 days?), remove deprecated root-level fields
- [ ] Update any documentation referencing old field locations

## Code Locations to Update

### Types (src/core/types.ts)
- Line 187-198: `HumanSettings` interface - add `seed` and `ceremony`
- Line 200-206: `CeremonyConfig` interface - no change, just move reference
- Line 208-223: `HumanEntity` interface - deprecate root fields

### State Creation (src/core/state/human.ts)
- `createDefaultHumanEntity()` - update defaults location

### Processor (src/core/processor.ts)
- Line 260: `human.ceremony_config` reference
- Any `last_seeded_*` references

### Ceremony Orchestrator (src/core/orchestrators/ceremony.ts)
- All `ceremony_config` references

## New Structure

```typescript
interface HumanSettings {
  // Existing flat fields stay:
  auto_save_interval_ms?: number
  default_model?: string
  queue_paused?: boolean
  skip_quote_delete_confirm?: boolean
  name_display?: string
  name_color?: string
  time_mode?: "absolute" | "relative"
  accounts?: ProviderAccount[]
  sync?: SyncCredentials
  
  // Nested namespaces:
  opencode?: OpenCodeSettings
  ceremony?: CeremonyConfig       // NEW: moved from root
  seed?: {                        // NEW: moved from root
    last_fact?: string
    last_trait?: string
    last_topic?: string
    last_person?: string
  }
}

interface HumanEntity {
  // ... other fields ...
  settings?: HumanSettings
  
  // DEPRECATED - remove after migration period
  /** @deprecated Use settings.ceremony instead */
  ceremony_config?: CeremonyConfig
  /** @deprecated Use settings.seed.last_fact instead */
  last_seeded_fact?: string
  // ... etc
}
```

## Sequencing Notes

### Relation to Other Tickets
- **0129 (Settings Menu Redesign)**: UI assumes settings are in `settings.*` namespace. This ticket ensures data matches that expectation.
- **0146 (Write-Through Storage)**: May remove `auto_save_interval_ms`. Do 0146 first or coordinate.
- **0145 (SQLite Integration)**: No direct dependency, but both touch storage layer.

### Recommended Order
1. **0146** - Simplify storage (may remove `auto_save_interval_ms`)
2. **0135** - Migrate settings namespace (this ticket)
3. **0129** - Redesign settings UI (assumes clean namespace)
4. **0145** - SQLite integration (independent, can parallel with 0129)

## Notes

Pattern established by 0103: `settings.opencode.{integration, polling_interval_ms, last_sync}`

**Future consideration**: Personas should have GUIDs instead of relying on names as identifiers. This became apparent when OpenCode data had both `sisyphus` and `Sisyphus` as separate agents (case-sensitivity bug). GUIDs would prevent similar issues and enable safe renames. Consider adding to this ticket or creating a separate one.
