# 0037: E2E: Message Flow Complete

**Status**: DONE
**Depends on**: 0016
**Epic**: E004 - Testing Infrastructure

## Summary

Comprehensive E2E test of the complete message flow including extraction triggers. Verify that sending messages triggers background processing and eventually updates human entity data.

## Acceptance Criteria

- [ ] Test send message → response cycle
- [ ] Test multiple messages in sequence
- [ ] Test extraction is triggered (verify LLM calls)
- [ ] Test human entity updates from extraction
- [ ] Test queue processes in correct order
- [ ] Test conversation context is maintained

## Technical Notes

### Test Scenario: Full Flow

```typescript
test('complete message flow with extraction', async ({ page, mockServer }) => {
  // Configure mock responses
  mockServer.setResponseQueue([
    // Response to first message
    'Hello! Nice to meet you.',
    // Trait extraction result (JSON)
    '[]',  // No traits detected
    // Response to second message
    'That sounds interesting! Tell me more about your work.',
    // Trait extraction (detects something)
    '[{"name": "curious", "description": "Shows interest in learning", "strength": 0.7, "sentiment": 0.5}]',
  ]);
  
  await page.goto('/');
  
  // Send first message
  await page.locator('.chat-input').fill('Hello, I am a software developer');
  await page.locator('.chat-input').press('Enter');
  
  // Wait for response
  await expect(page.locator('.message-system').last()).toContainText('Hello!');
  
  // Send second message
  await page.locator('.chat-input').fill('I love learning new programming languages');
  await page.locator('.chat-input').press('Enter');
  
  // Wait for response
  await expect(page.locator('.message-system').last()).toContainText('interesting');
  
  // Verify extraction happened (check request history)
  const requests = mockServer.getRequestHistory();
  const extractionRequests = requests.filter(r => 
    r.body.messages?.[0]?.content?.includes('trait') // Crude check
  );
  expect(extractionRequests.length).toBeGreaterThan(0);
  
  // Verify human entity was updated
  // This requires either UI to show it, or localStorage inspection
  const state = await page.evaluate(() => {
    const autosaves = JSON.parse(localStorage.getItem('ei_autosaves') || '[]');
    return autosaves[autosaves.length - 1];
  });
  // Check state.human has updated data...
});
```

### Conversation Context

Verify that follow-up messages include history:
```typescript
test('messages include conversation context', async ({ page, mockServer }) => {
  await page.goto('/');
  
  // Send messages
  await sendMessage(page, 'My name is Alice');
  await waitForResponse(page);
  await sendMessage(page, 'What is my name?');
  
  // Check that the second request included the first exchange
  const requests = mockServer.getRequestHistory();
  const lastRequest = requests[requests.length - 1];
  const messages = lastRequest.body.messages;
  
  expect(messages.some(m => m.content.includes('Alice'))).toBe(true);
});
```

### Helper Functions

```typescript
async function sendMessage(page: Page, text: string) {
  await page.locator('.chat-input').fill(text);
  await page.locator('.chat-input').press('Enter');
}

async function waitForResponse(page: Page) {
  // Wait for new system message
  const count = await page.locator('.message-system').count();
  await expect(page.locator('.message-system')).toHaveCount(count + 1);
}
```

### V0 Reference

`v0/tests/e2e/scenarios/basic-flow.e2e.test.ts`

## Out of Scope

- Error scenarios
- Abort/cancel testing
- Rate limiting
