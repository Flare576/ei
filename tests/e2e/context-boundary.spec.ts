import { test, expect } from "./fixtures.js";

test.describe("Context Boundary", () => {
  test.beforeEach(async ({ page, mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test("New/Resume button toggles context boundary and shows divider", async ({ page, mockServerUrl }) => {
    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, mockServerUrl);

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    const boundaryBtn = page.locator(".ei-boundary-btn");
    await expect(boundaryBtn).toBeVisible();
    await expect(boundaryBtn).toHaveText("✦");

    await boundaryBtn.click();

    await expect(page.locator(".ei-context-divider")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".ei-context-divider")).toContainText("New conversation started");
    await expect(boundaryBtn).toHaveText("↩");

    await boundaryBtn.click();

    await expect(page.locator(".ei-context-divider")).not.toBeVisible({ timeout: 2000 });
    await expect(boundaryBtn).toHaveText("✦");
  });

  test("divider appears between old and new messages after boundary set", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "This is a new message after the boundary!",
      statusCode: 200,
    });

    await page.addInitScript((url) => {
      localStorage.setItem("EI_LLM_BASE_URL", url);
    }, mockServerUrl);

    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    await expect(page.locator("text=Hello! I'm Ei")).toBeVisible({ timeout: 10000 });

    const boundaryBtn = page.locator(".ei-boundary-btn");
    await boundaryBtn.click();
    await expect(boundaryBtn).toHaveText("↩");

    const input = page.locator("textarea");
    await input.fill("Hello after boundary!");
    await input.press("Enter");

    await expect(page.locator("text=This is a new message after the boundary")).toBeVisible({ timeout: 15000 });

    const divider = page.locator(".ei-context-divider");
    await expect(divider).toBeVisible();

    const messages = page.locator(".ei-message");
    const dividerPosition = await divider.boundingBox();
    const welcomeMessage = messages.first();
    const welcomePosition = await welcomeMessage.boundingBox();
    
    expect(dividerPosition!.y).toBeGreaterThan(welcomePosition!.y);
  });
});
