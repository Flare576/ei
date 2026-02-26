import { test as base, expect, type TestInfo } from "@playwright/test";
import { MockLLMServerImpl } from "./framework/mock-server.js";

/** Base port - each worker gets BASE + parallelIndex */
const BASE_PORT = 3001;

export interface TestFixtures {
  mockServer: MockLLMServerImpl;
  mockServerUrl: string;
}

/** Get the port for a given parallel worker */
export function getPortForWorker(testInfo: TestInfo): number {
  return BASE_PORT + testInfo.parallelIndex;
}

/** Get the mock server URL for a given parallel worker */
export function getUrlForWorker(testInfo: TestInfo): string {
  return `http://localhost:${getPortForWorker(testInfo)}/v1`;
}

/**
 * Extended Playwright test with mock LLM server fixture.
 * 
 * This provides a per-worker mock server instance that:
 * - Starts on a unique port per parallel worker (3001, 3002, 3003...)
 * - Starts before each test
 * - Stops after each test  
 * - Has request history cleared between tests
 * 
 * Usage:
 * ```typescript
 * import { test, expect } from './fixtures';
 * 
 * test('my test', async ({ page, mockServer, mockServerUrl }) => {
 *   mockServer.setResponseForType('response', { type: 'fixed', content: 'Hello!' });
 *   await page.addInitScript((url) => {
 *     localStorage.setItem("EI_LLM_BASE_URL", url);
 *   }, mockServerUrl);
 *   await page.goto('/');
 *   // ... test code
 * });
 * ```
 */
export const test = base.extend<TestFixtures>({
  mockServer: async ({}, use, testInfo) => {
    const port = getPortForWorker(testInfo);
    const server = new MockLLMServerImpl();
    await server.start(port, { enableLogging: false, responses: {} });
    await use(server);
    await server.stop();
  },
  mockServerUrl: async ({}, use, testInfo) => {
    await use(getUrlForWorker(testInfo));
  },
});

export { expect };

/**
 * Helper to set up the mock server URL in localStorage before page load.
 * @deprecated Use mockServerUrl fixture instead: `await page.addInitScript(..., mockServerUrl)`
 */
export async function setupMockServerUrl(page: import("@playwright/test").Page, mockServerUrl: string) {
  await page.addInitScript((url) => {
    localStorage.setItem("EI_LLM_BASE_URL", url);
  }, mockServerUrl);
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

const STATE_KEY = "ei_state";

const DEFAULT_WELCOME_MESSAGE = "Hello! I'm Ei, your personal companion. I'm here to chat, learn about you, and grow alongside you. What's on your mind today?";

export interface MinimalCheckpoint {
  version: number;
  timestamp: string;
  human: {
    entity: string;
    facts: never[];
    traits: never[];
    topics: never[];
    people: never[];
    quotes: never[];
    last_updated: string;
    last_activity: string;
    settings: {
      auto_save_interval_ms: number;
      default_model: string;
      accounts: Array<{
        id: string;
        name: string;
        type: string;
        url: string;
        api_key: string;
        default_model: string;
        enabled: boolean;
        created_at: string;
      }>;
    };
  };
  personas: {
    ei: {
      entity: {
        entity: string;
        id: string;
        display_name: string;
        aliases: string[];
        short_description: string;
        long_description: string;
        traits: never[];
        topics: never[];
        facts: never[];
        people: never[];
        is_paused: boolean;
        is_archived: boolean;
        last_updated: string;
        last_activity: string;
      };
      messages: Array<{ id: string; role: string; verbal_response: string; timestamp: string }>;
    };
  };
  queue: never[];
  settings: Record<string, never>;
}

export function createMinimalCheckpoint(
  mockServerUrl: string,
  messages: Array<{ role: string; verbal_response: string }> = [{ role: "assistant", verbal_response: DEFAULT_WELCOME_MESSAGE }]
): MinimalCheckpoint {
  const timestamp = new Date().toISOString();
  return {
    version: 1,
    timestamp,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: timestamp,
      last_activity: timestamp,
      settings: {
        auto_save_interval_ms: 5000,
        default_model: "Mock LLM:mock-model",
        accounts: [{
          id: "mock-llm-account",
          name: "Mock LLM",
          type: "llm",
          url: mockServerUrl,
          api_key: "",
          default_model: "mock-model",
          enabled: true,
          created_at: timestamp,
        }],
      },
    },
    personas: {
      ei: {
        entity: {
          entity: "system",
          id: "ei",
          display_name: "Ei",
          aliases: ["Ei"],
          short_description: "Your personal companion",
          long_description: "A friendly AI companion",
          traits: [],
          topics: [],
          facts: [],
          people: [],
          is_paused: false,
          is_archived: false,
          last_updated: timestamp,
          last_activity: timestamp,
        },
        messages: messages.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role,
          verbal_response: m.verbal_response,
          timestamp,
        })),
      },
    },
    queue: [],
    settings: {},
  };
}

/**
 * Seeds localStorage with state to bypass onboarding.
 * Call this before page.goto() to simulate a returning user.
 */
export async function seedCheckpoint(
  page: import("@playwright/test").Page,
  mockServerUrl: string,
  messages: Array<{ role: string; verbal_response: string }> = [{ role: "assistant", verbal_response: DEFAULT_WELCOME_MESSAGE }]
) {
  const state = createMinimalCheckpoint(mockServerUrl, messages);
  await page.addInitScript(
    ({ key, data }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STATE_KEY, data: state }
  );
}
