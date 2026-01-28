# 0036: E2E: Checkpoint Save/Restore

**Status**: PENDING
**Depends on**: 0016
**Epic**: E004 - Testing Infrastructure

## Summary

End-to-end test for the checkpoint (save/restore) system. Verify manual saves work, restores actually restore state, and auto-saves happen in the background.

## Acceptance Criteria

- [ ] Test manual save creates checkpoint
- [ ] Test restore loads previous state
- [ ] Test message sent after save is lost on restore
- [ ] Test auto-save happens after interval
- [ ] Test checkpoint list shows correct slots

## Technical Notes

### Test Scenario: Manual Save/Restore

```typescript
test('can save and restore state', async ({ page, mockServer }) => {
  await page.goto('/');
  
  // 1. Send a message
  await page.locator('.chat-input').fill('Message 1');
  await page.locator('.chat-input').press('Enter');
  await expect(page.locator('.message-human')).toContainText('Message 1');
  
  // 2. Create manual save
  await page.locator('[data-testid="save-button"]').click();
  await page.locator('[data-testid="save-slot-10"]').click();
  // Wait for save confirmation
  
  // 3. Send another message
  await page.locator('.chat-input').fill('Message 2');
  await page.locator('.chat-input').press('Enter');
  await expect(page.locator('.message-human').last()).toContainText('Message 2');
  
  // 4. Restore from save
  await page.locator('[data-testid="save-button"]').click();
  await page.locator('[data-testid="restore-slot-10"]').click();
  
  // 5. Verify Message 2 is gone, Message 1 remains
  await expect(page.locator('.message-human')).toContainText('Message 1');
  await expect(page.locator('.message-human')).not.toContainText('Message 2');
});
```

### Test Scenario: Auto-Save

```typescript
test('auto-saves periodically', async ({ page }) => {
  await page.goto('/');
  
  // Send a message
  await page.locator('.chat-input').fill('Test message');
  await page.locator('.chat-input').press('Enter');
  
  // Wait for auto-save interval (may need to mock time or use short interval)
  await page.waitForTimeout(65000); // 1 minute + buffer
  
  // Verify auto-save exists
  const checkpoints = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('ei_autosaves') || '[]');
  });
  expect(checkpoints.length).toBeGreaterThan(0);
});
```

### UI Requirements

This test assumes Save UI exists (ticket 0049). If not ready, can test via localStorage inspection:
```typescript
// Manually trigger save via Processor if UI not ready
await page.evaluate(async () => {
  // Access processor somehow...
});
```

### Time Manipulation

For auto-save testing without waiting 60 seconds:
- Configure shorter interval for tests
- Or use Playwright's clock API (experimental)

## Out of Scope

- Full save UI testing (0049)
- Delete checkpoint
- Multiple save slots
