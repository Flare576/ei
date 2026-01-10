# 0007: Configurable Storage Location

**Status**: VALIDATED

## Summary

Allow EI's data directory to be configured via environment variable for flexible deployment and cross-device sync.

## Problem

EI currently stores all data (personas, concept maps, history) in a hardcoded location. Users may want to:
- Store data in a private git repo for cross-device sync
- Keep data on encrypted volumes
- Separate work/personal EI instances

## Proposed Solution

Add `EI_DATA_PATH` environment variable that overrides the default storage location.

### Implementation

```typescript
// storage.ts
const DEFAULT_DATA_PATH = path.join(os.homedir(), ".ei");
const DATA_PATH = process.env.EI_DATA_PATH || DEFAULT_DATA_PATH;

// All storage operations use DATA_PATH instead of hardcoded paths
```

### Directory Structure

Wherever `EI_DATA_PATH` points, maintain the existing structure:
```
$EI_DATA_PATH/
├── personas/
│   ├── ei/
│   │   ├── system.jsonc
│   │   └── history.jsonc
│   ├── mike/
│   └── ...
└── human.jsonc
```

### Validation

On startup:
- Check if `EI_DATA_PATH` exists
- If not, create it with proper structure
- Warn if path looks suspicious (e.g., inside a public repo)

## Acceptance Criteria

- [ ] `EI_DATA_PATH` env var controls storage location
- [ ] Default behavior unchanged when env var not set
- [ ] Directory auto-created if missing
- [ ] Startup message shows active data path
- [ ] Works with relative and absolute paths

## Value Statement

Users can sync EI data across devices via private git repos or other mechanisms without modifying code.

## Dependencies

None.

## Effort Estimate

Small: ~1 hour
