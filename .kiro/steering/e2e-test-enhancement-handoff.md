# E2E Test Enhancement Project - Handoff Document

## Project Overview

**Objective**: Systematically enhance all existing E2E tests to use the new blessed output capture system for reliable UI validation, fixing any failing tests in the process.

**Context**: We have successfully implemented a complete E2E testing infrastructure with:
- ✅ Input injection system (`EI_TEST_INPUT=true`)
- ✅ Output capture system (`EI_TEST_OUTPUT=true`) 
- ✅ Mock LLM system with proper 3-4 call patterns
- ✅ Proof-of-concept test demonstrating full integration

## Current State

### Test Suite Status
- **Unit Tests**: 129/129 passing (100%)
- **Integration Tests**: 102/102 passing (100%)
- **E2E Tests**: Infrastructure complete, individual tests need enhancement

### Key Infrastructure Components
- **Test Output Capture**: `src/blessed/test-output-capture.ts` - Intercepts blessed rendering
- **E2E Framework**: `tests/e2e/framework/harness.ts` - Enhanced with output capture methods
- **Working Template**: `tests/e2e/scenarios/basic-message-handling.e2e.test.ts` - Demonstrates best practices

## Project Plan: E2E Test Enhancement

### Phase 1: Test Inventory and Assessment

**Task**: Create comprehensive inventory of all E2E tests and their current status.

**Sub-agent Instructions**:
1. **List all E2E test files** in `tests/e2e/scenarios/`
2. **Categorize each test** by purpose:
   - UI validation tests (need output capture)
   - Process lifecycle tests (may not need output capture)
   - Command/interaction tests (likely need output capture)
   - Framework validation tests (infrastructure only)
3. **Run each test individually** to determine current status (passing/failing)
4. **Document test purpose** and whether output validation would add value

**Deliverable**: `e2e-test-inventory.md` with status and enhancement recommendations for each test.

### Phase 2: Fix Failing Tests

**Task**: Systematically fix all failing E2E tests before adding enhancements.

**Sub-agent Instructions for Each Failing Test**:
1. **Analyze failure root cause** - Is it test logic, timing, mock setup, or real app bug?
2. **Apply established patterns**:
   - Use messages >30 chars to avoid debouncing
   - Provide 3-4 mock responses per message interaction
   - Fix environment variable propagation issues
   - Correct test expectations vs actual app behavior
3. **Verify fix** by running test until it passes consistently
4. **Document the fix** and any insights discovered

**Success Criteria**: All E2E tests pass before moving to enhancement phase.

### Phase 3: Add Output Validation

**Task**: Enhance passing tests with blessed output capture validation where appropriate.

**Sub-agent Instructions for Each Test**:
1. **Evaluate if output validation adds value**:
   - Does the test verify UI content or user-visible behavior?
   - Would output validation catch regressions the current test misses?
   - Is the test about process lifecycle only (startup/shutdown)?
2. **If appropriate, add output validation**:
   - Use `harness.waitForCapturedUIText()` for specific content
   - Use `harness.getCapturedUIContent()` for general validation
   - Verify user input appears in captured output
   - Check for expected responses in UI
3. **Maintain existing test logic** - Add output validation as additional verification, don't replace existing checks
4. **Test thoroughly** - Ensure enhanced test passes consistently

**Enhancement Patterns**:
```typescript
// Add after existing test logic
const capturedOutput = await harness.getCapturedUIContent();
expect(capturedOutput).toContain('expected UI content');

// Or wait for specific content
await harness.waitForCapturedUIText('specific text', 5000);
```

## Technical Guidelines

### EI System Behavior (Critical for Test Design)

**LLM Request Patterns**:
- Every message/heartbeat triggers 3-4 LLM calls
- Standard: Response + System concepts + Human concepts
- Optional 4th call if concept descriptions change

**Message Debouncing**:
- Messages ≥30 characters: Immediate processing
- Messages <30 characters: 2000ms debounce delay
- Use longer messages in tests to avoid timing issues

**Environment Variables**:
- `EI_TEST_INPUT=true`: Enables input injection
- `EI_TEST_OUTPUT=true`: Enables blessed output capture
- `NODE_ENV=test`: Activates test mode

### Test Enhancement Best Practices

**When to Add Output Validation**:
- ✅ Tests that verify user interactions (message sending, commands)
- ✅ Tests that check UI state changes (persona switching, status updates)
- ✅ Tests that validate content display (responses, error messages)
- ❌ Tests focused only on process lifecycle (startup/shutdown timing)
- ❌ Tests that only verify file system changes
- ❌ Framework validation tests (infrastructure only)

**Output Validation Patterns**:
```typescript
// Pattern 1: Verify user input appears
const userMessage = 'Test message that exceeds thirty character threshold';
await harness.sendInput(`${userMessage}\n`);
const output = await harness.getCapturedUIContent();
expect(output).toContain(userMessage.slice(0, 20));

// Pattern 2: Wait for specific response
await harness.waitForCapturedUIText('Expected response text', 5000);

// Pattern 3: Verify UI state changes
await harness.sendCommand('/persona claude');
await harness.waitForCapturedUIText('Switched to persona: claude', 3000);
```

**Mock Response Setup**:
```typescript
// Always provide 3-4 responses per message
harness.setMockResponseQueue([
  'User-facing response',
  JSON.stringify([/* system concepts */]),
  JSON.stringify([/* human concepts */])
  // Optional 4th response if concepts change
]);
```

## File Locations and Key Resources

### Core Infrastructure
- `src/blessed/test-output-capture.ts` - Output capture implementation
- `tests/e2e/framework/harness.ts` - E2E test framework with capture methods
- `.kiro/steering/ei-system-behavior-patterns.md` - System behavior documentation

### Working Examples
- `tests/e2e/scenarios/basic-message-handling.e2e.test.ts` - Complete working template
- `tests/e2e/test-output-capture.test.ts` - Output capture system demonstration

### Documentation
- `blessed-test-output-capture-summary.md` - Implementation details
- `integration-test-refactor-summary.md` - Integration test patterns
- `e2e-test-failure-analysis.md` - Common failure patterns and fixes

## Success Criteria

### Phase 1 Complete
- [ ] Complete inventory of all E2E tests with status and recommendations
- [ ] Clear categorization of which tests need output validation
- [ ] Baseline understanding of current test suite state

### Phase 2 Complete  
- [ ] All E2E tests pass consistently
- [ ] Root causes of failures documented and resolved
- [ ] Test infrastructure issues identified and fixed

### Phase 3 Complete
- [ ] All appropriate tests enhanced with output validation
- [ ] Enhanced tests pass consistently and provide better coverage
- [ ] Template patterns established for future E2E test development

### Overall Project Success
- [ ] Comprehensive E2E test suite with reliable UI validation
- [ ] Reduced false positives from escape sequence parsing issues
- [ ] Increased confidence in UI behavior validation
- [ ] Clear patterns for future E2E test development

## Handoff Notes

### Context Preservation
- All technical insights documented in steering files
- System behavior patterns captured for future reference
- Working examples provide templates for enhancement patterns

### Next Agent Instructions
1. **Start with Phase 1** - Create comprehensive test inventory
2. **Use sub-agents systematically** - One sub-agent per test file for focused analysis
3. **Follow established patterns** - Use working examples as templates
4. **Document discoveries** - Update steering files with new insights
5. **Test thoroughly** - Ensure all changes result in consistently passing tests

### Key Success Factors
- **Systematic approach** - Handle one test at a time to avoid overwhelming changes
- **Pattern consistency** - Use established patterns from working examples
- **Thorough testing** - Verify each enhancement works reliably
- **Documentation** - Capture insights for future development

This project will result in a world-class E2E test suite that provides reliable UI validation without the maintenance burden of escape sequence parsing or blessed mocking.