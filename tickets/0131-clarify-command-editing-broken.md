# 0131: /clarify Command Editing Is Broken

**Status**: PENDING

## Summary

The `/clarify` command displays entity data but doesn't actually support editing or deleting items. When users try to edit via natural conversation after using `/clarify`, the extraction system can only ADD or UPDATE items - it has no "delete this item" capability, leading to data pollution.

## Bug Details

### What Currently Works

- `/clarify` → Shows overview of all data
- `/clarify facts` → Shows all facts with details
- `/clarify "Birthday"` → Shows specific item details

### What's Broken

**Editing doesn't work**:
1. User runs `/clarify "Birthday"`
2. Ei shows: "Here's the current data... What would you like to change?"
3. User responds: "Delete it" or "Change description to X"
4. Message goes through normal Ei conversation processing
5. Extraction system treats it as a regular conversation
6. **Result**: Either nothing happens, or worse, creates NEW items like "Delete Birthday" as a topic

**Root cause**: The `/clarify` command has no follow-up state. After displaying the item, the next user message is processed as a normal conversation, not as an edit instruction.

### Evidence from Code

**File**: `src/blessed/app.ts`, `startItemEdit()` (lines 1682-1727)

```typescript
private async startItemEdit(itemName: string): Promise<void> {
  const entity = await loadHumanEntity();
  const found = findDataPointByName(entity, itemName);
  
  // ... displays item ...
  
  const response = `Here's the current data for "${found.name}":\n\n...\n\nWhat would you like to change?`;
  
  // Just adds message to chat - NO EDITING LOGIC
  this.addMessage('system', response);
  await appendMessage(systemMsg, 'ei');
  
  // NO state tracking that next message should be parsed as edit
  // NO special handling in processEvent
  // NO delete/modify capability in extraction system
}
```

## What SHOULD Happen

### Design Intent (from ticket 0117)

The `/clarify` command was supposed to trigger a conversational editing flow:
1. User: `/clarify "Birthday"`
2. Ei: Shows current data, asks what to change
3. User: "Change the date to March 15th" or "Delete it"
4. **Ei parses as edit instruction and updates/deletes accordingly**

### Missing Components

1. **Edit mode state tracking**
   - After showing item, set flag: `this.editingItem = { name: "Birthday", type: "fact" }`
   - Next user message → check if in edit mode
   - Parse message as edit instruction, not conversation

2. **Edit instruction parsing**
   - LLM prompt: "User is editing 'Birthday'. Parse their instruction:"
   - Return: `{ action: "delete" }` or `{ action: "update", changes: {...} }`

3. **Delete capability**
   - Extraction system can only add/update, never delete
   - Need `deleteDataPoint(entity, name)` function
   - Need to call `saveHumanEntity()` after deletion

4. **Confirmation flow**
   - "Are you sure you want to delete 'Birthday'?" (especially for sensitive items like people)

## Current Workaround (Dangerous)

Users can theoretically edit through natural conversation:
- "Actually my birthday is March 15th" → might update existing Birthday fact
- "I don't have a birthday recorded" → might confuse extraction, create weird items

But there's **no way to delete** items:
- "Delete my birthday" → might create topic "birthday deletion" or "forget birthday"
- "Remove Emma from my people" → might create negative sentiment topic about Emma

This can only make data worse, not better.

## Solution Options

### Option A: Implement Full Edit Flow (Proper Fix)

**Effort**: Medium (3-4 hours)

1. Add edit mode state to `EIApp`:
```typescript
private editingContext: {
  item_name: string;
  item_type: 'fact' | 'trait' | 'topic' | 'person';
} | null = null;
```

2. After showing item in `/clarify`, set edit context:
```typescript
this.editingContext = { item_name: found.name, item_type: found.item_type };
```

3. In message processing, check for edit context:
```typescript
// Before calling processEvent
if (this.editingContext) {
  await this.handleEditInstruction(userMessage);
  return;
}
```

4. Implement `handleEditInstruction()`:
```typescript
private async handleEditInstruction(instruction: string): Promise<void> {
  const prompt = buildEditInstructionPrompt(this.editingContext!, instruction);
  const result = await callLLMForJSON<EditInstruction>(prompt);
  
  const entity = await loadHumanEntity();
  
  if (result.action === "delete") {
    // Confirm first for sensitive items
    if (needsConfirmation(this.editingContext!)) {
      // Set confirmation state, wait for yes/no
    } else {
      removeDataPointByName(entity, this.editingContext!.item_name);
      await saveHumanEntity(entity);
    }
  } else if (result.action === "update") {
    // Apply changes
  }
  
  this.editingContext = null;  // Clear edit mode
}
```

5. Add delete function to `verification.ts`:
```typescript
// Already exists: removeDataPointByName() - just needs to be exported
```

### Option B: Disable Editing Prompts (Quick Fix)

**Effort**: Trivial (5 minutes)

Change the messages to NOT suggest editing:

```typescript
const response = `Here's the current data for "${found.name}":\n\n...\n\n(Editing via /clarify is not yet implemented. To change this, mention it in conversation and I'll update it naturally.)`;
```

**Pros**: Honest, prevents false expectations  
**Cons**: Removes a promised feature

### Option C: External Edit Interface

**Effort**: Large (6-8 hours)

Build a proper data editor (modal/form-based):
- Arrow keys to select item
- Enter to edit (opens sub-form)
- Delete key to remove
- Esc to cancel

**Pros**: Much better UX than conversational editing  
**Cons**: Significant UI work, out of scope for 0107

## Recommended Solution

**Option B** for immediate fix (honest messaging), then **Option A** as a proper feature ticket.

## Acceptance Criteria

**For Option B (immediate)**:
- [ ] Update all `/clarify` response messages to remove edit suggestions
- [ ] Add note: "Editing feature coming soon"
- [ ] Update help text for `/clarify` to say "View data" not "View/edit"

**For Option A (future feature)**:
- [ ] Edit mode state tracking works
- [ ] User can update item descriptions/values
- [ ] User can delete items with confirmation
- [ ] Edit mode clears after processing instruction
- [ ] Cancellation works ("never mind", "cancel")
- [ ] Protected items (family) require explicit confirmation

## Test Scenario (for Option A)

1. Run `/clarify "Birthday"`
2. Ei shows current data
3. User: "Change it to March 15th"
4. Ei confirms change and updates entity
5. Check `data/human.jsonc` - Birthday fact updated
6. Run `/clarify facts` - see updated birthday

1. Run `/clarify "Daughter Emma"`
2. User: "Delete this"
3. Ei: "This is a family member. Are you sure you want to delete?"
4. User: "Yes"
5. Check `data/human.jsonc` - Emma removed from people array

## Dependencies

- Ticket 0117 (/clarify Command) - marked as "partial implementation"

## Effort Estimate

- Option B (disable editing): Trivial (~5 min)
- Option A (implement editing): Medium (~3-4 hours)

## Notes

### Why Conversational Editing Is Hard

Unlike extraction (which is additive), editing requires:
- Intent parsing: "Delete" vs "Update" vs "Cancel"
- State management: Remember what's being edited
- Confirmation: Especially for destructive actions
- Error handling: "I couldn't find that field"

Natural language is ambiguous:
- "Remove it" → delete item or just remove from a group?
- "Change the description" → to what?
- "Never mind" → cancel or create topic "never mind"?

This is why most data editors use forms, not chat.

### Alternative Consideration

Maybe `/clarify` should launch a blessed modal form instead of trying to do conversational editing. Users could arrow-key through fields, edit in place, delete with confirmation dialogs. Much clearer UX.

But that's a bigger redesign beyond this bug ticket.
