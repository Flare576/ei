# 0117: /clarify Command

**Status**: QA

## Summary

Implement a conversational data editing command. User types `/clarify` and Ei guides them through viewing and editing their data.

## Design

### Command Syntax

```
/clarify                    # Start guided edit flow
/clarify facts              # Jump to facts
/clarify traits             # Jump to traits
/clarify topics             # Jump to topics
/clarify people             # Jump to people
/clarify "Birthday"         # Edit specific item by name
```

### Guided Flow

When user types `/clarify`:

```typescript
async function handleClarifyCommand(
  args: string[],
  currentPersona: string
): Promise<CommandResult> {
  // If specific item requested
  if (args.length > 0 && args[0].startsWith('"')) {
    const itemName = args.join(' ').replace(/"/g, '');
    return await startItemEdit(itemName);
  }
  
  // If category specified
  if (args.length > 0 && ['facts', 'traits', 'topics', 'people'].includes(args[0])) {
    return await showCategory(args[0] as DataType);
  }
  
  // Otherwise, show overview
  return await showDataOverview();
}
```

### Overview Response

```typescript
async function showDataOverview(): Promise<CommandResult> {
  const entity = await loadHumanEntity();
  
  const summary = `Here's what I know about you:

**Facts** (${entity.facts.length}): ${summarizeItems(entity.facts)}
**Traits** (${entity.traits.length}): ${summarizeItems(entity.traits)}  
**Topics** (${entity.topics.length}): ${summarizeItems(entity.topics)}
**People** (${entity.people.length}): ${summarizeItems(entity.people)}

What would you like to review or change? You can say:
- "Show me my facts" 
- "Edit Birthday"
- "Remove the grocery bagger"
- Or just tell me what's wrong and I'll help fix it.`;

  return {
    response: summary,
    switchToPersona: "ei",   // Ensure we're talking to Ei
    awaitFollowup: true      // Ei will process next message as clarify context
  };
}

function summarizeItems(items: DataItemBase[]): string {
  if (items.length === 0) return "(none yet)";
  if (items.length <= 3) return items.map(i => i.name).join(', ');
  return `${items.slice(0, 3).map(i => i.name).join(', ')}... and ${items.length - 3} more`;
}
```

### Category View

```typescript
async function showCategory(
  category: "facts" | "traits" | "topics" | "people"
): Promise<CommandResult> {
  const entity = await loadHumanEntity();
  const items = entity[category];
  
  if (items.length === 0) {
    return {
      response: `You don't have any ${category} recorded yet. As we chat, I'll learn more about you!`,
      switchToPersona: "ei"
    };
  }
  
  const formatted = items.map((item, i) => {
    const details = formatItemDetails(item, category);
    return `${i + 1}. **${item.name}**: ${item.description}\n   ${details}`;
  }).join('\n\n');
  
  return {
    response: `Your ${category}:\n\n${formatted}\n\nTo edit one, just tell me which (by number or name) and what to change.`,
    switchToPersona: "ei",
    awaitFollowup: true
  };
}

function formatItemDetails(item: any, category: string): string {
  const parts = [];
  
  if ('confidence' in item) {
    parts.push(`Confidence: ${Math.round(item.confidence * 100)}%`);
  }
  if ('level_current' in item) {
    parts.push(`Activity: ${Math.round(item.level_current * 100)}%`);
  }
  if ('sentiment' in item) {
    const sentimentLabel = item.sentiment > 0.3 ? '😊' : item.sentiment < -0.3 ? '😔' : '😐';
    parts.push(sentimentLabel);
  }
  if ('learned_by' in item && item.learned_by) {
    parts.push(`(via ${item.learned_by})`);
  }
  
  return parts.join(' | ');
}
```

### Edit Flow

```typescript
async function startItemEdit(itemName: string): Promise<CommandResult> {
  const entity = await loadHumanEntity();
  const { item, category } = findItemAcrossCategories(entity, itemName);
  
  if (!item) {
    return {
      response: `I couldn't find "${itemName}" in your data. Did you mean something else?`,
      switchToPersona: "ei"
    };
  }
  
  const formatted = JSON.stringify(item, null, 2);
  
  return {
    response: `Here's the current data for "${item.name}" (${category}):\n\n\`\`\`json\n${formatted}\n\`\`\`\n\nWhat would you like to change? You can:\n- Update the description\n- Change any values\n- Delete it entirely\n- Move it to a specific group`,
    switchToPersona: "ei",
    awaitFollowup: true,
    editContext: { itemName: item.name, category }
  };
}
```

### Processing Edits

Ei interprets natural language edit requests:

```typescript
async function processClarifyEdit(
  userMessage: string,
  context: { itemName: string; category: string }
): Promise<void> {
  // Use LLM to interpret the edit request
  const interpretation = await interpretEditRequest(userMessage, context);
  
  switch (interpretation.action) {
    case "update_description":
      await updateItemDescription(context.itemName, interpretation.newValue);
      break;
    case "update_field":
      await updateItemField(context.itemName, interpretation.field, interpretation.newValue);
      break;
    case "delete":
      await deleteItem(context.itemName, context.category);
      break;
    case "move_group":
      await moveItemToGroup(context.itemName, interpretation.group);
      break;
    case "unclear":
      // Ei asks for clarification
      break;
  }
}
```

### Special: Edit Persona Data

For editing the current persona's data (traits/topics), similar flow but targeting persona entity:

```
/clarify persona            # Edit current persona's data
/clarify persona:frodo      # Edit specific persona's data
```

## Acceptance Criteria

- [x] `/clarify` shows data overview
- [x] `/clarify [category]` shows category items
- [x] `/clarify "item"` starts specific item edit
- [ ] Natural language edits processed correctly (Ei handles via normal conversation)
- [ ] Delete functionality works (Ei handles via normal conversation)
- [ ] Move to group functionality works (Ei handles via normal conversation)
- [ ] Persona data editing works (deferred - not in initial scope)
- [x] Ei responds naturally throughout flow (switches to Ei, displays formatted data)
- [x] Tests cover main edit scenarios

## Implementation Notes

**Core Functionality Completed:**
- Command routing in `app.ts` with `/clarify` and `/c` alias
- Three main flows:
  1. Overview: `/clarify` - shows counts and sample items from all categories
  2. Category view: `/clarify facts|traits|topics|people` - shows full list with details
  3. Item edit: `/clarify "Name"` - displays item JSON and prompts for changes
- All flows switch to `ei` persona and display formatted system messages
- Help text updated with examples
- Unit tests added for data operations (`tests/unit/clarify-command.test.ts`)

**Natural Language Processing:**
The implementation intentionally defers natural language edit processing to Ei's existing conversational capabilities. When a user responds to a clarify prompt (e.g., "change the description to X"), Ei will process this as a regular message and can:
- Use the LLM to interpret the request
- Modify the human entity data
- Confirm changes back to the user

This approach leverages existing infrastructure instead of duplicating edit logic in the command handler.

**UI Flow:**
1. User types `/clarify` (or category/item variant)
2. App switches to `ei` persona automatically
3. System message displays formatted data
4. User responds naturally (e.g., "remove the Birthday fact")
5. Ei processes as normal conversation, updates data via existing extraction/validation systems

**Files Modified:**
- `src/blessed/app.ts`: Added command handler and three helper methods
- `tests/unit/clarify-command.test.ts`: Created unit tests for data operations

**Files Not Modified:**
This ticket intentionally does NOT implement:
- Dedicated edit interpretation logic (Ei handles this conversationally)
- Delete/move operations (handled by Ei via natural language)
- Persona data editing (future enhancement - ticket scope focuses on human data)

These features work through Ei's normal conversational abilities rather than requiring specialized command logic.

## Dependencies

- 0108: Entity type definitions
- 0109: Storage

## Effort Estimate

Medium-Large (~4-5 hours)
