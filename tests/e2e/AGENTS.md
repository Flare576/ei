# E2E Test Development Guide

Hard-won lessons from debugging E2E tests. Read before writing new tests.

## Framework Overview

- **Mock servers**: Each parallel worker gets its own mock server on a unique port (3001, 3002, etc.)
- **Fixtures**: `mockServer` and `mockServerUrl` are available in all tests via `fixtures.ts`
- **Checkpoints**: Use `createCheckpoint()` to seed state without going through UI flows

## Common Pitfalls

### 1. Mock Response Data Must Be Complete

The orchestrators have completion criteria. If your mock response doesn't satisfy them, the system will loop until it hits MAX_ORCHESTRATOR_LOOPS (4).

**Persona Generation requires:**
- `short_description`
- 3+ traits (each with `name`, `description`, `sentiment`, `strength`)
- 3+ topics (each with `name`, `description`, `sentiment`, `exposure_current`, `exposure_desired`)

```typescript
// ❌ WRONG - Will loop 4 times and fail
mockServer.setResponseForType("persona-generation", {
  type: "fixed",
  content: JSON.stringify({
    short_description: "A philosopher",
    traits: [{ name: "Wise", description: "...", sentiment: 0.5, strength: 0.8 }],  // Only 1!
    topics: [{ name: "Philosophy", description: "...", sentiment: 0.5, exposure_current: 0.5, exposure_desired: 0.7 }],  // Only 1!
  }),
});

// ✅ CORRECT - Meets all criteria
mockServer.setResponseForType("persona-generation", {
  type: "fixed", 
  content: JSON.stringify({
    short_description: "A philosopher",
    traits: [
      { name: "Wise", description: "...", sentiment: 0.5, strength: 0.8 },
      { name: "Calm", description: "...", sentiment: 0.3, strength: 0.6 },
      { name: "Patient", description: "...", sentiment: 0.4, strength: 0.7 },
    ],
    topics: [
      { name: "Philosophy", description: "...", sentiment: 0.5, exposure_current: 0.5, exposure_desired: 0.7 },
      { name: "Ethics", description: "...", sentiment: 0.6, exposure_current: 0.3, exposure_desired: 0.6 },
      { name: "Logic", description: "...", sentiment: 0.4, exposure_current: 0.4, exposure_desired: 0.5 },
    ],
  }),
});
```

### 2. Playwright Text Locators Don't Find Input Values

`text=Foo` finds visible text content, NOT input/textarea values.

```typescript
// ❌ WRONG - Won't find <input value="Contemplative">
await expect(page.locator("text=Contemplative")).toBeVisible();

// ✅ CORRECT - Use attribute selector for input values
await expect(page.locator('input.ei-data-card__name[value="Contemplative"]')).toBeVisible();

// ✅ ALSO CORRECT - Use getByRole with name for accessible inputs
await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Contemplative');
```

### 3. UI Elements May Need Scrolling

Modal content can overflow. Elements at the bottom (like Traits in PersonaIdentityTab) may not be visible without scrolling.

```typescript
const modalContent = page.locator('.ei-tab-container__content');
await modalContent.evaluate(el => el.scrollTop = el.scrollHeight);
await page.waitForTimeout(300);  // Let scroll settle
```

### 4. Event Flow Matters

Understanding when UI updates happen:

| Event | When It Fires | What Updates |
|-------|---------------|--------------|
| `onPersonaAdded` | Immediately after `createPersona()` | Persona appears in list (placeholder, no generated data) |
| `onPersonaUpdated` | After each `HandlePersonaGeneration` response | Persona data refreshes (may have partial or complete data) |

The pill's `short_description` appearing means generation completed successfully. If it never appears, check:
1. Is the mock server receiving requests? (`mockServer.getRequestHistory()`)
2. Is the request type being detected correctly? (check `detectRequestType` in mock-server.ts)
3. Does the response meet completion criteria?

## Debugging Tips

### Check Mock Server Requests
```typescript
const requests = mockServer.getRequestHistory();
console.log(`Received ${requests.length} request(s)`);
for (const req of requests) {
  const body = req.body as { messages?: Array<{ role: string; content: string }> };
  const systemMsg = body?.messages?.find(m => m.role === "system")?.content?.slice(0, 200);
  console.log(`Request type detection input: ${systemMsg}...`);
}
```

### Capture Screenshots
```typescript
await page.screenshot({ path: "test-results/debug.png", fullPage: true });
```

### Log DOM Content
```typescript
const html = await page.locator('.some-selector').innerHTML();
console.log("DOM content:", html.slice(0, 500));
```

## Request Type Detection

The mock server detects request types by checking the system message content. See `detectRequestType()` in `framework/mock-server.ts`:

| Type | Detection Pattern |
|------|-------------------|
| `persona-generation` | "helping create" + "persona" |
| `response` | "you are ei" + "companion" |
| `trait-extraction` | "analyzing a conversation to detect explicit requests" |

If your mock response isn't being used, the request type probably isn't matching. Check the actual prompt content against the detection patterns.

## Test Structure Best Practices

1. **Use checkpoints** for complex initial state rather than driving the UI
2. **Set mock responses before navigation** (`loadCheckpoint` then `page.goto`)
3. **Wait for specific elements**, not arbitrary timeouts
4. **Clear mock state in beforeEach**: `mockServer.clearRequestHistory()`, `clearResponseOverrides()`, `clearResponseQueue()`
