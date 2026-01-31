import { test, expect } from "./fixtures.js";

test.describe("Basic Chat Flow", () => {
  test.beforeEach(async ({ page, mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("user can send message and receive response", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Hello! Nice to meet you. I am Ei, your companion.",
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, mockServerUrl);

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

  test("Ei welcome message appears on first load", async ({ page, mockServerUrl }) => {
    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, mockServerUrl);

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(
      page.locator("text=Hello! I'm Ei, your personal companion")
    ).toBeVisible({ timeout: 10000 });
  });

  test("sending message triggers trait extraction", async ({ page, mockServer, mockServerUrl }) => {
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
    }, mockServerUrl);

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
