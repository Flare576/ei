import { test as base, expect } from "@playwright/test";
import { MockLLMServerImpl } from "./framework/mock-server.js";

const MOCK_SERVER_PORT = 3001;
const MOCK_SERVER_URL = `http://localhost:${MOCK_SERVER_PORT}/v1`;

export interface TestFixtures {
  mockServer: MockLLMServerImpl;
  mockServerUrl: string;
}

/**
 * Extended Playwright test with mock LLM server fixture.
 * 
 * This provides a per-test mock server instance that:
 * - Starts before each test
 * - Stops after each test  
 * - Has request history cleared between tests
 * 
 * Usage:
 * ```typescript
 * import { test, expect, MOCK_SERVER_URL } from './fixtures';
 * 
 * test('my test', async ({ page, mockServer }) => {
 *   mockServer.setResponseForType('response', { type: 'fixed', content: 'Hello!' });
 *   await page.goto('/');
 *   // ... test code
 * });
 * ```
 */
export const test = base.extend<TestFixtures>({
  mockServer: async ({}, use) => {
    const server = new MockLLMServerImpl();
    await server.start(MOCK_SERVER_PORT, { enableLogging: false, responses: {} });
    await use(server);
    await server.stop();
  },
  mockServerUrl: async ({}, use) => {
    await use(MOCK_SERVER_URL);
  },
});

export { expect, MOCK_SERVER_URL };

/**
 * Helper to set up the mock server URL in localStorage before page load.
 * Call this in test.beforeEach or at the start of each test.
 */
export async function setupMockServerUrl(page: import("@playwright/test").Page) {
  await page.addInitScript((url) => {
    localStorage.setItem("EI_LLM_BASE_URL", url);
  }, MOCK_SERVER_URL);
}

/**
 * Helper to wait for Ei persona to be visible and click it.
 */
export async function selectEiPersona(page: import("@playwright/test").Page) {
  await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
  await page.locator(".ei-persona-pill").first().click();
}

/**
 * Helper to send a message in the chat.
 */
export async function sendMessage(page: import("@playwright/test").Page, text: string) {
  const input = page.locator("textarea");
  await input.fill(text);
  await input.press("Enter");
}

/**
 * Helper to wait for a system message containing text.
 */
export async function waitForSystemMessage(
  page: import("@playwright/test").Page, 
  text: string,
  timeout = 15000
) {
  await expect(page.locator(`.message-system, [data-role="system"]`).filter({ hasText: text }))
    .toBeVisible({ timeout });
}

/**
 * Helper to clear localStorage before test (for fresh state).
 */
export async function clearStorage(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.clear();
  });
}
