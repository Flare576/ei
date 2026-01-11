# Design Document: Blessed Migration

## Overview

This design outlines the migration from Ink to Blessed framework for the EI terminal user interface. The migration addresses fundamental issues with text rendering, scrolling, and layout management while preserving all existing functionality. The Blessed prototype (`src/blessed-prototype.ts`) serves as the foundation, requiring focused improvements to achieve feature parity with the Ink implementation.

## CRITICAL LESSON LEARNED

**DO NOT port Ink code directly to Blessed.** The Ink implementation uses complex manual text wrapping, layout calculations, and React-style component management that fundamentally conflicts with Blessed's native approach. 

**Key Insight**: Ink and Blessed have completely different philosophies:
- **Ink**: Manual control over every aspect of layout and rendering
- **Blessed**: Native terminal widgets that handle layout, scrolling, and text wrapping automatically

**Result**: When we simplified the blessed implementation to use native blessed methods instead of porting Ink's complex logic, scrolling immediately worked perfectly.

**Future Development Rule**: Use Ink components only as **reference for functionality**, never as **source code to port**. Always implement features using Blessed's native capabilities first.

## Architecture

### Current State Analysis

**Blessed Prototype Strengths:**
- Native text wrapping eliminates manual width calculations
- Built-in scrolling support with `scrollable: true, alwaysScroll: true`
- Responsive layout system with breakpoints (Full: 100+ cols, Medium: 60-99, Compact: <60)
- Simplified codebase (~400 lines vs 500+ lines of Ink complexity)
- All core business logic successfully integrated (processor, storage, heartbeats)

**Ink Implementation Issues:**
- Text corruption from manual line width calculations
- Broken scrolling that can't access full chat history
- Height constraint conflicts causing content truncation
- Complex manual layout management prone to failures
- Focus management complications with React/Ink lifecycle

### Migration Strategy

The migration follows a **replacement approach** rather than gradual transition:

1. **Polish Blessed prototype** to address known issues
2. **Achieve feature parity** with Ink implementation
3. **Replace entry point** to use Blessed instead of Ink
4. **Clean up dependencies** and remove Ink components

## Components and Interfaces

### Core Application Class

```typescript
class EIApp {
  // UI Components
  private screen: blessed.Widgets.Screen;
  private personaList: blessed.Widgets.BoxElement;
  private chatHistory: blessed.Widgets.BoxElement;
  private inputBox: blessed.Widgets.TextboxElement;
  private statusBar: blessed.Widgets.BoxElement;
  
  // Business Logic State (preserved from Ink)
  private personas: any[];
  private activePersona: string;
  private messages: Message[];
  private personaStates: Map<string, PersonaState>;
  private isProcessing: boolean;
  private unreadCounts: Map<string, number>;
}
```

### Layout System

**Responsive Breakpoints:**
- **Full Layout** (≥100 cols): Three-pane with persona list, chat history, input
- **Medium Layout** (60-99 cols): Horizontal persona bar, chat history, input
- **Compact Layout** (<60 cols): Chat history with persona in title, input only

**Layout Recreation Strategy:**
```typescript
private createLayout() {
  const width = this.screen.width;
  const layoutType = width >= LAYOUT_FULL_MIN_COLS ? 'full' 
    : width >= LAYOUT_MEDIUM_MIN_COLS ? 'medium' 
    : 'compact';
  
  // Recreate all UI elements based on layout type
  // Blessed handles this more reliably than Ink
}
```

### Focus Management System

**Current Issues:**
1. Input focus lost after sending regular messages
2. Post-resize input corruption (text invisible but cursor moves)

**Proposed Solution:**
```typescript
private maintainFocus() {
  // Only refocus if actually lost focus
  if (!this.inputBox.focused) {
    this.inputBox.focus();
  }
}

// Preserve input state across resize events
private handleResize() {
  const currentValue = this.inputBox.getValue();
  this.createLayout();
  this.inputBox.setValue(currentValue);
  this.maintainFocus();
  this.render();
}
```

**Future Navigation Compatibility:**
The focus management system will be designed to support future Ctrl+[hjkl] navigation between panes without requiring architectural changes.

## Data Models

### Existing Type Integration

The Blessed implementation will use existing types from `src/types.ts` to maintain consistency:

```typescript
// From src/types.ts - reuse existing interfaces
import type { Message, MessageState } from './types.js';

// PersonaState interface - already defined in prototype, matches Ink version
interface PersonaState {
  name: string;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  isProcessing: boolean;        // Used for thinking indicators
  messageQueue: string[];
  unreadCount: number;
  abortController: AbortController | null;
}
```

**File Handling Isolation:**
All file operations will continue to use existing `src/storage.ts` functions. The UI layer (Blessed) will never directly touch files, maintaining clean separation between presentation and data layers.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

<function_calls>
<invoke name="prework">
<parameter name="featureName">blessed-migration

### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties can be consolidated:

**Consolidation Opportunities:**
- Properties 1.1-1.5 (core functionality) are all distinct and necessary
- Properties 2.1-2.2 (focus after messages/commands) can be combined into one comprehensive focus persistence property
- Properties 2.3-2.5 (resize and UI update focus handling) are distinct edge cases
- Properties 3.1-3.2 (specific scrolling examples) remain as examples
- Properties 4.1-4.5 (thinking indicators) are all distinct aspects of indicator management
- Properties 5.1-5.3 (layout examples) remain as examples
- Properties 5.4-5.5 (resize handling) are distinct aspects

**Final Property Set:**
The analysis shows most properties provide unique validation value and should be retained.

### Converting EARS to Properties

Based on the prework analysis, here are the testable correctness properties:

**Property 1: Persona switching updates UI state**
*For any* valid persona name, switching to that persona should update the active persona state and refresh all UI elements to reflect the new persona
**Validates: Requirements 1.1**

**Property 2: Message processing preserves system responsiveness**
*For any* valid message input, sending the message should result in processing and response display without blocking the UI
**Validates: Requirements 1.2**

**Property 3: Background processing maintains system responsiveness**
*For any* persona processing in the background, the system should continue accepting input and allow persona switching without interruption
**Validates: Requirements 1.3**

**Property 4: Unread count accuracy**
*For any* persona with unread messages, the persona list should display the exact count of unread messages for that persona
**Validates: Requirements 1.4**

**Property 5: Heartbeat independence**
*For any* set of personas, heartbeat timers should trigger independently for each persona without affecting others
**Validates: Requirements 1.5**

**Property 6: Focus persistence after input**
*For any* message or command input, the input box should maintain focus after processing to allow immediate next input
**Validates: Requirements 2.1, 2.2**

**Property 7: Resize state preservation**
*For any* input state and terminal resize event, the input box should preserve its content and maintain focus after the resize
**Validates: Requirements 2.3**

**Property 8: Focus recovery**
*For any* focus loss event, the system should automatically restore focus to the input box while preserving navigation capabilities
**Validates: Requirements 2.4**

**Property 9: UI update responsiveness**
*For any* UI update event, the input box should remain responsive to keyboard input throughout the update
**Validates: Requirements 2.5**

**Property 10: Auto-scroll on new messages for active persona**
*For any* new message arrival for the active persona, the chat history should automatically scroll to display the latest message, but should not auto-scroll for inactive persona messages
**Validates: Requirements 3.5**

**Property 11: Thinking indicator display**
*For any* persona in processing state, the persona list should display a thinking indicator for that specific persona
**Validates: Requirements 4.1**

**Property 12: Thinking indicator removal**
*For any* persona completing processing, the system should remove the thinking indicator from the persona list
**Validates: Requirements 4.2**

**Property 13: Multiple thinking indicators**
*For any* set of personas processing simultaneously, the persona list should show individual thinking indicators for each active persona
**Validates: Requirements 4.3**

**Property 14: Thinking indicator formatting**
*For any* combination of thinking indicators, the persona list should maintain readable formatting and clear persona identification
**Validates: Requirements 4.4**

**Property 15: Combined status display**
*For any* persona with both unread messages and thinking indicators, the persona list should clearly display both status types
**Validates: Requirements 4.5**

**Property 16: Layout responsiveness**
*For any* terminal resize event, the system should immediately update the layout without text corruption or display issues
**Validates: Requirements 5.4**

**Property 17: Layout state preservation**
*For any* UI state and layout change, the system should preserve all functionality and state information
**Validates: Requirements 5.5**

**Property 18: Business logic preservation**
*For any* business operation, the Blessed implementation should produce identical results to the Ink implementation
**Validates: Requirements 6.3**

**Property 19: UI file handling isolation**
*For any* data operation, the UI layer should use storage.ts functions and never directly access files, maintaining clean separation between presentation and data layers
**Validates: Requirements 6.4**

## Error Handling

### Focus Management Errors
- **Input focus loss**: Automatic recovery with `maintainFocus()` method
- **Post-resize corruption**: Input state preservation across layout recreation
- **Navigation conflicts**: Future-compatible focus management for pane navigation

### Scrolling Boundary Conditions
- **Top boundary**: Prevent scrolling beyond first message
- **Bottom boundary**: Prevent scrolling beyond last message  
- **Empty history**: Graceful handling of empty chat history

### Layout Adaptation Errors
- **Extreme terminal sizes**: Graceful degradation for very small terminals
- **Rapid resize events**: Debounced layout recreation to prevent flicker
- **Content overflow**: Blessed's native text wrapping handles overflow

### Processing State Errors
- **Thinking indicator sync**: Ensure indicators match actual processing state
- **Multiple status conflicts**: Clear precedence rules for combined status display
- **State persistence**: Maintain processing state across UI updates

## Testing Strategy

### Dual Testing Approach

**Unit Tests:**
- Focus management edge cases (resize, focus loss, recovery)
- Layout calculation logic for different terminal sizes
- Thinking indicator state management
- Scrolling boundary conditions
- Input state preservation across events

**Property-Based Tests:**
- Universal properties across all inputs using fast-check library
- Minimum 100 iterations per property test
- Each test tagged with: **Feature: blessed-migration, Property {number}: {property_text}**

**Integration Testing:**
- End-to-end persona switching workflows
- Multi-persona concurrent processing scenarios
- Layout adaptation across terminal size ranges
- Focus management during complex user interactions

**Manual Validation:**
- Visual verification of thinking indicators
- Scrolling behavior with real chat history
- Resize handling with active input
- Overall user experience compared to Ink version

### Testing Configuration

**Property-Based Testing Library:** fast-check (TypeScript/JavaScript)
**Test Runner:** Vitest (existing project standard)
**Minimum Iterations:** 100 per property test
**Test Organization:** Co-located with source files using `.test.ts` suffix

**Example Property Test Structure:**
```typescript
import fc from 'fast-check';

// Feature: blessed-migration, Property 1: Persona switching updates UI state
test('persona switching updates UI state', () => {
  fc.assert(fc.property(
    fc.string().filter(s => s.trim().length > 0), // persona name
    (personaName) => {
      // Test that switching to personaName updates UI state correctly
      const result = switchPersona(personaName);
      expect(result.activePersona).toBe(personaName);
      expect(result.uiUpdated).toBe(true);
    }
  ), { numRuns: 100 });
});
```

### Implementation Validation

**Code Quality Metrics:**
- Line count reduction compared to Ink implementation
- Cyclomatic complexity reduction in UI logic
- Elimination of manual layout calculations
- Reduced dependency on React/Ink lifecycle management

**Performance Benchmarks:**
- Layout recreation time during resize events
- Scrolling responsiveness with large chat histories
- Memory usage compared to Ink implementation
- Focus management latency

**Compatibility Verification:**
- Keyboard shortcuts work comparatively well (not forcing Ink patterns on Blessed)
- All existing commands produce same results
- File handling remains isolated through storage.ts
- Environment variable handling preserved

### Code Organization Strategy

**File Size Management:**
The current prototype (~600 lines) will be split into focused, testable modules following Blessed best practices:

```
src/blessed/
  ├── app.ts              # Main application class (~200 lines)
  ├── layout-manager.ts   # Responsive layout logic (~150 lines)
  ├── focus-manager.ts    # Focus and input handling (~100 lines)
  ├── persona-renderer.ts # Persona list rendering (~100 lines)
  └── chat-renderer.ts    # Chat history rendering (~100 lines)
```

**Benefits:**
- Each module has single responsibility
- Easier testing of individual components
- Reduced context explosion for future development
- Clear separation of concerns
- Follows Blessed architectural patterns