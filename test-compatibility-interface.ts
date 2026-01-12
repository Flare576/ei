/**
 * Test Compatibility Interface for App Modularization
 * 
 * This interface defines all the private properties and methods that are currently
 * accessed by integration tests via @ts-ignore. These will be made public with
 * @deprecated tags to maintain test compatibility during the modularization process.
 * 
 * This is a temporary scaffolding interface that allows incremental module extraction
 * while preserving all existing test patterns.
 */

import blessed from 'blessed';
import type { Message, MessageState, PersonaState } from '../src/types.js';
import { LayoutManager } from '../src/blessed/layout-manager.js';
import { FocusManager } from '../src/blessed/focus-manager.js';
import { PersonaRenderer } from '../src/blessed/persona-renderer.js';
import { ChatRenderer } from '../src/blessed/chat-renderer.js';

/**
 * Test Compatibility Interface
 * 
 * Defines all properties and methods that need to be made public
 * for test compatibility during the modularization process.
 */
export interface ITestCompatibilityLayer {
  // === CORE COMPONENT PROPERTIES ===
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly layoutManager: LayoutManager;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly focusManager: FocusManager;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly personaRenderer: PersonaRenderer;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly chatRenderer: ChatRenderer;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly screen: blessed.Widgets.Screen;
  
  // === STATE PROPERTIES ===
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  isProcessing: boolean;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  inputHasText: boolean;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  statusMessage: string | null;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly personaStates: Map<string, PersonaState>;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  ctrlCWarningTimestamp: number | null;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly activePersona: string;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  readonly messages: Message[];
  
  // === CORE FUNCTIONALITY METHODS ===
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  cleanup(): { success: boolean; errors: string[] };
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  handleCommand(input: string): Promise<void>;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  render(): void;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  renderStatus(): void;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  getOrCreatePersonaState(name: string): PersonaState;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  setupScrollingKeyBindings(): void;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  handleSubmit(text: string): Promise<void>;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  handleCtrlC(): void;
  
  /** @deprecated For test compatibility only. Use public methods instead. */
  addMessage(role: 'human' | 'system', content: string, state?: MessageState): void;
}

/**
 * Deprecation Strategy Documentation
 * 
 * Each accessor in this interface follows a specific deprecation strategy:
 * 
 * 1. IMMEDIATE PHASE (Phase 1):
 *    - Make all private properties/methods public with @deprecated tags
 *    - Remove @ts-ignore from integration tests
 *    - Ensure TypeScript compilation succeeds with deprecation warnings
 * 
 * 2. EXTRACTION PHASE (Phase 2):
 *    - Extract modules while maintaining public accessors
 *    - Accessors delegate to extracted modules
 *    - Tests continue to work without modification
 * 
 * 3. MIGRATION PHASE (Future work, outside scope):
 *    - Gradually update tests to use public APIs
 *    - Remove deprecated accessors as tests are updated
 *    - Complete transition to proper encapsulation
 * 
 * PROPERTY-SPECIFIC DEPRECATION STRATEGIES:
 * 
 * Core Components (layoutManager, focusManager, personaRenderer, chatRenderer, screen):
 * - Strategy: Expose as readonly getters that return module instances
 * - Future: Tests should use public methods on the main app class instead
 * - Example: Instead of app.layoutManager.getLayoutType(), use app.getLayoutType()
 * 
 * State Properties (isProcessing, inputHasText, statusMessage, etc.):
 * - Strategy: Expose as getters/setters that delegate to internal state
 * - Future: Tests should use public state query methods
 * - Example: Instead of app.isProcessing, use app.getProcessingState()
 * 
 * Collection Properties (personaStates, messages):
 * - Strategy: Expose as readonly getters that return copies or readonly views
 * - Future: Tests should use public query methods
 * - Example: Instead of app.personaStates.get(), use app.getPersonaState()
 * 
 * Core Methods (cleanup, handleCommand, render, etc.):
 * - Strategy: Make public directly with deprecation warnings
 * - Future: Tests should use public API methods or test external behavior
 * - Example: Instead of app.cleanup(), tests should verify proper shutdown behavior
 * 
 * IMPLEMENTATION NOTES:
 * 
 * - All deprecated accessors MUST include JSDoc @deprecated tags
 * - All deprecated accessors MUST include usage guidance in comments
 * - TypeScript compilation MUST succeed with only deprecation warnings
 * - No breaking changes to existing test behavior during extraction
 * - Each module extraction step MUST preserve accessor functionality
 * 
 * VALIDATION CRITERIA:
 * 
 * - All integration tests pass without @ts-ignore
 * - TypeScript compilation shows deprecation warnings but no errors
 * - Test behavior is identical before and after each extraction step
 * - Deprecated accessors continue to work throughout extraction process
 * - Clear documentation exists for future test migration path
 */

/**
 * Module Extraction Compatibility Notes
 * 
 * When extracting modules, the following patterns will be used to maintain
 * test compatibility:
 * 
 * COMMAND HANDLER EXTRACTION:
 * - handleCommand() accessor delegates to CommandHandler.executeCommand()
 * - Maintains identical error handling and status updates
 * - Tests continue to work without modification
 * 
 * PERSONA MANAGER EXTRACTION:
 * - personaStates getter delegates to PersonaManager.getPersonaStates()
 * - getOrCreatePersonaState() delegates to PersonaManager.getOrCreatePersonaState()
 * - activePersona getter delegates to PersonaManager.getCurrentPersona()
 * - Tests continue to work without modification
 * 
 * MESSAGE PROCESSOR EXTRACTION:
 * - isProcessing getter delegates to MessageProcessor.isAnyProcessing()
 * - addMessage() delegates to MessageProcessor.addMessage()
 * - Tests continue to work without modification
 * 
 * TEST SUPPORT EXTRACTION:
 * - Test input injection methods remain on main app class
 * - TestSupport module handles implementation details
 * - E2E test compatibility preserved
 * 
 * UI COMPONENT INTEGRATION:
 * - Component getters (layoutManager, focusManager, etc.) return module instances
 * - render() and renderStatus() coordinate between modules
 * - Screen and UI element access preserved for tests
 */