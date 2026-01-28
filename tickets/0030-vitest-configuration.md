# 0030: Vitest Configuration

**Status**: DONE
**Depends on**: None
**Epic**: E004 - Testing Infrastructure

## Summary

Set up Vitest for unit testing. Vitest is Vite-native, fast, and has excellent TypeScript support. This establishes the foundation for all unit tests.

## Acceptance Criteria

- [ ] Install vitest and related dependencies
- [ ] Create `vitest.config.ts` with proper TypeScript support
- [ ] Configure test file patterns (`**/*.test.ts`)
- [ ] Configure coverage reporting
- [ ] Add `npm run test` script
- [ ] Add `npm run test:watch` script
- [ ] Add `npm run test:coverage` script
- [ ] Create first smoke test to verify setup works
- [ ] Tests can import from `src/` with proper path resolution

## Technical Notes

### Installation

```bash
npm install -D vitest @vitest/coverage-v8
```

### Config File

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### Directory Structure

```
tests/
├── unit/
│   ├── core/
│   │   ├── state-manager.test.ts
│   │   ├── queue-processor.test.ts
│   │   └── processor.test.ts
│   ├── prompts/
│   │   └── response.test.ts
│   └── storage/
│       └── local.test.ts
├── e2e/
│   └── (Playwright tests)
└── helpers/
    └── (Shared test utilities)
```

### Smoke Test

`tests/unit/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Vitest Setup', () => {
  it('should run tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('should import from src', async () => {
    const { ContextStatus } = await import('../../src/core/types.js');
    expect(ContextStatus.Default).toBe('default');
  });
});
```

### V0 Reference

V0 uses Vitest already — check `v0/vitest.config.ts` for patterns.

## Out of Scope

- E2E/Playwright setup (0031)
- Actual unit tests (0032-0034)
- CI/CD integration
