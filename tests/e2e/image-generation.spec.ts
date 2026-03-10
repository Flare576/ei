import { test, expect, seedCheckpoint } from "./fixtures.js";

test.describe("Image Generation and Removal", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
    mockServer.clearResponseOverrides();
  });

  test("single message: generate → remove → regenerate cycle", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    // Setup mock for normal response
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "A serene mountain landscape at dawn",
        reason: "testing"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    // Wait for Ei persona to be ready
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send a message
    const input = page.locator("textarea");
    await input.fill("Show me a mountain landscape");
    await input.press("Enter");

    // Wait for message to appear
    await expect(page.locator("text=Show me a mountain landscape")).toBeVisible({ timeout: 5000 });

    // Wait for AI response
    await expect(page.locator("text=A serene mountain landscape at dawn")).toBeVisible({ timeout: 5000 });

    // Click image button to generate
    const messageImageButton = page.locator('.ei-message__image').last();
    await expect(messageImageButton).toBeVisible({ timeout: 5000 });
    await messageImageButton.click();

    // Wait for generation to complete (button changes to 🎨)
    await expect(messageImageButton).toContainText('🎨', { timeout: 10000 });

    // Click again to open modal
    await messageImageButton.click();

    // Modal should open with image
    const modal = page.locator(".ei-image-preview-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible();

    // Click Remove button
    const removeButton = modal.locator('button:has-text("Remove")');
    await expect(removeButton).toBeVisible();
    await removeButton.click();

    // Modal should close
    await expect(modal).not.toBeVisible({ timeout: 3000 });

    // Image button should revert to initial state (🖼️)
    await expect(messageImageButton).toContainText('🖼️', { timeout: 3000 });

    // Verify we can regenerate - click to generate again
    await messageImageButton.click();

    // Wait for generation to complete again
    await expect(messageImageButton).toContainText('🎨', { timeout: 10000 });

    // Open modal to verify image is there
    await messageImageButton.click();
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible();
  });

  test("multi-message synthesis: generate → remove → verify state cleared", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    // Setup mocks
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Test response",
        reason: "testing"
      }),
      statusCode: 200,
    });

    mockServer.setResponseForType("image-synthesis", {
      type: "fixed",
      content: JSON.stringify({
        image_prompt: "Vibrant sunset over mountains with purple and orange sky"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    // Wait for Ei persona
    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send 3 messages to build context
    const input = page.locator("textarea");
    
    await input.fill("I love sunset colors");
    await input.press("Enter");
    await expect(page.locator("text=I love sunset colors")).toBeVisible({ timeout: 5000 });

    await input.fill("Mountains are peaceful");
    await input.press("Enter");
    await expect(page.locator("text=Mountains are peaceful")).toBeVisible({ timeout: 5000 });

    await input.fill("Purple and orange in the sky");
    await input.press("Enter");
    await expect(page.locator("text=Purple and orange in the sky")).toBeVisible({ timeout: 5000 });

    // Open multi-message synthesis modal
    const synthesisButton = page.locator('.ei-input-area__controls .ei-image-prompt-btn');
    await expect(synthesisButton).toBeVisible({ timeout: 5000 });
    await synthesisButton.click();

    // Modal should open
    const selectorModal = page.locator(".ei-message-selector-modal");
    await expect(selectorModal).toBeVisible({ timeout: 3000 });

    // Select 2 messages
    const checkboxes = selectorModal.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // Click Generate
    const generateButton = selectorModal.locator('button:has-text("Generate Image")');
    await expect(generateButton).toContainText("2 selected");
    await generateButton.click();

    // Wait for modal to close
    await expect(selectorModal).not.toBeVisible({ timeout: 5000 });

    // Wait for synthesis message to appear
    const synthesisMessage = page.locator(".silence-reason").last();
    await expect(synthesisMessage).toBeVisible({ timeout: 10000 });
    await expect(synthesisMessage).toContainText("Vibrant sunset");

    // Wait a moment for full interactivity
    await page.waitForTimeout(500);

    // Click synthesis message to open image preview
    await synthesisMessage.click({ force: true });
    const imageModal = page.locator(".ei-image-preview-modal");
    await expect(imageModal).toBeVisible({ timeout: 5000 });

    // Verify image is displayed
    await expect(imageModal.locator("img.ei-image-preview__image")).toBeVisible();

    // Verify editable textarea is present (synthesis-specific)
    const textarea = imageModal.locator("textarea#prompt-edit");
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await expect(textarea).toHaveValue(/Vibrant sunset/);

    // Click Remove button
    const removeButton = imageModal.locator('button:has-text("Remove")');
    await expect(removeButton).toBeVisible();
    await removeButton.click();

    // Modal should close
    await expect(imageModal).not.toBeVisible({ timeout: 3000 });

    // Synthesis message should still be visible (text remains, just image removed)
    await expect(synthesisMessage).toBeVisible();
    await expect(synthesisMessage).toContainText("Vibrant sunset");

    // Image button should not be visible on synthesis message (it's just text now)
    const imageButton = synthesisMessage.locator('.ei-message__image');
    await expect(imageButton).not.toBeVisible();
  });

  test("remove clears image from state and allows regeneration", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "A peaceful forest scene",
        reason: "testing"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send message
    const input = page.locator("textarea");
    await input.fill("Show me a forest");
    await input.press("Enter");
    await expect(page.locator("text=Show me a forest")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=A peaceful forest scene")).toBeVisible({ timeout: 5000 });

    // Generate image
    const messageImageButton = page.locator('.ei-message__image').last();
    await expect(messageImageButton).toBeVisible({ timeout: 5000 });
    await messageImageButton.click();
    await expect(messageImageButton).toContainText('🎨', { timeout: 10000 });

    // Open modal
    await messageImageButton.click();
    const modal = page.locator(".ei-image-preview-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Verify regenerate button is enabled
    const regenerateButton = modal.locator('button:has-text("Regenerate")');
    await expect(regenerateButton).toBeEnabled();

    // Remove image
    const removeButton = modal.locator('button:has-text("Remove")');
    await removeButton.click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });

    // Button should reset to initial state
    await expect(messageImageButton).toContainText('🖼️', { timeout: 3000 });

    // Regenerate by clicking button again
    await messageImageButton.click();
    await expect(messageImageButton).toContainText('🎨', { timeout: 10000 });

    // Open modal to verify new image
    await messageImageButton.click();
    await expect(modal).toBeVisible({ timeout: 3000 });
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible();

    // Verify regenerate button still works in modal
    await expect(regenerateButton).toBeEnabled();
    await regenerateButton.click();

    // Modal should stay open during regeneration
    await expect(modal).toBeVisible();
    
    // Loading state should appear briefly
    const loadingSpinner = modal.locator(".ei-spinner");
    // Note: May be too fast to catch, but verify it doesn't crash

    // Eventually completes - image still visible
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible({ timeout: 10000 });
  });

  test("synthesis message: multiple remove/regenerate cycles", async ({ page, mockServer, mockServerUrl, imageProviderUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: JSON.stringify({
        should_respond: true,
        verbal_response: "Test response",
        reason: "testing"
      }),
      statusCode: 200,
    });

    mockServer.setResponseForType("image-synthesis", {
      type: "fixed",
      content: JSON.stringify({
        image_prompt: "Abstract geometric patterns in blue and gold"
      }),
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl, undefined, imageProviderUrl);
    await page.goto("/");

    await expect(page.locator(".ei-persona-pill").first()).toContainText("Ei", { timeout: 10000 });
    await page.locator(".ei-persona-pill").first().click();

    // Send messages
    const input = page.locator("textarea");
    await input.fill("I like geometric art");
    await input.press("Enter");
    await input.fill("Blue and gold colors");
    await input.press("Enter");

    // Generate synthesis
    const synthesisButton = page.locator('.ei-input-area__controls .ei-image-prompt-btn');
    await synthesisButton.click();
    const selectorModal = page.locator(".ei-message-selector-modal");
    await expect(selectorModal).toBeVisible();
    
    const checkboxes = selectorModal.locator('input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await selectorModal.locator('button:has-text("Generate Image")').click();
    await expect(selectorModal).not.toBeVisible({ timeout: 5000 });

    const synthesisMessage = page.locator(".silence-reason").last();
    await expect(synthesisMessage).toBeVisible({ timeout: 10000 });

    // Cycle 1: Generate → Remove
    await page.waitForTimeout(500);
    await synthesisMessage.click({ force: true });
    const modal = page.locator(".ei-image-preview-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible();
    
    await modal.locator('button:has-text("Remove")').click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });

    // Cycle 2: Regenerate → Remove
    await synthesisMessage.click({ force: true });
    await expect(modal).toBeVisible({ timeout: 5000 });
    
    // Edit prompt before regenerating
    const textarea = modal.locator("textarea#prompt-edit");
    await textarea.fill("Abstract geometric patterns in blue and gold with silver accents");
    await textarea.blur();
    await page.waitForTimeout(500);

    await modal.locator('button:has-text("Regenerate")').click();
    await expect(modal.locator(".ei-spinner")).toBeVisible();
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible({ timeout: 10000 });

    await modal.locator('button:has-text("Remove")').click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });

    // Cycle 3: Verify still works
    await synthesisMessage.click({ force: true });
    await expect(modal).toBeVisible({ timeout: 5000 });
    
    // Verify edited prompt persisted
    await expect(textarea).toHaveValue(/silver accents/);
    
    await modal.locator('button:has-text("Regenerate")').click();
    await expect(modal.locator("img.ei-image-preview__image")).toBeVisible({ timeout: 10000 });
  });
});
