/**
 * Module interfaces for the EI App modularization
 * 
 * These interfaces define clean contracts between modules extracted from
 * the monolithic app.ts file. They ensure proper separation of concerns
 * and prevent breaking changes during refactoring.
 */

import type { PersonaState, Message, MessageState } from '../types.js';
import type blessed from 'blessed';

// ============================================================================
// Command Handler Module Interface
// ============================================================================

/**
 * Parsed command structure returned by command parsing
 */
export interface ParsedCommand {
  type: 'persona' | 'quit' | 'refresh' | 'help';
  args: string[];
  raw: string;
}

/**
 * Command Handler interface - responsible for parsing and executing user commands
 * 
 * Handles all commands starting with "/" including:
 * - /persona <name> - Switch to a different persona
 * - /quit [--force] - Exit the application
 * - /refresh - Refresh the UI
 * - /help - Show help text
 */
export interface ICommandHandler {
  /**
   * Parse user input to extract command and arguments
   * @param input - Raw user input string
   * @returns Parsed command object or null if not a command
   */
  parseCommand(input: string): ParsedCommand | null;

  /**
   * Execute a parsed command
   * @param command - Parsed command to execute
   * @returns Promise that resolves when command execution is complete
   */
  executeCommand(command: ParsedCommand): Promise<void>;

  /**
   * Get help text for all available commands
   * @returns Formatted help text string
   */
  getHelpText(): string;
}

// ============================================================================
// Persona Manager Module Interface
// ============================================================================

/**
 * Persona Manager interface - responsible for persona state and switching
 * 
 * Manages the PersonaState map, handles persona switching, tracks unread counts,
 * and coordinates with the UI layer for persona list rendering.
 */
export interface IPersonaManager {
  /**
   * Initialize the persona manager with persona list
   * @param personas - Array of persona objects
   */
  initialize(personas: any[]): Promise<void>;

  /**
   * Switch to a different persona
   * @param name - Name of the persona to switch to
   * @returns Promise that resolves with recent messages when switch is complete
   */
  switchPersona(name: string): Promise<Message[]>;

  /**
   * Get the currently active persona name
   * @returns Current persona name
   */
  getCurrentPersona(): string;

  /**
   * Get persona state for a specific persona
   * @param name - Persona name
   * @returns PersonaState object
   */
  getPersonaState(name: string): PersonaState;

  /**
   * Update unread count for a persona
   * @param persona - Persona name
   * @param delta - Change in unread count (can be negative)
   */
  updateUnreadCount(persona: string, delta: number): void;

  /**
   * Get all persona states
   * @returns Map of persona names to PersonaState objects
   */
  getAllPersonaStates(): Map<string, PersonaState>;

  /**
   * Get unread counts for all personas
   * @returns Map of persona names to unread counts
   */
  getUnreadCounts(): Map<string, number>;

  /**
   * Get list of all available personas
   * @returns Array of persona objects
   */
  getPersonas(): any[];

  /**
   * Set the active persona (internal state only, no switching logic)
   * @param name - Persona name to set as active
   */
  setActivePersona(name: string): void;

  /**
   * Get personas that are currently processing in the background
   * @returns Array of persona names that are processing
   */
  getBackgroundProcessingPersonas(): string[];

  /**
   * Check if any persona is currently processing
   * @returns True if any persona is processing
   */
  isAnyPersonaProcessing(): boolean;

  /**
   * Get personas that are currently processing (active or background)
   * @returns Array of persona names that are processing
   */
  getProcessingPersonas(): string[];

  /**
   * Update spinner animation based on persona processing states
   */
  updateSpinnerAnimation(): void;

  /**
   * Cleanup persona manager resources
   */
  cleanup(): void;
}

// ============================================================================
// Message Processor Module Interface
// ============================================================================

/**
 * Message Processor interface - responsible for message queuing and LLM processing
 * 
 * Handles message queuing, LLM interactions, heartbeat system management,
 * debouncing, and AbortController management for cancellation.
 */
export interface IMessageProcessor {
  /**
   * Process a user message for a specific persona
   * @param persona - Persona name
   * @param message - User message content
   * @returns Promise that resolves when processing is complete
   */
  processMessage(persona: string, message: string): Promise<void>;

  /**
   * Start heartbeat timer for a persona
   * @param persona - Persona name
   */
  startHeartbeat(persona: string): void;

  /**
   * Stop heartbeat timer for a persona
   * @param persona - Persona name
   */
  stopHeartbeat(persona: string): void;

  /**
   * Abort processing for a persona
   * @param persona - Persona name
   */
  abortProcessing(persona: string): void;

  /**
   * Check if a persona is currently processing
   * @param persona - Persona name
   * @returns True if processing, false otherwise
   */
  isProcessing(persona: string): boolean;

  /**
   * Queue a message for processing
   * @param persona - Persona name
   * @param message - Message to queue
   */
  queueMessage(persona: string, message: string): void;

  /**
   * Reset heartbeat timer for a persona
   * @param persona - Persona name
   */
  resetHeartbeat(persona: string): void;

  /**
   * Schedule debounced processing for a persona
   * @param persona - Persona name
   */
  scheduleDebounce(persona: string): void;

  /**
   * Initialize heartbeats for all personas
   * @param personas - Array of persona objects
   */
  initializeHeartbeats(personas: any[]): void;
}

// ============================================================================
// Test Support Module Interface
// ============================================================================

/**
 * Test Support interface - responsible for E2E test input injection
 * 
 * Handles test mode detection, stdin-based input injection for E2E tests,
 * and provides public methods for test frameworks to inject input.
 */
export interface ITestSupport {
  /**
   * Check if test mode is enabled
   * @returns True if test mode is active
   */
  isTestModeEnabled(): boolean;

  /**
   * Set up test input injection system
   * Initializes stdin listening for E2E tests
   */
  setupTestInputInjection(): void;

  /**
   * Process input received through test injection
   * @param input - Test input string
   */
  processTestInput(input: string): void;

  /**
   * Public method for direct test input injection
   * @param input - Input string to inject
   */
  injectTestInput(input: string): void;
}

// ============================================================================
// App Module Interface (Main Orchestrator)
// ============================================================================

/**
 * Main App interface - orchestrates all other modules
 * 
 * Reduced to ~300 lines focused on initialization, UI setup, event coordination,
 * and lifecycle management. Delegates specific responsibilities to focused modules.
 */
export interface IEIApp {
  /**
   * Initialize the application
   * @returns Promise that resolves when initialization is complete
   */
  init(): Promise<void>;

  /**
   * Public method for E2E test input injection
   * @param input - Input string to inject
   */
  injectTestInput(input: string): void;

  /**
   * Add a message to the current chat
   * @param role - Message role (human or system)
   * @param content - Message content
   * @param state - Optional message state
   */
  addMessage(role: 'human' | 'system', content: string, state?: MessageState): void;

  /**
   * Set status message
   * @param message - Status message or null to clear
   */
  setStatus(message: string | null): void;

  /**
   * Render the UI
   */
  render(): void;

  /**
   * Get current messages for active persona
   * @returns Array of messages
   */
  getMessages(): Message[];

  /**
   * Update the state of the last human message
   * @param newState - New message state
   */
  updateLastHumanMessageState(newState: MessageState | undefined): void;

  /**
   * Auto-scroll chat to bottom
   */
  autoScrollToBottom(): void;

  // Temporary methods for CommandHandler delegation - will be removed in final refactoring
  executeExitLogic?(): void;
  handleRefreshCommand?(): void;
  cleanup?(): { success: boolean; errors: string[] };
}

// ============================================================================
// Module Configuration Interface
// ============================================================================

/**
 * Configuration object passed to modules during initialization
 */
export interface ModuleConfig {
  debugMode: boolean;
  testMode: boolean;
  heartbeatInterval: number;
  debounceMs: number;
  ctrlCConfirmationWindow: number;
  completeThoughtLength: number;
  startupHistoryCount: number;
}

// ============================================================================
// Dependency Injection Interfaces
// ============================================================================

/**
 * Dependencies required by CommandHandler
 */
export interface CommandHandlerDependencies {
  personaManager: IPersonaManager;
  messageProcessor: IMessageProcessor;
  app: IEIApp;
}

/**
 * Dependencies required by PersonaManager
 */
export interface PersonaManagerDependencies {
  personaRenderer: any; // PersonaRenderer from existing module
  chatRenderer: any;    // ChatRenderer from existing module
  layoutManager: any;   // LayoutManager from existing module
}

/**
 * Dependencies required by MessageProcessor
 */
export interface MessageProcessorDependencies {
  chatRenderer: any;    // ChatRenderer from existing module
  personaManager: IPersonaManager;
  app: IEIApp;
}

/**
 * Dependencies required by TestSupport
 */
export interface TestSupportDependencies {
  commandHandler: ICommandHandler;
  messageProcessor: IMessageProcessor;
  app: IEIApp;
}