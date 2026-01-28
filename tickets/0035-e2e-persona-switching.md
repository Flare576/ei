# 0035: E2E: Persona Switching

**Status**: DONE
**Depends on**: 0016
**Epic**: E004 - Testing Infrastructure

## Summary

End-to-end test for switching between personas. Verify that selecting a different persona loads their history and that messages go to the correct persona.

## Acceptance Criteria

- [ ] Test displays multiple personas in list
- [ ] Test clicking persona switches active state
- [ ] Test chat history changes when switching
- [ ] Test sending message to non-Ei persona
- [ ] Test switching back shows previous history
- [ ] Test unread indicators update correctly

## Technical Notes

### Test Scenario

```typescript
test('can switch between personas and maintain separate histories', async ({ page, mockServer }) => {
  // Setup: Create a second persona via API or pre-seeded state
  
  // 1. Start with Ei active
  await page.goto('/');
  await expect(page.locator('.persona-pill.active')).toContainText('Ei');
  
  // 2. Send message to Ei
  await page.locator('.chat-input').fill('Hello Ei');
  await page.locator('.chat-input').press('Enter');
  await expect(page.locator('.message-human')).toContainText('Hello Ei');
  
  // 3. Switch to other persona
  await page.locator('.persona-pill:has-text("Other")').click();
  await expect(page.locator('.persona-pill.active')).toContainText('Other');
  
  // 4. Verify history is different (empty or different messages)
  await expect(page.locator('.message-human')).not.toContainText('Hello Ei');
  
  // 5. Send message to Other
  await page.locator('.chat-input').fill('Hello Other');
  await page.locator('.chat-input').press('Enter');
  
  // 6. Switch back to Ei
  await page.locator('.persona-pill:has-text("Ei")').click();
  
  // 7. Verify Ei's history is intact
  await expect(page.locator('.message-human')).toContainText('Hello Ei');
});
```

### Test Data Setup

Need a way to pre-seed test data:

Option 1: Use localStorage directly
```typescript
await page.evaluate(() => {
  localStorage.setItem('ei_autosaves', JSON.stringify([initialState]));
});
await page.reload();
```

Option 2: Create persona via UI (slower but more realistic)

Option 3: API call if we expose it

### Mock Server Configuration

Different personas might need different mock responses:
```typescript
mockServer.setResponseForType('response', {
  type: 'fixed',
  content: 'Response from mock',
  statusCode: 200,
});
```

### V0 Reference

`v0/tests/e2e/scenarios/multi-persona.e2e.test.ts`

## Out of Scope

- Persona creation flow (separate test)
- Archive/unarchive
- Pause/resume
