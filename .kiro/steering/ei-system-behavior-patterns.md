# EI System Behavior Patterns

## Critical System Characteristics

These are fundamental behaviors of the EI system that affect testing, development, and user experience.

### 1. LLM Request Patterns

**Every message or heartbeat triggers 3-4 LLM calls:**

#### Standard Pattern (3 calls):
1. **Main Response Generation** - `callLLM()` for user-facing response
2. **System Concept Updates** - `callLLMForJSON()` to update system concept map
3. **Human Concept Updates** - `callLLMForJSON()` to update human concept map

#### Extended Pattern (4 calls):
- **Optional 4th call** triggered when System Concept Map call adds, removes, or modifies concept descriptions
- This happens when the system learns something new about itself or the conversation context

#### Implementation Location:
- **File**: `src/processor.ts`
- **Lines**: 118 (main response), 140 (system concepts), 159 (human concepts)
- **Conditional 4th call**: Triggered by concept map validation logic

#### Testing Implications:
- **E2E Tests**: Must provide 3-4 mock responses per message interaction
- **Integration Tests**: Expect multiple `processEvent` calls for concept updates
- **Performance**: Each user message has 3-4x LLM overhead
- **Mock Queues**: Use `harness.setMockResponseQueue()` with sufficient responses

### 2. Message Debouncing Behavior

**The system debounces short incoming messages:**

#### Threshold Behavior:
- **Immediate Processing**: Messages ≥ 30 characters (`COMPLETE_THOUGHT_LENGTH`)
- **Debounced Processing**: Messages < 30 characters wait 2000ms for additional input
- **Rationale**: Prevents incomplete thoughts from triggering expensive LLM processing

#### Implementation Location:
- **File**: `src/blessed/app.ts`
- **Constant**: `COMPLETE_THOUGHT_LENGTH = 30`
- **Debounce Timer**: 2000ms delay for short messages

#### User Experience Impact:
- **Short messages**: "Hi" → 2-second delay before processing
- **Complete messages**: "Hello, how are you today?" → immediate processing
- **Partial typing**: System waits for user to complete their thought

#### Testing Implications:
- **E2E Tests**: Use messages >30 chars for immediate processing
- **Integration Tests**: Account for debounce delays in timing assertions
- **Mock Timing**: Short messages require `waitForLLMRequest()` with >2000ms timeout
- **Test Messages**: Use descriptive messages like "This is a test message that exceeds the thirty character threshold"

#### Development Considerations:
- **Framework Adjustment**: Consider exposing debounce settings for test environments
- **Documentation**: User guides should explain why short messages have delays
- **UX Enhancement**: Consider showing "thinking..." indicator during debounce period

## Testing Strategy Recommendations

### For E2E Tests:
```typescript
// Good: Immediate processing
await harness.sendInput('This message is long enough to trigger immediate LLM processing');

// Problematic: Will be debounced
await harness.sendInput('Hi'); // Only 2 chars - 2 second delay
```

### For Integration Tests:
```typescript
// Account for LLM call multiplicity
vi.mocked(processEvent).mockResolvedValue({
  response: 'Main response',
  aborted: false,
  humanConceptsUpdated: false,    // May trigger 4th call if true
  systemConceptsUpdated: false    // May trigger 4th call if true
});
```

### For Mock Setup:
```typescript
// Provide sufficient responses for 3-4 calls per interaction
harness.setMockResponseQueue([
  'User response 1', 'System concepts 1', 'Human concepts 1',  // Message 1
  'User response 2', 'System concepts 2', 'Human concepts 2',  // Message 2
  // Optional 4th responses if concept descriptions change
]);
```

## Future Considerations

### Potential Improvements:
1. **Configurable Debounce**: Make `COMPLETE_THOUGHT_LENGTH` and debounce timer configurable
2. **Test Mode**: Disable debouncing in test environments for faster test execution
3. **User Feedback**: Show typing indicators or "completing thought..." messages during debounce
4. **Adaptive Thresholds**: Learn user's typical message patterns to adjust thresholds

### Documentation Needs:
1. **User Guide**: Explain why short messages have delays
2. **Developer Guide**: Document LLM call patterns for integration work
3. **Test Guide**: Provide examples of proper test message construction
4. **API Documentation**: Document the 3-4 call pattern for external integrations

## Impact on Development

### When Adding Features:
- Consider LLM call multiplicity in cost/performance calculations
- Account for debouncing in user interaction flows
- Test with both short and long messages

### When Writing Tests:
- Use realistic message lengths (>30 chars for immediate processing)
- Provide adequate mock responses (3-4 per interaction)
- Account for timing delays in assertions

### When Debugging:
- Check for concept map updates when investigating extra LLM calls
- Consider debounce timing when messages seem "stuck"
- Monitor LLM request patterns to understand system behavior

This document should be updated as these patterns evolve or new behavioral characteristics are discovered.