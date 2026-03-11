import { test, expect, seedCheckpoint } from "./fixtures.js";

test.describe("Multi-Message Image Synthesis", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  test("multi-message synthesis flow with editable prompt", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    // Setup mock responses
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Test response",
        reason: "testing"
      }),
      statusCode: 200,
    });

    // Mock response for image synthesis (LLM generates prompt from multiple messages)
    mockServer.setResponseForType("image-synthesis", {
      type: "fixed",
      content: JSON.stringify({
        image_prompt: "Dramatic mountain sunset with vibrant purple and orange sky"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    // Wait for Ei persona to be ready
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send 3 test messages to build conversation context
    const input = page.locator("textarea");
    
    await input.fill("I love mountain landscapes");
    await input.press("Enter");
    await expect(page.locator("text=I love mountain landscapes")).toBeVisible({ timeout: 5000 });

    await input.fill("Sunsets are beautiful");
    await input.press("Enter");
    await expect(page.locator("text=Sunsets are beautiful")).toBeVisible({ timeout: 5000 });

    await input.fill("Purple and orange colors in the sky");
    await input.press("Enter");
    await expect(page.locator("text=Purple and orange colors in the sky")).toBeVisible({ timeout: 5000 });

    // Open multi-message synthesis modal via bottom 🖼️ button
    // Need to use more specific selector to avoid the single-message image buttons
    const synthesisButton = page.locator('.ei-input-area__controls .ei-image-prompt-btn');
    await expect(synthesisButton).toBeVisible({ timeout: 5000 });
    await synthesisButton.click();

    // Modal should open with message checkboxes
    const modal = page.locator(".ei-message-selector-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator("text=Generate Image from Conversation")).toBeVisible();

    // Select 2 messages via checkboxes
    const checkboxes = modal.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Click "Generate Image (2 selected)" button
    const generateButton = modal.locator('button:has-text("Generate Image")');
    await expect(generateButton).toContainText("2 selected");
    await generateButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Wait for synthesis message to appear with .silence-reason styling
    const synthesisMessage = page.locator(".silence-reason").last();
    await expect(synthesisMessage).toBeVisible({ timeout: 10000 });
    await expect(synthesisMessage).toContainText("Dramatic mountain sunset");

    // Test 1: Click synthesis text → ImagePreviewModal with editable textarea should open
    // Wait for synthesis message to be fully interactive
    await page.waitForTimeout(500);
    await synthesisMessage.click({ force: true });
    const imageModal = page.locator(".ei-image-preview-modal");
    await expect(imageModal).toBeVisible({ timeout: 5000 });
    
    
    const textarea = imageModal.locator("textarea");
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await expect(textarea).toHaveValue(/Dramatic mountain sunset/);

    // Edit the prompt
    await textarea.fill("Dramatic mountain sunset with golden light rays");
    
    // Blur to trigger auto-save
    await textarea.blur();
    await page.waitForTimeout(500); // Wait for auto-save to complete

    // Close modal
    const closeButton = imageModal.locator('button.ei-image-preview__close');
    await closeButton.click();
    await expect(imageModal).not.toBeVisible({ timeout: 3000 });

    // Verify message in chat updated with edited text
    await expect(synthesisMessage).toContainText("golden light rays");
    // Test 2: Click synthesis image thumbnail → same modal with textarea should open
    // (Note: In manual testing, image generation would create a thumbnail, but in this test
    // the ComfyUI mock returns immediately, so we'd need to wait for the image button state)
    // For now, we'll test that clicking the synthesis text again shows the edited prompt

    await synthesisMessage.click();
    await expect(imageModal).toBeVisible({ timeout: 3000 });
    await expect(textarea).toHaveValue(/golden light rays/);
    await closeButton.click();

    // Test 3 (persistence across reload) is skipped due to seedCheckpoint's addInitScript
    // interfering with reload. Persistence is tested in backup-sync.spec.ts instead.
  });

  test("normal message image modal does NOT have editable textarea", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Here's a test image for you",
        reason: "testing"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send a message
    const input = page.locator("textarea");
    await input.fill("Show me a test image");
    await input.press("Enter");

    // Wait for USER message to appear
    await expect(page.locator("text=Show me a test image")).toBeVisible({ timeout: 5000 });
    
    // Wait for EI's RESPONSE to appear (contains the verbal_response we'll use as prompt)
    await expect(page.locator("text=Here's a test image for you")).toBeVisible({ timeout: 5000 });
    // Click single-message image button (🖼️ on the message itself)
    const messageImageButton = page.locator('.ei-message__image').last();
    await expect(messageImageButton).toBeVisible({ timeout: 5000 });
    
    // First click triggers generation
    await messageImageButton.click();
    
    // Wait for generation to complete (button changes from ⏳ to 🎨)
    await expect(messageImageButton).toContainText('🎨', { timeout: 10000 });
    
    // Now click again to open modal
    await messageImageButton.click();

    // Modal should open
    const modal = page.locator(".ei-image-preview-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Modal should NOT have an editable textarea for normal messages
    const editablePrompt = modal.locator(".ei-editable-prompt-container");
    await expect(editablePrompt).not.toBeVisible();

    // Metadata section should exist but be collapsed initially
    const metadataToggle = modal.locator(".ei-metadata-toggle");
    await expect(metadataToggle).toBeVisible();
    
    // Expand metadata to see the prompt (read-only)
    await metadataToggle.click();
    
    // Verify prompt is shown as read-only text in metadata section
    const metadataSection = modal.locator(".ei-image-preview__metadata");
    await expect(metadataSection).toBeVisible();
    await expect(metadataSection.locator("text=/Prompt:/")).toBeVisible();
  });

  test("synthesis message differentiates from normal messages via styling", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Normal message",
        reason: "testing"
      }),
      statusCode: 200,
    });

    mockServer.setResponseForType("image-synthesis", {
      type: "fixed",
      content: JSON.stringify({
        image_prompt: "Synthesis prompt text"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send 2 messages
    const input = page.locator("textarea");
    await input.fill("Message one");
    await input.press("Enter");
    await input.fill("Message two");
    await input.press("Enter");

    // Open synthesis modal and generate
    const synthesisButton = page.locator('.ei-input-area__controls .ei-image-prompt-btn');
    await synthesisButton.click();
    
    const modal = page.locator(".ei-message-selector-modal");
    await expect(modal).toBeVisible();
    
    const checkboxes = modal.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    
    await modal.locator('button:has-text("Generate Image")').click();

    // Wait for synthesis message
    const synthesisMessage = page.locator(".silence-reason").last();
    await expect(synthesisMessage).toBeVisible({ timeout: 10000 });

    // Verify synthesis message has .silence-reason class (italic/muted styling)
    await expect(synthesisMessage).toHaveClass(/silence-reason/);

    // Verify cursor pointer is set (indicates clickable)
    const cursorStyle = await synthesisMessage.evaluate(el => window.getComputedStyle(el).cursor);
    expect(cursorStyle).toBe("pointer");

    // Verify normal messages don't have .silence-reason
    const normalMessages = page.locator('.ei-message:not(.silence-reason)');
    expect(await normalMessages.count()).toBeGreaterThan(0);
  });
});
