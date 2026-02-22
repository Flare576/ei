import { test, expect, seedCheckpoint } from "./fixtures.js";
import type { Page } from "@playwright/test";

async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator("textarea");
  await input.fill(text);
  await input.press("Enter");
}

async function waitForResponseContaining(page: Page, text: string, timeout = 15000): Promise<void> {
  await expect(page.locator(`text=${text}`).first()).toBeVisible({ timeout });
}

async function waitForNthResponseContaining(page: Page, text: string, n: number, timeout = 15000): Promise<void> {
  await expect(page.locator(`text=${text}`).nth(n - 1)).toBeVisible({ timeout });
}

async function setupPageWithMockServer(page: Page, mockServerUrl: string): Promise<void> {
  await seedCheckpoint(page, mockServerUrl);
  await page.goto("/");
  await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
  await page.locator(".ei-persona-pill").first().click();
}

function isResponseRequest(body: { messages?: Array<{ role: string; content: string }> }): boolean {
  const systemMsg = body?.messages?.find(m => m.role === "system");
  return systemMsg?.content?.toLowerCase().includes("you are ei") ?? false;
}

function isUserInitiatedRequest(body: { messages?: Array<{ role: string; content: string }> }): boolean {
  if (!isResponseRequest(body)) return false;
  const userMessages = body?.messages?.filter(m => m.role === "user") || [];
  return userMessages.length >= 2;
}

function getLatestUserInput(body: { messages?: Array<{ role: string; content: string }> }): string {
  const userMessages = body?.messages?.filter(m => m.role === "user") || [];
  if (userMessages.length < 2) return userMessages[0]?.content || "";
  return userMessages[userMessages.length - 2]?.content || "";
}

function isExtractionRequest(body: { messages?: Array<{ role: string; content: string }> }): boolean {
  const systemMsg = body?.messages?.find(m => m.role === "system");
  return systemMsg?.content?.toLowerCase().includes("analyzing a conversation to detect explicit requests") ?? false;
}

test.describe("Message Flow - Comprehensive", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("multiple messages in sequence arrive in correct order", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "I hear you!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    await sendMessage(page, "First message from user");
    await waitForResponseContaining(page, "I hear you");
    await page.waitForTimeout(500);

    await sendMessage(page, "Second message from user");
    await page.waitForTimeout(500);

    await sendMessage(page, "Third message from user");
    await page.waitForTimeout(2000);

    await expect(page.locator("text=First message from user")).toBeVisible();
    await expect(page.locator("text=Second message from user")).toBeVisible();
    await expect(page.locator("text=Third message from user")).toBeVisible();

    const requests = mockServer.getRequestHistory();
    const userRequests = requests.filter(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      return isUserInitiatedRequest(body);
    });

    expect(userRequests.length).toBeGreaterThanOrEqual(3);

    const getUserInput = (req: typeof userRequests[0]) => {
      const body = req.body as { messages?: Array<{ role: string; content: string }> };
      return getLatestUserInput(body);
    };

    expect(getUserInput(userRequests[0])).toContain("First message");
    expect(getUserInput(userRequests[1])).toContain("Second message");
    expect(getUserInput(userRequests[2])).toContain("Third message");
  });

  test("conversation context is maintained across messages", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "I remember our conversation!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    await sendMessage(page, "My favorite color is blue");
    await waitForResponseContaining(page, "I remember our conversation");
    await page.waitForTimeout(1000);

    await sendMessage(page, "What did I just tell you?");
    await waitForResponseContaining(page, "I remember our conversation");
    await page.waitForTimeout(2000);

    const requests = mockServer.getRequestHistory();
    const userRequests = requests.filter(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      return isUserInitiatedRequest(body);
    });

    expect(userRequests.length).toBeGreaterThanOrEqual(2);

    const secondRequest = userRequests[userRequests.length - 1];
    const body = secondRequest.body as { messages?: Array<{ role: string; content: string }> };
    const messages = body.messages || [];

    const hasFirstMessage = messages.some(m => 
      m.content?.includes("blue") || m.content?.includes("favorite color")
    );
    expect(hasFirstMessage).toBe(true);

    const hasSecondMessage = messages.some(m => 
      m.content?.includes("What did I just tell you")
    );
    expect(hasSecondMessage).toBe(true);
  });

  test("extraction requests are triggered after user messages", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Thank you for sharing!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: JSON.stringify([
        { name: "Test Trait", description: "A detected trait", sentiment: 0.5, strength: 0.6 }
      ]),
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    await sendMessage(page, "I really enjoy hiking in the mountains");
    await waitForResponseContaining(page, "Thank you for sharing");
    await page.waitForTimeout(2000);

    let requests = mockServer.getRequestHistory();
    let extractionCount = requests.filter(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      return isExtractionRequest(body);
    }).length;

    expect(extractionCount).toBeGreaterThanOrEqual(1);

    await sendMessage(page, "I also love reading science fiction books");
    await waitForResponseContaining(page, "Thank you for sharing");
    await page.waitForTimeout(2000);

    requests = mockServer.getRequestHistory();
    const newExtractionCount = requests.filter(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      return isExtractionRequest(body);
    }).length;

    expect(newExtractionCount).toBeGreaterThanOrEqual(extractionCount);
  });

  test("requests are processed in chronological order", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Processing your message!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    await sendMessage(page, "First request");
    await waitForNthResponseContaining(page, "Processing your message", 1);
    await page.waitForTimeout(500);

    await sendMessage(page, "Second request");
    await waitForNthResponseContaining(page, "Processing your message", 2);
    await page.waitForTimeout(500);

    await sendMessage(page, "Third request");
    await waitForNthResponseContaining(page, "Processing your message", 3);
    await page.waitForTimeout(2000);

    const requests = mockServer.getRequestHistory();
    const userRequests = requests.filter(r => {
      const body = r.body as { messages?: Array<{ role: string; content: string }> };
      return isUserInitiatedRequest(body);
    });

    expect(userRequests.length).toBeGreaterThanOrEqual(3);

    for (let i = 1; i < userRequests.length; i++) {
      expect(userRequests[i].timestamp).toBeGreaterThanOrEqual(userRequests[i - 1].timestamp);
    }

    const getUserInput = (req: typeof userRequests[0]) => {
      const body = req.body as { messages?: Array<{ role: string; content: string }> };
      return getLatestUserInput(body);
    };

    expect(getUserInput(userRequests[0])).toContain("First request");
    expect(getUserInput(userRequests[1])).toContain("Second request");
    expect(getUserInput(userRequests[2])).toContain("Third request");
  });

  test("conversation history grows with each exchange", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Understood!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    const messageCounts: number[] = [];

    const captureMessageCount = () => {
      const requests = mockServer.getRequestHistory();
      const userReqs = requests.filter(r => {
        const body = r.body as { messages?: Array<{ role: string; content: string }> };
        return isUserInitiatedRequest(body);
      });
      if (userReqs.length > messageCounts.length) {
        const body = userReqs[userReqs.length - 1].body as { messages?: Array<{ role: string; content: string }> };
        messageCounts.push(body.messages?.length || 0);
      }
    };

    await sendMessage(page, "Hello");
    await waitForResponseContaining(page, "Understood");
    await page.waitForTimeout(1500);
    captureMessageCount();

    await sendMessage(page, "How are you?");
    await waitForResponseContaining(page, "Understood");
    await page.waitForTimeout(1500);
    captureMessageCount();

    await sendMessage(page, "Tell me more");
    await waitForResponseContaining(page, "Understood");
    await page.waitForTimeout(1500);
    captureMessageCount();

    expect(messageCounts.length).toBe(3);
    expect(messageCounts[1]).toBeGreaterThan(messageCounts[0]);
    expect(messageCounts[2]).toBeGreaterThan(messageCounts[1]);
  });

  test("pressing up-arrow recalls pending message back to input", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Slow response coming...",
      statusCode: 200,
      delayMs: 3000,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    const input = page.locator("textarea");
    const pendingMessage = "Message I want to edit";

    await input.fill(pendingMessage);
    await input.press("Enter");

    await expect(page.locator(`text=${pendingMessage}`)).toBeVisible({ timeout: 2000 });

    await input.press("ArrowUp");

    await page.waitForTimeout(500);

    const inputValue = await input.inputValue();
    expect(inputValue).toContain(pendingMessage);

    await expect(page.locator(`.ei-message:has-text("${pendingMessage}")`)).not.toBeVisible({ timeout: 2000 });
  });

  test("up-arrow does nothing when no pending messages", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "Quick response!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    const input = page.locator("textarea");

    await input.fill("First message");
    await input.press("Enter");

    await waitForResponseContaining(page, "Quick response");
    await page.waitForTimeout(1000);

    await input.fill("Some new text");
    await input.press("ArrowUp");

    await page.waitForTimeout(300);

    const inputValue = await input.inputValue();
    expect(inputValue).toBe("Some new text");
  });

  test("human messages start as unread and are marked read after AI response", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "I got your message!",
      statusCode: 200,
    });
    mockServer.setResponseForType("trait-extraction", {
      type: "fixed",
      content: "[]",
      statusCode: 200,
    });

    await setupPageWithMockServer(page, mockServerUrl);

    const input = page.locator("textarea");
    await input.fill("Test message for read status");
    await input.press("Enter");

    await expect(page.locator("text=Test message for read status")).toBeVisible({ timeout: 2000 });

    await waitForResponseContaining(page, "I got your message");
    await page.waitForTimeout(500);

    await input.press("ArrowUp");
    await page.waitForTimeout(300);

    const inputValue = await input.inputValue();
    expect(inputValue).toBe("");
  });
});
