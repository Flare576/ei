# 0016: First E2E Test

**Status**: DONE
**Depends on**: 0012, 0015
**Epic**: E002 - MVP: Basic Chat

## Summary

Create the first end-to-end test that validates the complete message flow: user sends message → LLM processes → response appears. Uses the mock LLM server for deterministic testing. This proves the system works and establishes the E2E testing pattern.

## Acceptance Criteria

- [x] Create `tests/e2e/basic-flow.spec.ts` (or similar)
- [x] Test starts mock LLM server before test
- [x] Test configures app to use mock server URL
- [x] Test loads the app in browser (Playwright)
- [x] Test sends a message via the input box
- [x] Test verifies human message appears in chat
- [x] Test verifies AI response appears in chat (from mock server)
- [x] Test cleans up mock server after test
- [x] Test passes consistently (no flakiness)

## Technical Notes

### Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { MockLLMServerImpl } from './framework/mock-server';

test.describe('Basic Chat Flow', () => {
  let mockServer: MockLLMServerImpl;

  test.beforeAll(async () => {
    mockServer = new MockLLMServerImpl();
    await mockServer.start(3001, { enableLogging: false });
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async () => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test('user can send message and receive response', async ({ page }) => {
    // Configure mock response
    mockServer.setResponseForType('response', {
      type: 'fixed',
      content: 'Hello! I am Ei, nice to meet you.',
      statusCode: 200,
    });

    // Load app (needs env var or config to point to mock server)
    await page.goto('http://localhost:5173');

    // Wait for app to initialize
    await expect(page.locator('.persona-pill.active')).toContainText('Ei');

    // Send message
    await page.locator('.chat-input').fill('Hello Ei!');
    await page.locator('.chat-input').press('Enter');

    // Verify human message appears
    await expect(page.locator('.message-human').last()).toContainText('Hello Ei!');

    // Verify AI response appears (may need to wait for LLM call)
    await expect(page.locator('.message-system').last()).toContainText('Hello! I am Ei');

    // Verify mock server received the request
    const requests = mockServer.getRequestHistory();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].body.messages).toBeDefined();
  });
});
```

### Environment Configuration

Need a way to tell the app to use mock server URL instead of real LLM:

Option 1: Environment variable
```
EI_LLM_BASE_URL=http://localhost:3001/v1
```

Option 2: Test-specific config file

Option 3: URL parameter (`?llm_url=...`)

Recommend Option 1 — already supported by `llm-client.ts`.

### Playwright Setup

This ticket assumes Playwright is configured. If not, do minimal setup:
```bash
npm install -D @playwright/test
npx playwright install
```

Create `playwright.config.ts`:
```typescript
export default {
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
};
```

### Timing Considerations

- Mock server responds instantly by default
- May need small waits for React re-renders
- Use Playwright's auto-waiting (`expect(...).toContainText()` waits)

### From V0 Reference

See `v0/tests/e2e/scenarios/basic-flow.e2e.test.ts` for patterns, but note V0 used blessed TUI which required different interaction patterns.

## Out of Scope

- Multiple E2E scenarios (0035, 0036, 0037)
- Full Playwright configuration (0031)
- CI/CD integration
- Visual regression testing
