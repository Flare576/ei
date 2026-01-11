# Implementation Plan: Blessed Migration

## Overview

This plan converts the Blessed prototype into a production-ready replacement for the Ink implementation, focusing on fixing known issues, adding missing features, and organizing code for maintainability.

## Tasks

- [x] 1. Fix focus management issues in prototype
  - Debug and fix input focus loss after sending regular messages
  - Fix post-resize input corruption where text becomes invisible
  - Implement robust focus recovery that preserves future navigation capabilities
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 1.1 Write property tests for focus management
  - **Property 6: Focus persistence after input**
  - **Property 7: Resize state preservation**
  - **Property 8: Focus recovery**
  - **Property 9: UI update responsiveness**
  - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 2. Implement scrolling functionality
  - Add PageUp/PageDown key handlers for chat history scrolling
  - Implement scroll boundary detection (top/bottom of history)
  - Add auto-scroll for new messages from active persona only
  - Use Blessed's native scrolling: `chatHistory.scroll(-5)` / `chatHistory.scroll(5)`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2.1 Write property tests for scrolling
  - **Property 10: Auto-scroll on new messages for active persona**
  - **Validates: Requirements 3.5**

- [x] 2.2 Write unit tests for scrolling edge cases
  - Test PageUp/PageDown specific behavior (examples)
  - Test boundary conditions (edge cases)
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Add thinking indicators to persona list
  - Show processing state in persona rendering for each persona
  - Format indicators clearly: `> ei 30m [thinking]` or similar
  - Handle multiple simultaneous thinking indicators
  - Ensure indicators work with unread counts
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3.1 Write property tests for thinking indicators
  - **Property 11: Thinking indicator display**
  - **Property 12: Thinking indicator removal**
  - **Property 13: Multiple thinking indicators**
  - **Property 14: Thinking indicator formatting**
  - **Property 15: Combined status display**
  - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 4. Checkpoint - Test prototype improvements
  - Ensure all focus issues are resolved
  - Verify scrolling works with real chat history
  - Confirm thinking indicators display correctly
  - Test resize handling preserves all functionality

- [x] 5. Refactor prototype into modular architecture
  - Create `src/blessed/` directory structure
  - Split main class into focused modules: app.ts, layout-manager.ts, focus-manager.ts, persona-renderer.ts, chat-renderer.ts
  - Each module should be ~100-200 lines maximum
  - Maintain all existing functionality during refactor
  - _Requirements: 6.5_

- [x] 5.1 Write property tests for core functionality preservation
  - **Property 1: Persona switching updates UI state**
  - **Property 2: Message processing preserves system responsiveness**
  - **Property 3: Background processing maintains system responsiveness**
  - **Property 4: Unread count accuracy**
  - **Property 5: Heartbeat independence**
  - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

- [x] 5.2 Write property tests for layout system
  - **Property 16: Layout responsiveness**
  - **Property 17: Layout state preservation**
  - **Validates: Requirements 5.4, 5.5**

- [x] 5.3 Write unit tests for layout examples
  - Test full layout (100+ columns)
  - Test medium layout (60-99 columns)  
  - Test compact layout (<60 columns)
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Integrate existing types and maintain file handling isolation
  - Import and use types from `src/types.ts`
  - Ensure all file operations go through `src/storage.ts` functions
  - Verify no direct file system access in UI code
  - _Requirements: 6.3, 6.4_

- [x] 6.1 Write property tests for business logic preservation
  - **Property 18: Business logic preservation**
  - **Property 19: UI file handling isolation**
  - **Validates: Requirements 6.3, 6.4**

- [x] 7. Replace main entry point
  - Update `src/index.tsx` to use Blessed implementation instead of Ink
  - Preserve all existing command-line argument handling
  - Maintain environment variable support
  - Ensure graceful startup and shutdown
  - _Requirements: 6.1_

- [x] 8. Clean up Ink dependencies
  - Remove Ink and React dependencies from package.json
  - Remove `src/components/` directory (Ink components)
  - Update any remaining imports or references
  - _Requirements: 6.2_

- [x] 9. Final integration testing
  - Test all persona switching workflows end-to-end
  - Verify multi-persona concurrent processing
  - Test all keyboard shortcuts and commands
  - Confirm layout adaptation across terminal sizes
  - Validate thinking indicators with real processing

- [x] 9.1 Write integration tests
  - Test complete user workflows
  - Test error handling and edge cases
  - Test concurrent processing scenarios

- [ ] 10. Final checkpoint - Ensure feature parity
  - Compare functionality with original Ink version
  - Verify all acceptance criteria are met
  - Confirm code organization follows Blessed best practices
  - Validate performance and user experience improvements

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Focus on fixing prototype issues before architectural changes
- Maintain existing business logic throughout migration