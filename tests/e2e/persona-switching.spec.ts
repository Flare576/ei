import { test, expect } from "@playwright/test";
import { MockLLMServerImpl } from "./framework/mock-server.js";

const MOCK_SERVER_URL = "http://localhost:3002/v1";

test.describe.configure({ mode: "serial" });

test.describe("Persona Switching", () => {
  let mockServer: MockLLMServerImpl;

  test.beforeAll(async () => {
    mockServer = new MockLLMServerImpl();
    await mockServer.start(3002, { enableLogging: false, responses: {} });
  });

  test.afterAll(async () => {
    await mockServer.stop();
  });

  test.beforeEach(async ({ page }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("displays multiple personas in list after creating second persona", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona for E2E testing purposes.",
        traits: [
          { name: "Helpful", description: "Always ready to assist", sentiment: 0.8, strength: 0.9 }
        ],
        topics: [
          { name: "Testing", description: "Interested in software testing", sentiment: 0.7, exposure_current: 0.5, exposure_desired: 0.8 }
        ],
      }),
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");

    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot for automation");
      }
    });

    await page.click("text=+ Create Persona");

    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    const personaList = page.locator("ul li");
    await expect(personaList).toHaveCount(2, { timeout: 5000 });
    await expect(page.locator("li").filter({ hasText: "Ei" })).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "TestBot" })).toBeVisible();
  });

  test("clicking persona switches active state (visual indicator)", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona for E2E testing purposes.",
        traits: [],
        topics: [],
      }),
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot");
      }
    });
    await page.click("text=+ Create Persona");
    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    const eiPersona = page.locator("li").filter({ hasText: "Ei" });
    await eiPersona.click();

    await expect(eiPersona).toHaveCSS("background-color", "rgb(224, 224, 224)");

    const testBotPersona = page.locator("li").filter({ hasText: "TestBot" });
    await testBotPersona.click();

    await expect(testBotPersona).toHaveCSS("background-color", "rgb(224, 224, 224)");
    await expect(eiPersona).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("chat history changes when switching personas", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona.",
        traits: [],
        topics: [],
      }),
      statusCode: 200,
    });
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Hello from Ei! Nice to chat with you.",
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot");
      }
    });
    await page.click("text=+ Create Persona");
    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    await page.locator("li").filter({ hasText: "Ei" }).click();
    const input = page.locator('input[type="text"]');
    await input.fill("Hello Ei, this is a test message!");
    await input.press("Enter");

    await expect(page.locator("text=Hello Ei, this is a test message!")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Hello from Ei!")).toBeVisible({ timeout: 15000 });

    await page.locator("li").filter({ hasText: "TestBot" }).click();

    await page.waitForTimeout(500);

    await expect(page.locator("text=Hello Ei, this is a test message!")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Hello from Ei!")).not.toBeVisible();
  });

  test("sending message to non-Ei persona works correctly", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona.",
        traits: [],
        topics: [],
      }),
      statusCode: 200,
    });
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Hello! I am TestBot, ready to help!",
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot");
      }
    });
    await page.click("text=+ Create Persona");
    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    await page.locator("li").filter({ hasText: "TestBot" }).click();

    const input = page.locator('input[type="text"]');
    await input.fill("Hi TestBot!");
    await input.press("Enter");

    await expect(page.locator("text=Hi TestBot!")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Hello! I am TestBot")).toBeVisible({ timeout: 15000 });

    const requests = mockServer.getRequestHistory();
    expect(requests.length).toBeGreaterThan(0);
  });

  test("switching back shows previous history (Ei retains messages)", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona.",
        traits: [],
        topics: [],
      }),
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot");
      }
    });
    await page.click("text=+ Create Persona");
    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    await page.locator("li").filter({ hasText: "Ei" }).click();
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Ei response to first message!",
      statusCode: 200,
    });

    const input = page.locator('input[type="text"]');
    await input.fill("First message to Ei");
    await input.press("Enter");

    await expect(page.locator("text=First message to Ei")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Ei response to first message!")).toBeVisible({ timeout: 15000 });

    await page.locator("li").filter({ hasText: "TestBot" }).click();
    await page.waitForTimeout(500);

    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "TestBot response!",
      statusCode: 200,
    });

    await input.fill("Message to TestBot");
    await input.press("Enter");

    await expect(page.locator("text=Message to TestBot")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=TestBot response!")).toBeVisible({ timeout: 15000 });

    await expect(page.locator("text=First message to Ei")).not.toBeVisible();
    await expect(page.locator("text=Ei response to first message!")).not.toBeVisible();

    await page.locator("li").filter({ hasText: "Ei" }).click();
    await page.waitForTimeout(500);

    await expect(page.locator("text=First message to Ei")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Ei response to first message!")).toBeVisible();

    await expect(page.locator("text=Message to TestBot")).not.toBeVisible();
    await expect(page.locator("text=TestBot response!")).not.toBeVisible();
  });

  test("rapid switching between personas maintains correct state", async ({ page }) => {
    mockServer.setResponseForType("persona-generation", {
      type: "fixed",
      content: JSON.stringify({
        short_description: "A helpful test bot",
        long_description: "TestBot is a test persona.",
        traits: [],
        topics: [],
      }),
      statusCode: 200,
    });
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Response received",
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, MOCK_SERVER_URL);

    await page.goto("/");
    await expect(page.locator("li").first()).toContainText("Ei", { timeout: 10000 });

    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("name")) {
        await dialog.accept("TestBot");
      } else if (dialog.message().includes("description")) {
        await dialog.accept("A test bot");
      }
    });
    await page.click("text=+ Create Persona");
    await expect(page.locator("text=TestBot")).toBeVisible({ timeout: 15000 });

    const eiPersona = page.locator("li").filter({ hasText: "Ei" });
    const testBotPersona = page.locator("li").filter({ hasText: "TestBot" });

    await eiPersona.click();
    await testBotPersona.click();
    await eiPersona.click();
    await testBotPersona.click();
    await eiPersona.click();

    await expect(eiPersona).toHaveCSS("background-color", "rgb(224, 224, 224)");
    await expect(testBotPersona).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    const input = page.locator('input[type="text"]');
    await input.fill("After rapid switching");
    await input.press("Enter");

    await expect(page.locator("text=After rapid switching")).toBeVisible({ timeout: 5000 });
  });

  test.skip("unread indicators update correctly - UI not implemented", async () => {});
});
