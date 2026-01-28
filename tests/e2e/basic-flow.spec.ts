import { test, expect } from "@playwright/test";
import { MockLLMServerImpl } from "./framework/mock-server.js";

const MOCK_SERVER_URL = "http://localhost:3001/v1";

test.describe.configure({ mode: "serial" });

test.describe("Basic Chat Flow", () => {
  let mockServer: MockLLMServerImpl;

  test.beforeAll(async () => {
    mockServer = new MockLLMServerImpl();
    await mockServer.start(3001, { enableLogging: false, responses: {} });
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async ({ page }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    // Clear storage before each test so each test starts fresh
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("user can send message and receive response", async ({ page }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Hello! Nice to meet you. I am Ei, your companion.",
      statusCode: 200,
    });

    // Set mock server URL before page loads
    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");

    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator("li").first().click();

    const input = page.locator('input[type="text"]');
    await input.fill("Hello Ei!");
    await input.press("Enter");

    await expect(page.locator("text=Hello Ei!")).toBeVisible({ timeout: 5000 });

    await expect(page.locator("text=Hello! Nice to meet you")).toBeVisible({
      timeout: 15000,
    });

    const requests = mockServer.getRequestHistory();
    expect(requests.length).toBeGreaterThan(0);
  });

  test("Ei welcome message appears on first load", async ({ page }) => {
    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");

    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator("li").first().click();

    await expect(
      page.locator("text=Hello! I'm Ei, your personal companion")
    ).toBeVisible({ timeout: 10000 });
  });
});
