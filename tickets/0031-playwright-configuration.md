# 0031: Playwright Configuration

**Status**: DONE
**Depends on**: 0012
**Epic**: E004 - Testing Infrastructure

## Summary

Set up Playwright for end-to-end testing. Configure it to work with Vite dev server and the mock LLM server. This enables browser-based testing of the full application flow.

## Acceptance Criteria

- [ ] Install Playwright and browsers
- [ ] Create `playwright.config.ts`
- [ ] Configure to start Vite dev server automatically
- [ ] Configure to start mock LLM server for tests
- [ ] Add `npm run test:e2e` script
- [ ] Add `npm run test:e2e:ui` script (Playwright UI mode)
- [ ] Create test helper for mock server management
- [ ] First smoke test opens app and verifies it loads

## Technical Notes

### Installation

```bash
npm install -D @playwright/test
npx playwright install chromium  # Just Chromium for dev speed
```

### Config File

`playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Mock Server Integration

Option 1: Global setup/teardown
```typescript
// playwright.config.ts
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
});

// global-setup.ts
import { MockLLMServerImpl } from './framework/mock-server';
let server: MockLLMServerImpl;

export default async function globalSetup() {
  server = new MockLLMServerImpl();
  await server.start(3001, { enableLogging: false });
  process.env.EI_LLM_BASE_URL = 'http://localhost:3001/v1';
}
```

Option 2: Per-test fixture (more flexible)
```typescript
// tests/e2e/fixtures.ts
import { test as base } from '@playwright/test';
import { MockLLMServerImpl } from './framework/mock-server';

export const test = base.extend<{ mockServer: MockLLMServerImpl }>({
  mockServer: async ({}, use) => {
    const server = new MockLLMServerImpl();
    await server.start(3001, { enableLogging: false });
    await use(server);
    await server.stop();
  },
});
```

Recommend Option 2 for test isolation.

### Package.json Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

### Environment Variable

Tests need to tell the app to use mock server:
```
EI_LLM_BASE_URL=http://localhost:3001/v1
```

This can be set in `playwright.config.ts` or via `.env.test`.

### Smoke Test

`tests/e2e/smoke.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/EI/);
});
```

## Out of Scope

- Actual E2E tests (0035-0037)
- Visual regression testing
- Mobile viewport testing
- Multiple browser testing (Chrome-only for now)
