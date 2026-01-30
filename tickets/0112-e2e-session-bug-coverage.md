# 0112: E2E Session Bug Coverage

**Status**: PENDING
**Depends on**: 0031 (Playwright Configuration)

## Summary

Add E2E tests covering bugs discovered and fixed during the E008 Entity Management UI epic session.

## Background

During a marathon session fixing E008 bugs, several subtle issues were discovered that only manifest through UI interaction. These should have E2E coverage to prevent regression.

## Test Cases

### 1. Archive Flow (High Priority)
**Bug fixed**: Archived personas weren't filtered from the persona list

```gherkin
Given a persona "TestPersona" exists
When I hover over "TestPersona" and click Archive
Then "TestPersona" should not appear in the persona list
When I click "View Archived"
Then "TestPersona" should appear in the archived modal
When I click "Unarchive" on "TestPersona"
Then "TestPersona" should appear in the persona list again
```

### 2. Unread Count Flow (High Priority)
**Bug fixed**: `unread_count` was hardcoded to 0; race condition with IntersectionObserver

```gherkin
Given personas "Alice" and "Bob" exist
And I select "Alice"
When I send a message and wait for response
And I switch to "Bob"
Then "Alice" badge should show 0 (marked read on leave)
When I send a message to "Bob" and wait for response
And I switch to "Alice"
Then "Bob" badge should show unread count > 0
When I switch back to "Bob"
Then "Bob" badge should show 0
```

### 3. Persona Generation Live Update (High Priority)
**Bug fixed**: Edit panel didn't refresh when `onPersonaUpdated` fired

```gherkin
Given I open the persona creator
When I fill in name "NewPersona" and description
And I submit the form
And I immediately open the edit panel for "NewPersona"
And I wait for generation to complete
Then the edit panel should show generated short_description
And the edit panel should show generated traits
And the edit panel should show generated topics
```

### 4. Bulk Context Status Update (High Priority)
**Bug fixed**: React mutation bug caused only first 2 rows to visually update

```gherkin
Given I open the persona editor for a persona with 10+ messages
And I navigate to the Context tab
When I select "Never" from the bulk dropdown
And I click "Apply"
Then ALL visible message rows should show "Never" status
```

### 5. Persona Pause/Unpause (Medium Priority)

```gherkin
Given persona "TestPersona" exists and is selected
When I hover and click "Pause"
Then the persona should show paused indicator
When I send a message
Then the message should show as pending (not processed)
When I unpause the persona
Then the message should be processed
```

### 6. Human Editor Round-Trip (Medium Priority)

```gherkin
Given I open the Human editor
When I modify a fact's description
And I click Save
And I close the editor
And I reopen the Human editor
Then the fact should show my modified description
```

## Acceptance Criteria

- [ ] Archive flow test passes
- [ ] Unread count flow test passes
- [ ] Persona generation live update test passes
- [ ] Bulk context status test passes
- [ ] Pause/unpause test passes (stretch)
- [ ] Human editor round-trip test passes (stretch)

## Notes

These tests require:
- Mock LLM server (already exists from 0012)
- Ability to wait for async operations (persona generation, message processing)
- Multiple persona fixtures

Priority order: 1, 2, 4, 3, 5, 6 (based on bug severity and likelihood of regression)
