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

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    const input = page.locator("textarea");
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

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(
      page.locator("text=Hello! I'm Ei, your personal companion")
    ).toBeVisible({ timeout: 10000 });
  });

  test("user can create a new persona with LLM-generated traits", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A swashbuckling test pirate",
        long_description: "Arrr! This be a test pirate persona for automated testing. Loves treasure and testing.",
        traits: [
          { name: "Pirate Speech", description: "Talks like a pirate, using 'arrr' and nautical terms", sentiment: 0.7, strength: 0.8 }
        ],
        topics: [
          { name: "Treasure Hunting", description: "Passionate about finding buried treasure", sentiment: 0.9, exposure_current: 0.5, exposure_desired: 0.8 }
        ],
      }),
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("Captain Test");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A pirate who loves testing");
      }
    });

    await page.click("text=+ New");

    await expect(page.locator("text=Captain Test")).toBeVisible({ timeout: 15000 });

    await expect(page.locator("text=A swashbuckling test pirate")).toBeVisible({ timeout: 15000 });

    const requests = mockServer.getRequestHistory();
    const generationRequest = requests.find(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      const systemMsg = body?.messages?.find(m => m.role === "system");
      return systemMsg?.content?.toLowerCase().includes("create a new ai persona");
    });
    expect(generationRequest).toBeDefined();
  });

  test("sending message triggers trait extraction", async ({ page }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Ahoy! Nice to meet ye, matey!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: JSON.stringify([
        { name: "Pirate Speech", description: "Talks like a pirate", sentiment: 0.7, strength: 0.8 }
      ]),
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    const input = page.locator("textarea");
    await input.fill("Please talk like a pirate from now on!");
    await input.press("Enter");

    await expect(page.locator("text=Ahoy!")).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);

    const requests = mockServer.getRequestHistory();
    const traitRequest = requests.find(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      const systemMsg = body?.messages?.find(m => m.role === "system");
      return systemMsg?.content?.toLowerCase().includes("analyzing a conversation to detect explicit requests");
    });
    expect(traitRequest).toBeDefined();
  });
});
