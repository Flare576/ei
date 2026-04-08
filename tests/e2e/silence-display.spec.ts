import { test, expect, seedCheckpoint, selectEiPersona } from "./fixtures.js";

test.use({ browserName: "chromium" });

test.describe("Silence Display — 1:1 Chat (W7)", () => {
  test.beforeEach(async ({ mockServer }) => {
    mockServer.clearRequestHistory();
    mockServer.clearResponseQueue();
  });

  test("1:1 human silence shows 'You chose not to respond'", async ({ page, mockServerUrl }) => {
    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await selectEiPersona(page);

    await page.locator(".ei-room-send-group__dropdown-toggle").click();
    await page.locator(".ei-room-send-dropdown button", { hasText: "Silent Response" }).click();

    const textarea = page.locator("textarea");
    await textarea.fill("just thinking quietly");
    await textarea.press("Enter");

    await expect(
      page.locator(".silence-reason", { hasText: "You chose not to respond" })
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator(".silence-reason", { hasText: "Ei chose not to respond" })
    ).not.toBeVisible();
  });

  test("1:1 persona silence shows persona name", async ({ page, mockServer, mockServerUrl }) => {
    mockServer.setResponseForType("response", {
      type: "fixed",
      content: "noresponse\ntaking a moment to reflect",
      statusCode: 200,
    });

    await seedCheckpoint(page, mockServerUrl);
    await page.goto("/");

    await selectEiPersona(page);

    const textarea = page.locator("textarea");
    await textarea.fill("Hello Ei!");
    await textarea.press("Enter");

    await expect(page.locator("text=Hello Ei!")).toBeVisible({ timeout: 5000 });

    await expect(
      page.locator(".silence-reason", { hasText: "Ei chose not to respond" })
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.locator(".silence-reason", { hasText: "You chose not to respond" })
    ).not.toBeVisible();
  });
});
