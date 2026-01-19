#!/usr/bin/env node

import blessed from 'blessed';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
// Import test output capture early to intercept blessed methods before they're used
import { testOutputCapture } from './test-output-capture.js';

import { loadHistory, listPersonas, findPersonaByNameOrAlias, initializeDataDirectory, initializeDebugLog, appendDebugLog, getPendingMessages, replacePendingMessages, appendHumanMessage, appendMessage, getUnprocessedMessages, loadPauseState, savePauseState, markSystemMessagesAsRead, getUnreadSystemMessageCount, loadArchiveState, saveArchiveState, getArchivedPersonas, findArchivedPersonaByNameOrAlias, addPersonaAlias, removePersonaAlias, loadConceptMap, saveConceptMap, loadAllPersonasWithConceptMaps } from '../storage.js';
import { getVisiblePersonas } from '../prompts.js';
import { createPersonaWithLLM, saveNewPersona } from '../persona-creator.js';
import { ConceptQueue } from '../concept-queue.js';
import { processEvent } from '../processor.js';
import { applyConceptDecay, checkConceptDeltas } from '../concept-decay.js';
import { LLMAbortedError, resolveModel, getProviderStatuses } from '../llm.js';
import type { Message, MessageState, PersonaState } from '../types.js';
import { LayoutManager } from './layout-manager.js';
import { FocusManager } from './focus-manager.js';
import { PersonaRenderer } from './persona-renderer.js';
import { ChatRenderer } from './chat-renderer.js';
import { getDisplayWidth } from './unicode-width.js';
import { StateManager } from '../state-manager.js';
import { setStateManager } from '../storage.js';

// Initialize debug log file
initializeDebugLog();

function debugLog(message: string) {
  appendDebugLog(message);
}

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;
const STARTUP_HISTORY_COUNT = 20;

// Ctrl+C confirmation window - user has this long to press Ctrl+C again to exit
const CTRL_C_CONFIRMATION_WINDOW_MS = 3000; // 3 seconds

// Stale message concept processing constants
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const STALE_MESSAGE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes



export class EIApp {
  private screen: blessed.Widgets.Screen;
  private layoutManager: LayoutManager;
  private focusManager: FocusManager;
  private personaRenderer: PersonaRenderer;
  private chatRenderer: ChatRenderer;
  private stateManager: StateManager;
  
  private personas: any[] = [];
  private activePersona = 'ei';
  private messages: Message[] = [];
  private personaStates = new Map<string, PersonaState>();
  private isProcessing = false;
  private statusMessage: string | null = null;
  private unreadCounts = new Map<string, number>();
  
  // Ctrl+C state tracking
  private ctrlCWarningTimestamp: number | null = null;
  private inputHasText = false;
  
  // Prevent duplicate submissions
  private lastSubmissionTime = 0;
  private lastSubmissionText = '';
  
  // Track instance creation
  private static instanceCount = 0;
  private instanceId: number;

  // Test input injection system
  private testInputEnabled = false;
  private testInputBuffer: string[] = [];

  // Multi-line editor content (when set, input box is in "preview" mode)
  private pendingMultiLineContent: string | null = null;

  // Stale message checker interval for background concept processing
  private staleMessageCheckInterval: NodeJS.Timeout | null = null;

  // Persona creation state tracking
  private pendingPersonaCreation: {
    name: string;
    stage: 'confirm' | 'describe';
  } | null = null;

  constructor() {
    EIApp.instanceCount++;
    this.instanceId = EIApp.instanceCount;
    debugLog(`EIApp constructor starting - Instance #${this.instanceId}`);
    
    this.testInputEnabled = process.env.NODE_ENV === 'test' || process.env.EI_E2E_MODE === 'true';
    debugLog(`Test input enabled: ${this.testInputEnabled} - Instance #${this.instanceId}`);
    
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'EI - Emotional Intelligence',
      fullUnicode: true,
      resizeTimeout: 300,
      sendFocus: true,
      // Force blessed to use stdin/stdout even in non-TTY environments
      input: process.stdin,
      output: process.stdout
    });

    this.patchBlessedUnicodeWidth();

    debugLog(`Screen created - Instance #${this.instanceId}`);

    // Initialize managers
    this.layoutManager = new LayoutManager(this.screen);
    debugLog(`LayoutManager created - Instance #${this.instanceId}`);
    
    this.focusManager = new FocusManager(this.layoutManager);
    debugLog(`FocusManager created - Instance #${this.instanceId}`);
    
    this.personaRenderer = new PersonaRenderer();
    debugLog(`PersonaRenderer created - Instance #${this.instanceId}`);
    
    this.chatRenderer = new ChatRenderer();
    debugLog(`ChatRenderer created - Instance #${this.instanceId}`);

    // Initialize StateManager
    this.stateManager = new StateManager();
    setStateManager(this.stateManager);
    debugLog(`StateManager created - Instance #${this.instanceId}`);

    // Pass screen reference to persona renderer for spinner animation
    this.personaRenderer.setScreen(this.screen);
    this.personaRenderer.setRenderCallback(() => this.render());
    debugLog(`PersonaRenderer configured - Instance #${this.instanceId}`);

    // Set up event handlers
    this.layoutManager.setSubmitHandler((text: string) => this.handleSubmit(text));
    this.layoutManager.setCtrlCHandler(() => this.handleCtrlC());
    this.layoutManager.setCtrlEHandler(() => this.handleCtrlE());
    debugLog(`Submit, Ctrl+C, and Ctrl+E handlers set - Instance #${this.instanceId}`);

    // Set up test input injection if enabled
    if (this.testInputEnabled) {
      this.setupTestInputInjection();
    }

    this.setupLayout();
    this.setupEventHandlers();
    this.setupSignalHandlers();
    debugLog(`EIApp constructor completed - Instance #${this.instanceId}`);
  }

  private patchBlessedUnicodeWidth() {
    const blessedModule = blessed as any;
    
    // Patch Element.prototype.strWidth for overall string width
    if (blessedModule.Element?.prototype?.strWidth) {
      blessedModule.Element.prototype.strWidth = function(text: string): number {
        if (this.parseTags && blessedModule.helpers?.stripTags) {
          text = blessedModule.helpers.stripTags(text);
        }
        return getDisplayWidth(text);
      };
      
      debugLog(`Blessed strWidth monkey-patched with string-width library`);
    } else {
      debugLog(`WARNING: Could not monkey-patch blessed.Element.prototype.strWidth - API may have changed`);
    }

    // Patch unicode.charWidth for per-character width (used in text wrapping)
    // This is CRITICAL for emoji rendering - without it, emoji break line wrapping
    const unicode = blessedModule.unicode || (blessed as any).unicode;
    if (unicode?.charWidth) {
      const originalCharWidth = unicode.charWidth;
      
      unicode.charWidth = function(str: string, i?: number): number {
        const idx = i || 0;
        
        const codePoint = unicode.codePointAt ? unicode.codePointAt(str, idx) : str.codePointAt(idx);
        const char = String.fromCodePoint(codePoint);
        
        const width = getDisplayWidth(char);
        
        if (width === 0 || width === undefined) {
          return originalCharWidth.call(this, str, idx);
        }
        
        return width;
      };
      
      debugLog(`Blessed unicode.charWidth monkey-patched with string-width library`);
    } else {
      debugLog(`WARNING: Could not monkey-patch blessed.unicode.charWidth - API may have changed`);
    }
  }

  private setupLayout() {
    debugLog(`setupLayout called - Instance #${this.instanceId}`);
    this.layoutManager.createLayout();
  }

  private setupEventHandlers() {
    debugLog(`setupEventHandlers called - Instance #${this.instanceId}`);
    // Input handling is now managed by LayoutManager
    this.layoutManager.setupEventHandlers();

    // Key bindings on screen level (only for non-input keys)
    this.screen.key(['escape', 'q'], () => {
      debugLog('Screen key handler: cleaning up and exiting...');
      try {
        const cleanupResult = this.cleanup();
        if (!cleanupResult.success) {
          debugLog(`Emergency exit cleanup had errors: ${cleanupResult.errors.join('; ')}`);
        }
      } catch (error) {
        debugLog(`Emergency exit cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      setTimeout(() => process.exit(1), 100);
    });

    // Remove screen-level Ctrl+C binding - it won't work when input has focus
    // Ctrl+C is now handled at the input level in LayoutManager

    // Remove screen-level keypress debugging - it won't work when input has focus
    // Input-level keypress tracking is in the input box's keypress event

    this.screen.key(['C-h'], () => {
      this.focusManager.focusPersonaList();
    });

    this.screen.key(['C-l'], () => {
      this.focusManager.focusInput();
    });

    this.screen.key(['C-r'], () => {
      this.handleRefreshCommand();
    });

    this.setupScrollingKeyBindings();

    this.layoutManager.getInputBox().on('keypress', (ch, key) => {
      if (this.pendingMultiLineContent) {
        if (key && key.ctrl && (key.name === 'c' || key.name === 'e')) {
          return;
        }
        if (key && key.name === 'enter') {
          return;
        }
        debugLog(`Blocked keypress in multi-line mode: ${key?.name || ch}`);
        const preview = this.layoutManager.getInputBox().getValue();
        setTimeout(() => {
          this.layoutManager.getInputBox().setValue(preview);
          this.screen.render();
        }, 0);
        return;
      }
      
      setTimeout(() => {
        const currentValue = this.layoutManager.getInputBox().getValue();
        const hasText = currentValue.trim().length > 0;
        
        if (hasText !== this.inputHasText) {
          debugLog(`Input text state changed: ${this.inputHasText} -> ${hasText} (value: "${currentValue}")`);
          this.inputHasText = hasText;
        }
        
        if (this.ctrlCWarningTimestamp && !(key && key.ctrl && key.name === 'c')) {
          debugLog('Resetting Ctrl+C warning timestamp due to non-Ctrl+C keypress');
          this.ctrlCWarningTimestamp = null;
        }
      }, 0);
    });

    // Resize handling - use blessed's native resize event only
    this.screen.on('resize', () => {
      debugLog(`Screen resize event detected: ${this.screen.width}x${this.screen.height}`);
      this.handleResize();
    });

    // Don't add SIGWINCH handler - let blessed handle it
    // Don't add polling - blessed's resize event should be sufficient
  }

  private setupScrollingKeyBindings() {
    // Scrolling key bindings on screen level (for when no element has focus)
    this.screen.key(['pageup'], () => {
      this.scrollChatHistory(-5);
    });

    this.screen.key(['pagedown'], () => {
      this.scrollChatHistory(5);
    });

    // Also add scrolling to input box for when it has focus
    this.layoutManager.getInputBox().key(['pageup'], () => {
      this.scrollChatHistory(-5);
    });

    this.layoutManager.getInputBox().key(['pagedown'], () => {
      this.scrollChatHistory(5);
    });
  }

  private setupSignalHandlers() {
    // Handle termination signals gracefully, but let blessed handle Ctrl+C
    const gracefulExit = () => {
      debugLog('Graceful exit called');
      try {
        const cleanupResult = this.cleanup();
        if (!cleanupResult.success) {
          debugLog(`Graceful exit cleanup had errors: ${cleanupResult.errors.join('; ')}`);
        }
        this.screen.destroy();
        process.exit(0);
      } catch (error) {
        debugLog(`Graceful exit failed: ${error instanceof Error ? error.message : String(error)}`);
        try {
          this.screen.destroy();
        } catch (screenError) {
          debugLog(`Screen destroy failed during graceful exit: ${screenError instanceof Error ? screenError.message : String(screenError)}`);
        }
        process.exit(1);
      }
    };
    
    // Only handle non-interactive signals
    process.on('SIGTERM', gracefulExit);
    process.on('SIGHUP', gracefulExit);
    
    // Don't override SIGINT - let blessed handle Ctrl+C through key bindings
    // Don't remove all listeners - this breaks blessed's signal handling
  }

  private handleResize() {
    debugLog(`handleResize called - screen size: ${this.screen.width}x${this.screen.height}`);
    this.focusManager.handleResize();
    
    // Re-establish scrolling key bindings on the new input box after resize
    this.setupScrollingKeyBindings();
    
    this.render();
  }

  private async handleSubmit(text: string) {
    const actualContent = this.pendingMultiLineContent || text;
    
    if (!actualContent.trim()) return;

    debugLog(`handleSubmit called - Instance #${this.instanceId}: "${actualContent.substring(0, 50)}..." (${actualContent.length} chars)`);

    const now = Date.now();
    const timeSinceLastSubmit = now - this.lastSubmissionTime;
    
    if (timeSinceLastSubmit < 2000 && actualContent === this.lastSubmissionText) {
      debugLog(`Duplicate submission prevented - Instance #${this.instanceId}`);
      return;
    }
    
    this.lastSubmissionTime = now;
    this.lastSubmissionText = actualContent;

    debugLog(`handleSubmit: processing - Instance #${this.instanceId}`);

    this.setStatus(null);
    
    this.ctrlCWarningTimestamp = null;
    this.inputHasText = false;
    this.pendingMultiLineContent = null;

    if (this.pendingPersonaCreation) {
      await this.handlePersonaCreationInput(actualContent);
      this.layoutManager.getInputBox().clearValue();
      this.focusManager.maintainFocus();
      this.render();
      return;
    }

    if (actualContent.startsWith('/')) {
      await this.handleCommand(actualContent);
      this.focusManager.maintainFocus();
      return;
    }

    // Capture snapshot before user message
    await this.stateManager.captureSnapshot();
    
    this.addMessage('human', actualContent, 'processing');
    await appendHumanMessage(actualContent, this.activePersona);
    this.queueMessage(actualContent);
    this.layoutManager.getInputBox().clearValue();
    
    this.focusManager.maintainFocus();
    this.render();
    this.autoScrollToBottom();
  }

  private async handleCommand(input: string): Promise<void> {
    const spaceIdx = input.indexOf(' ');
    const command = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1);

    switch (command.toLowerCase()) {
      case 'persona':
      case 'p':
        await this.handlePersonaCommand(args);
        break;
      case 'refresh':
      case 'r':
        this.handleRefreshCommand();
        break;
      case 'quit':
      case 'q':
        await this.handleQuitCommand(args);
        break;
      case 'editor':
      case 'e':
        this.layoutManager.getInputBox().clearValue();
        await this.handleCtrlE();
        break;
      case 'pause':
        await this.handlePauseCommand(args);
        break;
      case 'resume':
        await this.handleResumeCommand(args);
        break;
      case 'archive':
        await this.handleArchiveCommand(args);
        break;
      case 'unarchive':
        await this.handleUnarchiveCommand(args);
        break;
      case 'nick':
      case 'n':
        await this.handleNickCommand(args);
        break;
      case 'model':
      case 'm':
        await this.handleModelCommand(args);
        break;
      case 'group':
      case 'g':
        await this.handleGroupCommand(args);
        break;
      case 'groups':
      case 'gs':
        await this.handleGroupsCommand(args);
        break;
      case 'help':
      case 'h':
        this.showHelpModal();
        break;
      case 'status':
      case 's':
        await this.handleStatusCommand();
        break;
      case 'undo':
        await this.handleUndoCommand(args);
        break;
      case 'savestate':
        await this.handleSaveStateCommand(args);
        break;
      case 'restorestate':
        await this.handleRestoreStateCommand(args);
        break;
      case 'new':
        await this.handleNewCommand();
        break;
      default:
        this.setStatus(`Unknown command: /${command}`);
    }
    
    this.layoutManager.getInputBox().clearValue();
    this.render();
  }

  private async handlePersonaCommand(args: string) {
    const trimmed = args.trim();
    
    if (!trimmed) {
      const list = this.personas.map(p => {
        const marker = p.name === this.activePersona ? '[active]' : '';
        const unread = this.unreadCounts.get(p.name) || 0;
        const unreadStr = unread ? ` (${unread} unread)` : '';
        return `${p.name}${marker}${unreadStr}`;
      }).join(', ');
      this.setStatus(`Available personas: ${list}`);
      return;
    }

    const { parseQuotedArgs } = await import('../parse-utils.js');
    const firstChar = trimmed[0];
    let nameOrAlias: string;
    
    if (firstChar === '"' || firstChar === "'") {
      nameOrAlias = parseQuotedArgs(trimmed);
    } else {
      nameOrAlias = trimmed.split(/\s+/)[0];
    }

    // First check for exact match (name or alias)
    const exactPersona = await findPersonaByNameOrAlias(nameOrAlias.toLowerCase());
    if (exactPersona) {
      await this.switchPersona(exactPersona);
      return;
    }
    
    // Check archived personas
    const archivedPersona = await findArchivedPersonaByNameOrAlias(nameOrAlias.toLowerCase());
    if (archivedPersona) {
      this.setStatus(`Persona '${archivedPersona}' is archived. Use /unarchive ${nameOrAlias} to restore it`);
      return;
    }
    
    // Try partial match only if exact match and archive check failed
    try {
      const partialPersona = await findPersonaByNameOrAlias(nameOrAlias.toLowerCase(), { allowPartialMatch: true });
      if (partialPersona) {
        await this.switchPersona(partialPersona);
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Ambiguous')) {
        this.setStatus(error.message);
        return;
      }
      throw error;
    }
    
    // No match found - validate before creating
    const validationError = this.validatePersonaName(nameOrAlias);
    if (validationError) {
      this.setStatus(validationError);
      return;
    }
    this.pendingPersonaCreation = { name: nameOrAlias, stage: 'confirm' };
    this.setStatus(`Persona '${nameOrAlias}' not found. Create it? (y/n)`);
  }

  private validatePersonaName(name: string): string | null {
    if (name.length < 2) {
      return 'Persona name must be at least 2 characters';
    }
    if (name.length > 32) {
      return 'Persona name must be 32 characters or less';
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      return 'Persona name must start with a letter and contain only letters, numbers, underscores, and hyphens';
    }
    return null;
  }

  private async handlePersonaCreationInput(input: string): Promise<void> {
    if (!this.pendingPersonaCreation) return;

    const { name, stage } = this.pendingPersonaCreation;
    const trimmed = input.trim().toLowerCase();

    if (stage === 'confirm') {
      if (trimmed === 'y' || trimmed === 'yes') {
        this.pendingPersonaCreation = { name, stage: 'describe' };
        this.setStatus(`Creating '${name}'. What should this persona be like?`);
      } else if (trimmed === 'n' || trimmed === 'no') {
        this.pendingPersonaCreation = null;
        this.setStatus('Persona creation cancelled');
      } else {
        this.setStatus(`Persona '${name}' not found. Create it? (y/n)`);
      }
      return;
    }

    if (stage === 'describe') {
      this.setStatus(`Generating persona '${name}'...`);
      this.render();

      try {
        await this.stateManager.captureSnapshot();
        const conceptMap = await createPersonaWithLLM(name, input.trim());
        await saveNewPersona(name, conceptMap);
        
        this.personas = await listPersonas();
        this.pendingPersonaCreation = null;
        
        this.setStatus(`Persona '${name}' created!`);
        this.render();
        
        await this.switchPersona(name);
      } catch (err) {
        this.pendingPersonaCreation = null;
        this.setStatus(`Failed to create persona: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async handleQuitCommand(args: string) {
    const trimmedArgs = args.trim();
    
    // Enhanced argument validation
    if (trimmedArgs) {
      // Split arguments and filter out empty strings
      const argList = trimmedArgs.split(/\s+/).filter(arg => arg.length > 0);
      
      // Check for multiple arguments
      if (argList.length > 1) {
        debugLog(`Quit command validation failed: multiple arguments provided: [${argList.join(', ')}]`);
        this.setStatus(`Too many arguments. Usage: /quit [--force]`);
        return;
      }
      
      // Check for single valid argument
      const singleArg = argList[0];
      if (singleArg !== "--force") {
        debugLog(`Quit command validation failed: invalid argument: "${singleArg}"`);
        
        // Provide helpful suggestions for common mistakes
        if (singleArg === "-f" || singleArg === "force") {
          this.setStatus(`Invalid argument: ${singleArg}. Did you mean --force? Usage: /quit [--force]`);
        } else if (singleArg.startsWith("-")) {
          this.setStatus(`Unknown flag: ${singleArg}. Only --force is supported. Usage: /quit [--force]`);
        } else {
          this.setStatus(`Invalid argument: ${singleArg}. Usage: /quit [--force]`);
        }
        return;
      }
    }
    
    const isForce = trimmedArgs === "--force";
    
    try {
      if (isForce) {
        // Force exit: bypass all safety checks
        debugLog('Force quit command executed - bypassing all safety checks');
        try {
          const cleanupResult = this.cleanup();
          
          if (!cleanupResult.success) {
            debugLog(`Force quit cleanup had errors: ${cleanupResult.errors.join('; ')}`);
            // Continue with force exit regardless of cleanup errors
          }
          
          this.screen.destroy();
          process.exit(0);
        } catch (error) {
          debugLog(`Critical error during force quit: ${error instanceof Error ? error.message : String(error)}`);
          // Force exit even if everything fails
          try {
            this.screen.destroy();
          } catch (screenError) {
            debugLog(`Screen destroy failed during force quit: ${screenError instanceof Error ? screenError.message : String(screenError)}`);
          }
          process.exit(1);
        }
        return;
      }
      
      // Regular quit: use shared exit logic (identical to Ctrl+C)
      debugLog('Regular quit command executed - using shared exit logic');
      this.executeExitLogic();
    } catch (error) {
      debugLog(`Quit command execution error: ${error instanceof Error ? error.message : String(error)}`);
      this.setStatus(`Error executing quit command: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handlePauseCommand(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase();
    const ps = this.getOrCreatePersonaState(this.activePersona);
    
    if (ps.isPaused) {
      this.setStatus(`${this.activePersona} is already paused`);
      return;
    }
    
    let pauseUntil: string | undefined;
    let durationMs: number | undefined;
    let durationDisplay: string;
    
    if (!trimmed || trimmed === 'indefinite') {
      pauseUntil = undefined;
      durationDisplay = 'indefinitely';
    } else {
      const match = trimmed.match(/^(\d+)(m|h)$/);
      if (!match) {
        this.setStatus('Usage: /pause [30m|2h|indefinite]');
        return;
      }
      const value = parseInt(match[1], 10);
      const unit = match[2];
      durationMs = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000;
      pauseUntil = new Date(Date.now() + durationMs).toISOString();
      durationDisplay = `for ${value}${unit}`;
    }
    
    ps.isPaused = true;
    ps.pauseUntil = pauseUntil;
    
    if (ps.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
      ps.heartbeatTimer = null;
    }
    
    const pausedPersonaName = this.activePersona;
    if (durationMs && pauseUntil) {
      ps.pauseTimer = setTimeout(() => {
        this.autoResumePersona(pausedPersonaName);
      }, durationMs);
    }
    
    await this.stateManager.captureSnapshot();
    await savePauseState(pausedPersonaName, { isPaused: true, pauseUntil });
    
    this.setStatus(`Paused ${this.activePersona} ${durationDisplay}`);
    this.render();
  }

  private async handleResumeCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    
    const targetPersona = trimmed 
      ? await findPersonaByNameOrAlias(trimmed) || trimmed
      : this.activePersona;
    
    const personaExists = this.personas.some(p => p.name === targetPersona);
    if (!personaExists) {
      this.setStatus(`Persona '${targetPersona}' not found`);
      return;
    }
    
    const ps = this.getOrCreatePersonaState(targetPersona);
    
    if (!ps.isPaused) {
      this.setStatus(`${targetPersona} is not paused`);
      return;
    }
    
    await this.resumePersona(targetPersona, true);
    this.setStatus(`Resumed ${targetPersona}`);
    this.render();
  }

  private async autoResumePersona(personaName: string): Promise<void> {
    debugLog(`Auto-resuming ${personaName} after pause timer expired`);
    await this.resumePersona(personaName, true);
    
    if (personaName === this.activePersona) {
      this.setStatus(`${personaName} auto-resumed`);
    }
    this.render();
  }

  private async handleArchiveCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    
    const targetPersona = trimmed
      ? await findPersonaByNameOrAlias(trimmed) || trimmed
      : this.activePersona;
    
    const personaExists = this.personas.some(p => p.name === targetPersona);
    if (!personaExists) {
      this.setStatus(`Persona '${targetPersona}' not found`);
      return;
    }
    
    const archiveState = await loadArchiveState(targetPersona);
    if (archiveState.isArchived) {
      this.setStatus(`${targetPersona} is already archived`);
      return;
    }
    
    await this.stateManager.captureSnapshot();
    await saveArchiveState(targetPersona, {
      isArchived: true,
      archivedDate: new Date().toISOString()
    });
    
    const ps = this.personaStates.get(targetPersona);
    if (ps?.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
      ps.heartbeatTimer = null;
    }
    
    this.personas = await listPersonas();
    
    if (targetPersona === this.activePersona) {
      if (this.personas.length > 0) {
        await this.switchPersona(this.personas[0].name);
      }
    }
    
    this.setStatus(`Archived ${targetPersona}`);
    this.render();
  }

  private async handleUnarchiveCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    
    if (!trimmed) {
      const archived = await getArchivedPersonas();
      if (archived.length === 0) {
        this.setStatus('No archived personas');
        return;
      }
      const list = archived.map((p, i) => `${i + 1}. ${p.name}`).join(', ');
      this.setStatus(`Archived personas: ${list}`);
      return;
    }
    
    const archived = await getArchivedPersonas();
    let targetPersona: string | null = null;
    
    if (/^\d+$/.test(trimmed)) {
      const index = parseInt(trimmed, 10) - 1;
      if (index >= 0 && index < archived.length) {
        targetPersona = archived[index].name;
      }
    } else {
      targetPersona = await findArchivedPersonaByNameOrAlias(trimmed);
    }
    
    if (!targetPersona) {
      this.setStatus(`Archived persona '${trimmed}' not found`);
      return;
    }
    
    const archiveState = await loadArchiveState(targetPersona);
    if (!archiveState.isArchived) {
      this.setStatus(`${targetPersona} is not archived`);
      return;
    }
    
    await this.stateManager.captureSnapshot();
    await saveArchiveState(targetPersona, {
      isArchived: false,
      archivedDate: undefined
    });
    
    this.personas = await listPersonas();
    
    this.setStatus(`Unarchived ${targetPersona}`);
    this.render();
  }

  private async handleNickCommand(args: string): Promise<void> {
    const { parseCommandArgs } = await import('../parse-utils.js');
    const parts = parseCommandArgs(args);
    const subcommand = parts[0]?.toLowerCase() || '';
    
    if (!subcommand || subcommand === 'list') {
      const conceptMap = await loadConceptMap('system', this.activePersona);
      const aliases = conceptMap.aliases || [];
      
      if (aliases.length === 0) {
        this.setStatus(`${this.activePersona} has no aliases`);
        return;
      }
      
      this.setStatus(`Aliases for ${this.activePersona}: ${aliases.join(', ')}`);
      return;
    }
    
    if (subcommand === 'add') {
      if (parts.length !== 2) {
        this.setStatus('Usage: /nick add <alias> or /nick add "multi word alias"');
        return;
      }
      
      const alias = parts[1];
      
      try {
        await this.stateManager.captureSnapshot();
        await addPersonaAlias(this.activePersona, alias);
        this.setStatus(`Added alias "${alias}" to ${this.activePersona}`);
        this.personas = await listPersonas();
        this.render();
      } catch (error) {
        this.setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    
    if (subcommand === 'remove') {
      if (parts.length !== 2) {
        this.setStatus('Usage: /nick remove <alias> or /nick remove "partial match"');
        return;
      }
      
      const pattern = parts[1];
      
      try {
        await this.stateManager.captureSnapshot();
        const removed = await removePersonaAlias(this.activePersona, pattern);
        this.setStatus(`Removed alias "${removed[0]}" from ${this.activePersona}`);
        this.personas = await listPersonas();
        this.render();
      } catch (error) {
        this.setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    
    this.setStatus(`Unknown subcommand: /nick ${subcommand}. Use add, remove, or list.`);
  }

  private async handleModelCommand(args: string): Promise<void> {
    const { parseCommandArgs } = await import('../parse-utils.js');
    const parts = parseCommandArgs(args);
    const arg = parts[0]?.toLowerCase() || '';

    if (!arg) {
      await this.showModelConfig();
      return;
    }

    if (arg === '--clear') {
      await this.clearPersonaModel();
      return;
    }

    if (arg === '--list') {
      await this.listProviders();
      return;
    }

    await this.setPersonaModel(parts[0]);
  }

  private async showModelConfig(): Promise<void> {
    const conceptMap = await loadConceptMap('system', this.activePersona);
    const personaModel = conceptMap.model || null;

    const envResponse = process.env.EI_MODEL_RESPONSE || null;
    const envConcept = process.env.EI_MODEL_CONCEPT || null;
    const envGeneration = process.env.EI_MODEL_GENERATION || null;
    const globalDefault = process.env.EI_LLM_MODEL || 'local:google/gemma-3-12b';

    const currentlyUsing = personaModel || envResponse || globalDefault;

    let lines: string[] = [];
    lines.push(`Model configuration for '${this.activePersona}':`);
    lines.push('');
    lines.push(`  Persona model:     ${personaModel || '(not set)'}`);
    
    if (!personaModel) {
      if (envResponse) {
        lines.push(`  EI_MODEL_RESPONSE: ${envResponse}`);
      }
      if (envConcept) {
        lines.push(`  EI_MODEL_CONCEPT:  ${envConcept}`);
      }
      if (envGeneration) {
        lines.push(`  EI_MODEL_GENERATION: ${envGeneration}`);
      }
    }
    
    lines.push(`  Global default:    ${globalDefault}`);
    lines.push('');
    lines.push(`Currently using: ${currentlyUsing}`);

    this.setStatus(lines.join(' | '));
  }

  private async setPersonaModel(modelSpec: string): Promise<void> {
    try {
      resolveModel(modelSpec);
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const conceptMap = await loadConceptMap('system', this.activePersona);
    conceptMap.model = modelSpec;
    await this.stateManager.captureSnapshot();
    await saveConceptMap(conceptMap, this.activePersona);

    this.setStatus(`Model for '${this.activePersona}' set to: ${modelSpec}`);
  }

  private async clearPersonaModel(): Promise<void> {
    const conceptMap = await loadConceptMap('system', this.activePersona);
    
    if (!conceptMap.model) {
      this.setStatus(`No model override set for '${this.activePersona}'`);
      return;
    }

    delete conceptMap.model;
    await this.stateManager.captureSnapshot();
    await saveConceptMap(conceptMap, this.activePersona);

    const globalDefault = process.env.EI_LLM_MODEL || 'local:google/gemma-3-12b';
    this.setStatus(`Model override cleared for '${this.activePersona}'. Now using default: ${globalDefault}`);
  }

  private async listProviders(): Promise<void> {
    const statuses = getProviderStatuses();
    
    let lines: string[] = [];
    lines.push('Available Providers:');
    
    for (const status of statuses) {
      const check = status.configured ? '\u2713' : '\u2717';
      const configStatus = status.configured 
        ? (status.provider === 'local' ? `(${status.baseURL})` : '(API key set)')
        : `(set EI_${status.provider === 'x' ? 'XAI' : status.provider.toUpperCase()}_API_KEY)`;
      lines.push(`  ${status.provider.padEnd(10)} ${check} ${status.name} ${configStatus}`);
    }

    lines.push('');
    lines.push('Current defaults:');
    lines.push(`  EI_LLM_MODEL        = ${process.env.EI_LLM_MODEL || '(not set)'}`);
    lines.push(`  EI_MODEL_RESPONSE   = ${process.env.EI_MODEL_RESPONSE || '(not set)'}`);
    lines.push(`  EI_MODEL_CONCEPT    = ${process.env.EI_MODEL_CONCEPT || '(not set)'}`);
    lines.push(`  EI_MODEL_GENERATION = ${process.env.EI_MODEL_GENERATION || '(not set)'}`);

    this.setStatus(lines.join(' | '));
  }

  private async handleGroupCommand(args: string): Promise<void> {
    // Block on Ei persona
    if (this.activePersona === 'ei') {
      this.setStatus("Error: Ei's groups are managed by the system");
      return;
    }

    const { parseQuotedArgs } = await import('../parse-utils.js');
    const trimmed = args.trim();

    // /g - show current primary group
    if (!trimmed) {
      const conceptMap = await loadConceptMap('system', this.activePersona);
      const primary = conceptMap.group_primary;
      this.setStatus(`Primary group: ${primary || '(none)'}`);
      return;
    }

    // Check for too many arguments (error case: "/g set Foo")
    const firstChar = trimmed[0];
    let groupName: string;
    let remainder: string;

    if (firstChar === '"' || firstChar === "'") {
      groupName = parseQuotedArgs(trimmed);
      // Find where the quoted arg ends to check for extra args
      const closeIdx = trimmed.indexOf(firstChar, 1);
      remainder = closeIdx === -1 ? '' : trimmed.slice(closeIdx + 1).trim();
    } else {
      const parts = trimmed.split(/\s+/);
      groupName = parts[0];
      remainder = parts.slice(1).join(' ');
    }

    // If there's anything after the group name, error
    if (remainder) {
      this.setStatus('Error: /g takes one argument (group name) or "clear"');
      return;
    }

    // /g clear - clear primary group
    if (groupName.toLowerCase() === 'clear') {
      const conceptMap = await loadConceptMap('system', this.activePersona);
      conceptMap.group_primary = null;
      await this.stateManager.captureSnapshot();
      await saveConceptMap(conceptMap, this.activePersona);
      this.setStatus(`Primary group cleared for ${this.activePersona}`);
      return;
    }

    // /g <name> - set primary group
    const conceptMap = await loadConceptMap('system', this.activePersona);
    conceptMap.group_primary = groupName;
    await this.stateManager.captureSnapshot();
    await saveConceptMap(conceptMap, this.activePersona);
    this.setStatus(`Primary group set to: ${groupName}`);
  }

  private async handleGroupsCommand(args: string): Promise<void> {
    // Block on Ei persona
    if (this.activePersona === 'ei') {
      this.setStatus("Error: Ei's groups are managed by the system");
      return;
    }

    const { parseCommandArgs } = await import('../parse-utils.js');
    const parts = parseCommandArgs(args);
    const subcommand = parts[0]?.toLowerCase() || '';

    // /gs - list visible groups
    if (!subcommand) {
      const conceptMap = await loadConceptMap('system', this.activePersona);
      const primary = conceptMap.group_primary;
      const visible = conceptMap.groups_visible || [];

      if (!primary && visible.length === 0) {
        this.setStatus('Visible groups: (none)');
        return;
      }

      const groupList: string[] = [];
      if (primary) {
        groupList.push(`${primary} (primary)`);
      }
      groupList.push(...visible.filter(g => g !== primary));

      this.setStatus(`Visible groups: ${groupList.join(', ')}`);
      return;
    }

    // /gs clear - clear all visible groups
    if (subcommand === 'clear') {
      const conceptMap = await loadConceptMap('system', this.activePersona);
      conceptMap.groups_visible = [];
      await this.stateManager.captureSnapshot();
      await saveConceptMap(conceptMap, this.activePersona);
      this.setStatus(`Visible groups cleared for ${this.activePersona}`);
      return;
    }

    // /gs remove <group> - remove from visible groups
    if (subcommand === 'remove') {
      if (parts.length !== 2) {
        this.setStatus('Usage: /gs remove <group> or /gs remove "group name"');
        return;
      }

      const groupName = parts[1];
      const conceptMap = await loadConceptMap('system', this.activePersona);
      const visible = conceptMap.groups_visible || [];

      if (!visible.includes(groupName)) {
        this.setStatus(`"${groupName}" is not in visible groups`);
        return;
      }

      conceptMap.groups_visible = visible.filter(g => g !== groupName);
      await this.stateManager.captureSnapshot();
      await saveConceptMap(conceptMap, this.activePersona);
      this.setStatus(`Removed "${groupName}" from visible groups`);
      return;
    }

    // /gs <group> - add to visible groups
    const groupName = parts[0];
    const conceptMap = await loadConceptMap('system', this.activePersona);

    // Warn if adding primary group
    if (conceptMap.group_primary === groupName) {
      this.setStatus(`Note: "${groupName}" is already visible as your primary group`);
      return;
    }

    const visible = conceptMap.groups_visible || [];

    // Check if already in visible groups
    if (visible.includes(groupName)) {
      this.setStatus(`"${groupName}" is already in visible groups`);
      return;
    }

    conceptMap.groups_visible = [...visible, groupName];
    await this.stateManager.captureSnapshot();
    await saveConceptMap(conceptMap, this.activePersona);
    this.setStatus(`Added "${groupName}" to visible groups`);
  }

  private async handleStatusCommand(): Promise<void> {
    const conceptMap = await loadConceptMap('system', this.activePersona);
    const allPersonas = await loadAllPersonasWithConceptMaps();
    const visiblePersonas = getVisiblePersonas(this.activePersona, conceptMap, allPersonas);

    const lines: string[] = [];
    lines.push(`Status for '${this.activePersona}':`);

    const primary = conceptMap.group_primary;
    const visible = conceptMap.groups_visible || [];

    if (this.activePersona === 'ei') {
      lines.push('  Groups: (global - sees all)');
    } else if (!primary && visible.length === 0) {
      lines.push('  Groups: (none)');
    } else {
      const groupList: string[] = [];
      if (primary) {
        groupList.push(`${primary} (primary)`);
      }
      groupList.push(...visible.filter(g => g !== primary));
      lines.push(`  Groups: ${groupList.join(', ')}`);
    }

    if (visiblePersonas.length === 0) {
      lines.push('  Visible personas: (none)');
    } else {
      lines.push(`  Visible personas: ${visiblePersonas.map(p => p.name).join(', ')}`);
    }

    this.setStatus(lines.join(' | '));
  }

  private async handleUndoCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    
    let n = 1;
    if (trimmed) {
      const parsed = parseInt(trimmed, 10);
      if (isNaN(parsed) || parsed < 1) {
        this.setStatus('Usage: /undo [n] where n is a positive integer');
        return;
      }
      n = parsed;
    }
    
    this.abortPersonaOperation(this.activePersona);
    
    const snapshot = this.stateManager.undo(n);
    
    if (!snapshot) {
      this.setStatus('No undo history available');
      return;
    }
    
    const availableCount = this.stateManager.getSnapshotCount();
    if (n > availableCount + 1) {
      this.setStatus(`Only ${availableCount + 1} state(s) available, undid all`);
    }
    
    try {
      await this.stateManager.restoreSnapshot(snapshot);
      await this.reloadFromDisk();
      
      const timestamp = new Date(snapshot.timestamp).toLocaleString();
      const actionCount = n === 1 ? '1 action' : `${n} actions`;
      this.setStatus(`Undid ${actionCount} - Restored to state from ${timestamp}`);
    } catch (err) {
      this.setStatus(`Undo failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleSaveStateCommand(args: string): Promise<void> {
    const trimmed = args.trim();
    const name = trimmed || undefined;

    try {
      await this.stateManager.saveStateToDisk(name);
      const timestamp = new Date().toLocaleString();
      const displayName = name || timestamp;
      this.setStatus(`State saved: ${displayName} (${timestamp})`);
    } catch (err) {
      this.setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleRestoreStateCommand(args: string): Promise<void> {
    const trimmed = args.trim();

    if (!trimmed) {
      try {
        const states = await this.stateManager.listSavedStates();
        
        if (states.length === 0) {
          this.setStatus('No saved states available');
          return;
        }

        const lines: string[] = [];
        lines.push('Saved States');
        lines.push('');
        lines.push('#   Name                           Timestamp');
        lines.push('─────────────────────────────────────────────────────────');
        
        states.forEach((state, index) => {
          const num = (index + 1).toString().padEnd(4);
          const name = state.name.padEnd(30);
          const timestamp = new Date(state.timestamp).toLocaleString();
          lines.push(`${num}${name} ${timestamp}`);
        });
        
        lines.push('');
        lines.push('Use /restoreState <number> or /restoreState <name> to restore');
        lines.push('Press q to close this list.');

        const tmpFile = `/tmp/ei-restore-${Date.now()}.txt`;
        writeFileSync(tmpFile, lines.join('\n'), 'utf-8');
        
        this.screen.exec('less', [tmpFile], {}, (err) => {
          try {
            unlinkSync(tmpFile);
          } catch {
          }
          this.focusManager.focusInput();
          this.screen.render();
        });
      } catch (err) {
        this.setStatus(`Failed to list states: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    try {
      const parsedNumber = parseInt(trimmed, 10);
      const arg = isNaN(parsedNumber) ? trimmed : parsedNumber;

      await this.stateManager.captureSnapshot();
      const snapshot = await this.stateManager.loadStateFromDisk(arg);
      
      this.abortPersonaOperation(this.activePersona);
      await this.stateManager.restoreSnapshot(snapshot);
      await this.reloadFromDisk();

      const timestamp = new Date(snapshot.timestamp).toLocaleString();
      const states = await this.stateManager.listSavedStates();
      const state = typeof arg === 'number' 
        ? states[arg - 1] 
        : states.find(s => s.name === arg || s.id === arg);
      const displayName = state?.name || arg;
      
      this.setStatus(`Restored state: ${displayName} (${timestamp})`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('State not found')) {
        this.setStatus(`State '${trimmed}' not found`);
      } else {
        this.setStatus(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async handleNewCommand(): Promise<void> {
    try {
      await this.stateManager.captureSnapshot();
      
      const markerMessage: Message = {
        role: 'system',
        content: '[CONTEXT_CLEARED]',
        timestamp: new Date().toISOString(),
        read: true,
        concept_processed: true,
      };
      
      await appendMessage(markerMessage, this.activePersona);
      
      const history = await loadHistory(this.activePersona);
      this.messages = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      this.setStatus('New conversation started');
      this.render();
      this.autoScrollToBottom();
    } catch (err) {
      this.setStatus(`Failed to start new conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showHelpModal(): void {
    const helpText = `EI - Emotional Intelligence Chat

COMMANDS
  /persona [name]     Switch persona (or list if no name)
  /pause [duration]   Pause active persona (30m, 2h, or indefinite)
  /resume [persona]   Resume paused persona
  /archive [persona]  Archive persona (hides from list, stops heartbeats)
  /unarchive [name|#] Restore archived persona (no args lists archived)
  /nick [subcommand]  Manage persona aliases
    /nick              List aliases for active persona
    /nick add <alias>  Add alias (supports "multi word" quotes)
    /nick remove <pat> Remove alias by partial match
  /model [subcommand] View/set persona model configuration
    /model             Show current model configuration
    /model <spec>      Set model (e.g., openai:gpt-4o)
    /model --clear     Remove persona model (use default)
    /model --list      List available providers
  /group, /g          View/set primary group for persona
    /g                 Show current primary group
    /g Fellowship      Set primary group to "Fellowship"
    /g "My Group"      Groups with spaces need quotes
    /g clear           Clear primary group
  /groups, /gs        Manage visible groups for persona
    /gs                List visible groups (primary marked)
    /gs Personal       Add "Personal" to visible groups
    /gs remove Work    Remove "Work" from visible groups
    /gs clear          Clear all visible groups
  /status, /s         Show persona status (groups, visible personas)
  /new                Start new conversation (clears LLM context)
  /undo [n]           Undo last n actions (default: 1)
  /saveState [name]   Save current state to disk (optional name)
  /restoreState [arg] Restore saved state (no args lists states)
  /editor, /e         Open external editor for multi-line input
  /refresh, /r        Refresh UI layout
  /quit [--force]     Exit application
  /help, /h           Show this help

KEYBOARD SHORTCUTS
  Ctrl+E              Open external editor
  Ctrl+C              Clear input / abort operation / exit
  Ctrl+H              Focus persona list
  Ctrl+L              Focus input
  Ctrl+R              Refresh UI
  PageUp/PageDown     Scroll chat history
  Escape, Q           Quit application

TIPS
  - Messages are processed asynchronously
  - Use /pause to temporarily stop responses
  - External editor supports multi-line messages
  - Use /undo to roll back unwanted changes
  - /saveState creates backup snapshots (persists across restarts)
  - /undo history is lost when app restarts
  - Saved states are stored in data/.ei-states/ (max 10)

Press q to close this help.`;

    const tmpFile = `/tmp/ei-help-${Date.now()}.txt`;
    writeFileSync(tmpFile, helpText, 'utf-8');
    
    this.screen.exec('less', [tmpFile], {}, (err) => {
      try {
        unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
      this.focusManager.focusInput();
      this.screen.render();
    });
  }

  private async resumePersona(personaName: string, triggerHeartbeat: boolean): Promise<void> {
    const ps = this.getOrCreatePersonaState(personaName);
    
    ps.isPaused = false;
    ps.pauseUntil = undefined;
    
    if (ps.pauseTimer) {
      clearTimeout(ps.pauseTimer);
      ps.pauseTimer = null;
    }
    
    await this.stateManager.captureSnapshot();
    await savePauseState(personaName, { isPaused: false });
    
    const pendingFromStorage = await getPendingMessages(personaName);
    if (pendingFromStorage.length > 0 && ps.messageQueue.length === 0) {
      debugLog(`Resuming ${personaName}: loading ${pendingFromStorage.length} pending messages from storage`);
      const combinedMessage = pendingFromStorage.map(m => m.content).join('\n');
      ps.messageQueue.push(combinedMessage);
    }
    
    if (ps.messageQueue.length > 0) {
      debugLog(`Resuming ${personaName} with ${ps.messageQueue.length} queued messages`);
      this.processPersonaQueue(personaName);
    } else if (triggerHeartbeat) {
      this.resetPersonaHeartbeat(personaName);
    }
  }

  private async loadPersistedPauseState(personaName: string): Promise<void> {
    const pauseState = await loadPauseState(personaName);
    
    if (!pauseState.isPaused) return;
    
    const ps = this.getOrCreatePersonaState(personaName);
    ps.isPaused = true;
    ps.pauseUntil = pauseState.pauseUntil;
    
    if (pauseState.pauseUntil) {
      const remainingMs = new Date(pauseState.pauseUntil).getTime() - Date.now();
      
      if (remainingMs <= 0) {
        debugLog(`Pause expired for ${personaName} while app was closed, resuming`);
        await this.resumePersona(personaName, false);
      } else {
        debugLog(`Restoring pause timer for ${personaName}: ${Math.round(remainingMs / 60000)}m remaining`);
        ps.pauseTimer = setTimeout(() => {
          this.autoResumePersona(personaName);
        }, remainingMs);
      }
    } else {
      debugLog(`Restored indefinite pause for ${personaName}`);
    }
  }

  private handleRefreshCommand() {
    debugLog('Manual refresh command triggered');
    
    // Force blessed to check terminal size and reallocate
    this.screen.alloc();
    
    // Log current dimensions for debugging
    const screenWidth = Number(this.screen.width);
    const screenHeight = Number(this.screen.height);
    const processWidth = process.stdout.columns;
    const processHeight = process.stdout.rows;
    
    debugLog(`Refresh - Screen: ${screenWidth}x${screenHeight}, Process: ${processWidth}x${processHeight}`);
    
    // Trigger resize handling
    this.handleResize();
    
    this.setStatus(`UI refreshed - Terminal size: ${screenWidth}x${screenHeight}`);
  }

  private async reloadFromDisk(): Promise<void> {
    debugLog('Reloading all state from disk');
    
    this.personas = await listPersonas();
    
    if (!this.personas.find(p => p.name === this.activePersona)) {
      debugLog(`Active persona '${this.activePersona}' no longer exists, switching to 'ei'`);
      this.activePersona = 'ei';
    }
    
    const history = await loadHistory(this.activePersona);
    this.messages = history.messages;
    
    this.personaStates.clear();
    this.unreadCounts.clear();
    
    for (const persona of this.personas) {
      await this.loadPersistedPauseState(persona.name);
      const unreadCount = await getUnreadSystemMessageCount(persona.name);
      this.unreadCounts.set(persona.name, unreadCount);
    }
    
    this.render();
    this.autoScrollToBottom();
    
    debugLog('State reload from disk complete');
  }

  private async handleCtrlE(): Promise<void> {
    const isPersonaCreation = !!this.pendingPersonaCreation;
    const previousStatus = this.statusMessage;
    
    const pendingFromStorage = isPersonaCreation ? [] : await getPendingMessages(this.activePersona);
    const pendingContent = pendingFromStorage.map((m) => m.content).join('\n\n');
    const currentInput = this.pendingMultiLineContent || this.layoutManager.getInputBox().getValue() || '';
    
    const combinedContent = isPersonaCreation 
      ? currentInput 
      : [pendingContent, currentInput].filter(Boolean).join('\n\n');
    
    const editor = process.env.EDITOR || 'vim';
    const tmpFile = `/tmp/ei-edit-${Date.now()}.md`;
    
    debugLog(`Ctrl+E: opening ${editor} with content (${combinedContent.length} chars, ${pendingFromStorage.length} pending messages, personaCreation: ${isPersonaCreation})`);
    
    try {
      writeFileSync(tmpFile, combinedContent, 'utf-8');
      
      this.setStatus(`Opening ${editor}...`);
      this.screen.render();
      
      await new Promise<void>((resolve) => {
        this.screen.exec(editor, [tmpFile], {}, async (err, ok) => {
          debugLog(`Editor exited with err: ${err}, ok: ${ok}`);
          
          if (!err && ok) {
            const content = readFileSync(tmpFile, 'utf-8');
            const trimmed = content.trim();
            
            if (isPersonaCreation) {
              this.layoutManager.getInputBox().setValue(trimmed);
              this.inputHasText = trimmed.length > 0;
              this.setStatus(previousStatus);
            } else if (trimmed) {
              if (pendingFromStorage.length > 0) {
                await replacePendingMessages(trimmed, this.activePersona);
              }
              this.setEditorContent(trimmed);
            } else {
              if (pendingFromStorage.length > 0) {
                await replacePendingMessages('', this.activePersona);
              }
              this.clearEditorContent();
              this.setStatus('(empty, cleared)');
              setTimeout(() => {
                if (this.statusMessage === '(empty, cleared)') {
                  this.setStatus(null);
                }
              }, 3000);
            }
          } else {
            this.setStatus(`Editor exited with error`);
          }
          
          try {
            unlinkSync(tmpFile);
            debugLog(`Cleaned up temp file: ${tmpFile}`);
          } catch {
            debugLog(`Temp file cleanup skipped: ${tmpFile}`);
          }
          
          this.focusManager.focusInput();
          this.render();
          resolve();
        });
      });
    } catch (error) {
      debugLog(`Ctrl+E error: ${error instanceof Error ? error.message : String(error)}`);
      this.setStatus(`Editor error: ${error instanceof Error ? error.message : String(error)}`);
      this.focusManager.focusInput();
      this.render();
    }
  }

  private setEditorContent(content: string): void {
    const lineCount = content.split('\n').length;
    const isMultiLine = lineCount > 1;
    
    if (isMultiLine) {
      this.pendingMultiLineContent = content;
      const preview = `[${lineCount} lines] ${content.substring(0, 40).replace(/\n/g, ' ')}...`;
      this.layoutManager.getInputBox().setValue(preview);
      this.inputHasText = true;
      this.setStatus('Ctrl+E to edit, Enter to send, Ctrl+C to clear');
    } else {
      this.pendingMultiLineContent = null;
      this.layoutManager.getInputBox().setValue(content);
      this.inputHasText = content.length > 0;
      this.setStatus(null);
    }
    this.screen.render();
  }

  private clearEditorContent(): void {
    this.pendingMultiLineContent = null;
    this.layoutManager.getInputBox().clearValue();
    this.inputHasText = false;
  }

  private addMessage(role: 'human' | 'system', content: string, state?: MessageState) {
    const message: Message = {
      role,
      content,
      timestamp: new Date().toISOString(),
      state
    };
    this.messages.push(message);
    
    // Auto-scroll to bottom when adding new messages for active persona
    if (role === 'system' || role === 'human') {
      setTimeout(() => {
        this.autoScrollToBottom();
        this.screen.render();
      }, 0);
    }
  }

  private queueMessage(input: string) {
    const ps = this.getOrCreatePersonaState(this.activePersona);
    ps.messageQueue.push(input.trim());
    
    if (ps.isPaused) {
      debugLog(`queueMessage: ${this.activePersona} is paused, message queued (${ps.messageQueue.length} total)`);
      this.setStatus(`Message queued (${this.activePersona} is paused)`);
      return;
    }
    
    this.resetPersonaHeartbeat(this.activePersona);

    if (ps.isProcessing) {
      this.abortPersonaOperation(this.activePersona);
      return;
    }

    const totalLength = ps.messageQueue.join(' ').length;
    if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
      if (ps.debounceTimer) {
        clearTimeout(ps.debounceTimer);
        ps.debounceTimer = null;
      }
      debugLog(`queueMessage: immediate processing for ${this.activePersona} (length: ${totalLength})`);
      this.processPersonaQueue(this.activePersona);
    } else {
      debugLog(`queueMessage: scheduling debounce for ${this.activePersona} (length: ${totalLength})`);
      this.schedulePersonaDebounce(this.activePersona);
    }
  }

  private async processPersonaQueue(personaName: string) {
    const ps = this.getOrCreatePersonaState(personaName);
    
    if (ps.isPaused) {
      debugLog(`processPersonaQueue: skipping ${personaName} - persona is paused (${ps.messageQueue.length} messages queued)`);
      return;
    }
    
    if (ps.messageQueue.length === 0 || ps.isProcessing) {
      debugLog(`processPersonaQueue: skipping ${personaName} - queue:${ps.messageQueue.length}, processing:${ps.isProcessing}`);
      return;
    }

    debugLog(`processPersonaQueue: starting ${personaName} with ${ps.messageQueue.length} messages`);
    
    const combinedMessage = ps.messageQueue.join('\n');
    ps.abortController = new AbortController();
    ps.isProcessing = true;
    this.personaRenderer.updateSpinnerAnimation(this.personaStates);
    
    if (personaName === this.activePersona) {
      this.isProcessing = true;
      this.render();
    }

    try {
      const result = await processEvent(combinedMessage, personaName, DEBUG, ps.abortController.signal);
      
      if (!result.aborted) {
        ps.messageQueue = [];
        if (personaName === this.activePersona) {
          this.updateLastHumanMessageState('sent');
        }
        if (result.response) {
          if (personaName === this.activePersona) {
            this.addMessage('system', result.response);
          } else {
            ps.unreadCount++;
            this.unreadCounts.set(personaName, ps.unreadCount);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof LLMAbortedError)) {
        ps.messageQueue = [];
        if (personaName === this.activePersona) {
          this.updateLastHumanMessageState('failed');
          this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      debugLog(`processPersonaQueue: finished ${personaName}`);
      ps.isProcessing = false;
      ps.abortController = null;
      this.personaRenderer.updateSpinnerAnimation(this.personaStates);
      
      if (personaName === this.activePersona) {
        this.isProcessing = false;
      }

      this.render();

      if (ps.messageQueue.length > 0) {
        debugLog(`processPersonaQueue: retriggering ${personaName} - queue has ${ps.messageQueue.length} messages`);
        this.processPersonaQueue(personaName);
      } else {
        this.resetPersonaHeartbeat(personaName);
      }
    }
  }

  private updateLastHumanMessageState(newState: MessageState | undefined) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'human' && this.messages[i].state !== 'sent') {
        this.messages[i] = { ...this.messages[i], state: newState };
        break;
      }
    }
  }

  private getOrCreatePersonaState(personaName: string): PersonaState {
    let ps = this.personaStates.get(personaName);
    if (!ps) {
      ps = {
        name: personaName,
        heartbeatTimer: null,
        debounceTimer: null,
        lastActivity: Date.now(),
        isProcessing: false,
        messageQueue: [],
        unreadCount: 0,
        abortController: null,
        isPaused: false,
        pauseUntil: undefined,
        pauseTimer: null
      };
      this.personaStates.set(personaName, ps);
    }
    return ps;
  }

  private resetPersonaHeartbeat(personaName: string) {
    const ps = this.getOrCreatePersonaState(personaName);
    
    if (ps.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
    }
    
    if (ps.isPaused) {
      debugLog(`Skipping heartbeat for ${personaName}: persona is paused`);
      return;
    }
    
    ps.lastActivity = Date.now();
    
    ps.heartbeatTimer = setTimeout(async () => {
      if (ps.isPaused) {
        debugLog(`Heartbeat skipped for ${personaName}: persona is paused`);
        return;
      }
      
      if (ps.messageQueue.length > 0 || ps.isProcessing) {
        this.resetPersonaHeartbeat(personaName);
        return;
      }

      try {
        await applyConceptDecay(personaName);
        
        const shouldSpeak = await checkConceptDeltas(personaName);
        
        if (!shouldSpeak) {
          debugLog(`Heartbeat for ${personaName}: no significant deltas, skipping LLM call`);
          this.resetPersonaHeartbeat(personaName);
          return;
        }
        
        debugLog(`Heartbeat for ${personaName}: significant delta detected, generating response`);
        
        ps.abortController = new AbortController();
        ps.isProcessing = true;
        this.personaRenderer.updateSpinnerAnimation(this.personaStates);
        
        if (personaName === this.activePersona) {
          this.isProcessing = true;
          this.render();
        }

        const result = await processEvent(null, personaName, DEBUG, ps.abortController.signal);
        if (!result.aborted && result.response) {
          if (personaName === this.activePersona) {
            this.addMessage('system', result.response);
          } else {
            ps.unreadCount++;
            this.unreadCounts.set(personaName, ps.unreadCount);
          }
        }
      } catch (err) {
        if (!(err instanceof LLMAbortedError)) {
          if (personaName === this.activePersona) {
            this.setStatus(`Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } finally {
        ps.isProcessing = false;
        ps.abortController = null;
        this.personaRenderer.updateSpinnerAnimation(this.personaStates);
        if (personaName === this.activePersona) {
          this.isProcessing = false;
        }
        this.render();
        this.resetPersonaHeartbeat(personaName);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }



  private schedulePersonaDebounce(personaName: string) {
    const ps = this.getOrCreatePersonaState(personaName);
    
    if (ps.debounceTimer) {
      clearTimeout(ps.debounceTimer);
    }
    debugLog(`schedulePersonaDebounce: scheduling ${personaName} in ${DEBOUNCE_MS}ms`);
    ps.debounceTimer = setTimeout(() => {
      debugLog(`schedulePersonaDebounce: timer fired for ${personaName}`);
      this.processPersonaQueue(personaName);
    }, DEBOUNCE_MS);
  }

  private abortPersonaOperation(personaName: string) {
    const ps = this.personaStates.get(personaName);
    if (ps?.abortController) {
      ps.abortController.abort();
      ps.abortController = null;
      
      if (personaName === this.activePersona) {
        this.updateLastHumanMessageState('failed');
      }
      
      ps.messageQueue = [];
      ps.isProcessing = false;
      this.personaRenderer.updateSpinnerAnimation(this.personaStates);
      
      if (personaName === this.activePersona) {
        this.isProcessing = false;
      }
    }
  }

  private startStaleMessageChecker(): void {
    debugLog('Starting stale message checker');
    this.staleMessageCheckInterval = setInterval(
      () => this.checkForStaleMessages(),
      STALE_CHECK_INTERVAL_MS
    );
  }

  private async checkForStaleMessages(): Promise<void> {
    const cutoffTime = new Date(Date.now() - STALE_MESSAGE_THRESHOLD_MS).toISOString();
    debugLog(`Checking for stale messages (before ${cutoffTime})`);

    for (const persona of this.personas) {
      const staleMessages = await getUnprocessedMessages(persona.name, cutoffTime);

      if (staleMessages.length > 0) {
        debugLog(`Found ${staleMessages.length} stale messages for ${persona.name}`);
        const queue = ConceptQueue.getInstance();

        queue.enqueue({
          persona: persona.name,
          target: "system",
          messages: staleMessages,
          priority: "normal"
        });

        queue.enqueue({
          persona: persona.name,
          target: "human",
          messages: staleMessages,
          priority: "normal"
        });
      }
    }
  }

  private async switchPersona(personaName: string) {
    if (personaName === this.activePersona) {
      this.autoScrollToBottom();
      this.setStatus(`Scrolled to latest in: ${personaName}`);
      return;
    }

    try {
      // Queue concept updates for the persona being backgrounded (high priority)
      const unprocessedMessages = await getUnprocessedMessages(this.activePersona);
      if (unprocessedMessages.length > 0) {
        debugLog(`Queueing concept updates for backgrounded persona ${this.activePersona} (${unprocessedMessages.length} messages)`);
        const queue = ConceptQueue.getInstance();
        queue.enqueue({
          persona: this.activePersona,
          target: "system",
          messages: unprocessedMessages,
          priority: "high"
        });
        queue.enqueue({
          persona: this.activePersona,
          target: "human",
          messages: unprocessedMessages,
          priority: "high"
        });
      }

      const history = await loadHistory(personaName);
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      await markSystemMessagesAsRead(personaName);
      
      const ps = this.getOrCreatePersonaState(personaName);
      ps.unreadCount = 0;
      this.unreadCounts.delete(personaName);
      
      this.activePersona = personaName;
      this.messages = recent;
      this.isProcessing = ps.isProcessing;
      
      this.layoutManager.getChatHistory().setLabel(`Chat: ${personaName}`);
      this.setStatus(`Switched to persona: ${personaName}`);
      
      this.resetPersonaHeartbeat(personaName);
      
      // Reset scroll position and render
      this.layoutManager.getChatHistory().scrollTo(0);
      this.render();
      
      setTimeout(() => {
        this.layoutManager.getChatHistory().scrollTo(0);
        setTimeout(() => {
          this.autoScrollToBottom();
          this.screen.render();
        }, 0);
      }, 0);
      
      this.focusManager.maintainFocus();
    } catch (err) {
      this.setStatus(`Error loading persona: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private setStatus(msg: string | null) {
    this.statusMessage = msg;
    this.render();
  }

  private render() {
    this.personaRenderer.render(
      this.layoutManager.getPersonaList(),
      this.personas,
      this.activePersona,
      this.unreadCounts,
      this.personaStates,
      this.screen.width as number
    );
    
    this.chatRenderer.render(
      this.layoutManager.getChatHistory(),
      this.messages,
      this.activePersona
    );
    
    this.renderStatus();
    
    this.focusManager.maintainFocus();
    this.screen.render();
  }

  private renderStatus() {
    let status = '';
    if (this.isProcessing) {
      status += '{cyan-fg}thinking...{/cyan-fg} ';
    }
    if (this.statusMessage) {
      status += this.statusMessage;
    }
    this.layoutManager.getStatusBar().setContent(status);
  }

  private scrollChatHistory(lines: number) {
    debugLog(`SCROLL: attempting to scroll ${lines} lines`);
    
    const beforeScroll = this.layoutManager.getChatHistory().getScroll();
    this.layoutManager.getChatHistory().scroll(lines);
    const afterScroll = this.layoutManager.getChatHistory().getScroll();
    
    debugLog(`SCROLL: moved from ${beforeScroll} to ${afterScroll}`);
    this.screen.render();
  }

  private autoScrollToBottom() {
    debugLog(`DEBUG autoScroll: letting blessed handle scroll to bottom`);
    this.layoutManager.getChatHistory().scrollTo(this.layoutManager.getChatHistory().getScrollHeight());
    const actualScroll = this.layoutManager.getChatHistory().getScroll();
    debugLog(`DEBUG autoScroll: ended at position ${actualScroll}`);
  }

  private executeExitLogic() {
    debugLog('=== EXIT LOGIC START ===');
    debugLog('Exit logic called - starting proper handling chain');
    
    const activePs = this.getOrCreatePersonaState(this.activePersona);
    debugLog(`Active persona: ${this.activePersona}`);
    debugLog(`Active persona state: isProcessing=${activePs.isProcessing}, messageQueue=${activePs.messageQueue.length}`);
    
    // Priority 1: Abort active persona processing
    if (activePs.isProcessing) {
      debugLog('BRANCH: Aborting active persona operation');
      this.abortPersonaOperation(this.activePersona);
      this.setStatus('Aborted current operation');
      debugLog('=== EXIT LOGIC END (aborted active) ===');
      return;
    }

    // Priority 2: Clear input text
    debugLog(`Input has text: ${this.inputHasText}`);
    debugLog(`Input box value: "${this.layoutManager.getInputBox().getValue()}"`);
    
    if (this.inputHasText) {
      debugLog('BRANCH: Clearing input text');
      this.layoutManager.getInputBox().clearValue();
      this.inputHasText = false;
      this.setStatus('Input cleared');
      debugLog('=== EXIT LOGIC END (input cleared) ===');
      return;
    }

    // Priority 3: Warn about background processing
    const backgroundProcessing = this.getBackgroundProcessingPersonas();
    const now = Date.now();
    const timeSinceWarning = this.ctrlCWarningTimestamp ? now - this.ctrlCWarningTimestamp : Infinity;
    
    debugLog(`Background processing personas: [${backgroundProcessing.join(', ')}]`);
    debugLog(`Ctrl+C warning timestamp: ${this.ctrlCWarningTimestamp}, time since: ${timeSinceWarning}ms`);
    
    if (backgroundProcessing.length > 0 && 
        (!this.ctrlCWarningTimestamp || timeSinceWarning > CTRL_C_CONFIRMATION_WINDOW_MS)) {
      const names = backgroundProcessing.join(', ');
      debugLog(`BRANCH: Showing background processing warning for: ${names}`);
      this.ctrlCWarningTimestamp = now;
      this.setStatus(`Processing in progress for: ${names}. Press Ctrl+C again or use /quit --force to exit immediately.`);
      debugLog('=== EXIT LOGIC END (warning shown) ===');
      return;
    }

    // Priority 4: Exit application with graceful degradation
    debugLog('BRANCH: Exiting application - no blocking conditions');
    try {
      const cleanupResult = this.cleanup();
      
      if (!cleanupResult.success) {
        debugLog(`Cleanup had errors but continuing with exit: ${cleanupResult.errors.join('; ')}`);
        // Continue with exit even if cleanup had issues
      }
      
      this.screen.destroy();
      debugLog('=== EXIT LOGIC END (exiting) ===');
      process.exit(0);
    } catch (error) {
      debugLog(`Critical error during exit: ${error instanceof Error ? error.message : String(error)}`);
      // Force exit even if cleanup completely fails
      try {
        this.screen.destroy();
      } catch (screenError) {
        debugLog(`Screen destroy failed: ${screenError instanceof Error ? screenError.message : String(screenError)}`);
      }
      process.exit(1); // Exit with error code to indicate issues
    }
  }

  private handleCtrlC() {
    debugLog('=== CTRL+C HANDLER START ===');
    
    if (this.pendingMultiLineContent) {
      debugLog('BRANCH: Clearing pending multi-line content');
      this.clearEditorContent();
      this.setStatus('Multi-line content cleared');
      this.render();
      debugLog('=== CTRL+C HANDLER END (cleared multi-line) ===');
      return;
    }

    if (this.pendingPersonaCreation) {
      debugLog('BRANCH: Cancelling pending persona creation');
      this.pendingPersonaCreation = null;
      this.layoutManager.getInputBox().clearValue();
      this.setStatus('Persona creation cancelled');
      this.render();
      debugLog('=== CTRL+C HANDLER END (cancelled persona creation) ===');
      return;
    }
    
    debugLog('Ctrl+C pressed - delegating to shared exit logic');
    
    const anyProcessing = Array.from(this.personaStates.values()).some(ps => ps.isProcessing);
    const processingPersonas = Array.from(this.personaStates.entries())
      .filter(([name, ps]) => ps.isProcessing)
      .map(([name]) => name);
    
    debugLog('=== ALL PERSONA STATES ===');
    for (const [name, ps] of this.personaStates.entries()) {
      debugLog(`${name}: isProcessing=${ps.isProcessing}, messageQueue=${ps.messageQueue.length}, heartbeatTimer=${ps.heartbeatTimer ? 'active' : 'null'}, debounceTimer=${ps.debounceTimer ? 'active' : 'null'}`);
    }
    debugLog('=== END PERSONA STATES ===');
    
    debugLog(`Any processing: ${anyProcessing}`);
    debugLog(`Processing personas: [${processingPersonas.join(', ')}]`);
    
    // Special handling for Ctrl+C confirmation window
    if (anyProcessing) {
      const activePs = this.getOrCreatePersonaState(this.activePersona);
      
      // If active persona isn't processing but others are, check confirmation window
      if (!activePs.isProcessing) {
        const backgroundProcessing = this.getBackgroundProcessingPersonas();
        const now = Date.now();
        const timeSinceWarning = this.ctrlCWarningTimestamp ? now - this.ctrlCWarningTimestamp : Infinity;
        
        if (backgroundProcessing.length > 0 && 
            this.ctrlCWarningTimestamp && 
            timeSinceWarning <= CTRL_C_CONFIRMATION_WINDOW_MS) {
          debugLog('BRANCH: User confirmed exit within confirmation window - forcing exit');
          try {
            const cleanupResult = this.cleanup();
            
            if (!cleanupResult.success) {
              debugLog(`Cleanup had errors but continuing with confirmed exit: ${cleanupResult.errors.join('; ')}`);
            }
            
            this.screen.destroy();
            debugLog('=== CTRL+C HANDLER END (confirmed exit) ===');
            process.exit(0);
          } catch (error) {
            debugLog(`Critical error during confirmed exit: ${error instanceof Error ? error.message : String(error)}`);
            // Force exit even if cleanup fails
            try {
              this.screen.destroy();
            } catch (screenError) {
              debugLog(`Screen destroy failed during confirmed exit: ${screenError instanceof Error ? screenError.message : String(screenError)}`);
            }
            process.exit(1);
          }
          return;
        }
      }
    }
    
    // Delegate to shared exit logic
    this.executeExitLogic();
    debugLog('=== CTRL+C HANDLER END ===');
  }

  private getBackgroundProcessingPersonas(): string[] {
    return Array.from(this.personaStates.entries())
      .filter(([name, ps]) => name !== this.activePersona && ps.isProcessing)
      .map(([name]) => name);
  }

  private cleanup() {
    debugLog('Starting cleanup process...');
    let cleanupErrors: string[] = [];
    
    try {
      // Clean up test output capture if enabled
      if (testOutputCapture.isEnabled()) {
        try {
          testOutputCapture.restore();
          debugLog('Test output capture cleanup completed');
        } catch (error) {
          const errorMsg = `Failed to cleanup test output capture: ${error instanceof Error ? error.message : String(error)}`;
          debugLog(errorMsg);
          cleanupErrors.push(errorMsg);
        }
      }
      
      // Clean up persona states with individual error handling
      for (const [name, ps] of this.personaStates) {
        try {
          if (ps.heartbeatTimer) {
            clearTimeout(ps.heartbeatTimer);
            debugLog(`Cleared heartbeat timer for persona: ${name}`);
          }
          if (ps.debounceTimer) {
            clearTimeout(ps.debounceTimer);
            debugLog(`Cleared debounce timer for persona: ${name}`);
          }
          if (ps.abortController) {
            ps.abortController.abort();
            debugLog(`Aborted controller for persona: ${name}`);
          }
        } catch (error) {
          const errorMsg = `Failed to cleanup persona ${name}: ${error instanceof Error ? error.message : String(error)}`;
          debugLog(errorMsg);
          cleanupErrors.push(errorMsg);
          // Continue with other personas even if one fails
        }
      }
      
      // Clean up stale message checker interval
      if (this.staleMessageCheckInterval) {
        clearInterval(this.staleMessageCheckInterval);
        this.staleMessageCheckInterval = null;
        debugLog('Cleared stale message checker interval');
      }
      
      // Clean up persona renderer with error handling
      try {
        this.personaRenderer.cleanup();
        debugLog('PersonaRenderer cleanup completed');
      } catch (error) {
        const errorMsg = `Failed to cleanup PersonaRenderer: ${error instanceof Error ? error.message : String(error)}`;
        debugLog(errorMsg);
        cleanupErrors.push(errorMsg);
      }
      
      if (cleanupErrors.length > 0) {
        debugLog(`Cleanup completed with ${cleanupErrors.length} errors: ${cleanupErrors.join('; ')}`);
      } else {
        debugLog('Cleanup completed successfully');
      }
      
    } catch (error) {
      const errorMsg = `Critical cleanup error: ${error instanceof Error ? error.message : String(error)}`;
      debugLog(errorMsg);
      cleanupErrors.push(errorMsg);
    }
    
    // Return cleanup status for caller to handle if needed
    return {
      success: cleanupErrors.length === 0,
      errors: cleanupErrors
    };
  }

  async init() {
    debugLog(`init() called - Instance #${this.instanceId}`);
    try {
      await initializeDataDirectory();
      this.personas = await listPersonas();
      
      for (const persona of this.personas) {
        const unreadCount = await getUnreadSystemMessageCount(persona.name);
        if (unreadCount > 0) {
          const ps = this.getOrCreatePersonaState(persona.name);
          ps.unreadCount = unreadCount;
          this.unreadCounts.set(persona.name, unreadCount);
        }
        await this.loadPersistedPauseState(persona.name);
        this.resetPersonaHeartbeat(persona.name);
      }
      
      const history = await loadHistory('ei');
      this.messages = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      const ps = this.getOrCreatePersonaState('ei');
      ps.unreadCount = 0;
      this.unreadCounts.delete('ei');
      await markSystemMessagesAsRead('ei');
      
      this.startStaleMessageChecker();
      
      const countListeners = () => this.layoutManager.getInputBox().listeners('keypress').length;
      const listListeners = () => this.layoutManager.getInputBox().listeners('keypress').map(f => f.name || 'anonymous');
      debugLog(`Before focusInput: listeners=${countListeners()} [${listListeners().join(', ')}], _reading=${(this.layoutManager.getInputBox() as any)._reading}`);
      this.focusManager.focusInput();
      debugLog(`After focusInput: listeners=${countListeners()} [${listListeners().join(', ')}], _reading=${(this.layoutManager.getInputBox() as any)._reading}`);
      this.render();
      debugLog(`After render: listeners=${countListeners()} [${listListeners().join(', ')}], _reading=${(this.layoutManager.getInputBox() as any)._reading}`);
      this.autoScrollToBottom();
      
      await this.processPendingMessagesOnStartup();
      
      debugLog(`Screen setup - smartCSR: ${this.screen.options.smartCSR}, fullUnicode: ${this.screen.options.fullUnicode}`);
      debugLog(`Screen focused element: ${this.screen.focused ? this.screen.focused.type : 'none'}`);
      debugLog(`Input box element type: ${this.layoutManager.getInputBox().type}`);
      
      debugLog(`init() completed - Instance #${this.instanceId}`);
    } catch (err) {
      this.setStatus(`Initialization error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async processPendingMessagesOnStartup(): Promise<void> {
    for (const persona of this.personas) {
      const pending = await getPendingMessages(persona.name);
      if (pending.length > 0) {
        debugLog(`Found ${pending.length} pending messages for ${persona.name}`);
        const combinedMessage = pending.map((m) => m.content).join('\n');
        const ps = this.getOrCreatePersonaState(persona.name);
        ps.messageQueue.push(combinedMessage);
        
        if (persona.name === this.activePersona) {
          for (const msg of pending) {
            const existing = this.messages.find(
              (m) => m.role === 'human' && m.content === msg.content && m.timestamp === msg.timestamp
            );
            if (existing && !existing.state) {
              existing.state = 'processing';
            }
          }
          this.render();
        }
        
        this.processPersonaQueue(persona.name);
      }
    }
  }

  // ============================================================================
  // Test Input Injection System
  // ============================================================================

  /**
   * Sets up test input injection system for E2E testing
   * This allows tests to inject input directly into the application
   */
  private setupTestInputInjection(): void {
    debugLog(`Setting up test input injection - Instance #${this.instanceId}`);
    
    // Listen for test input on stdin in addition to blessed input
    if (process.stdin && process.stdin.readable) {
      process.stdin.on('data', (data: Buffer) => {
        const input = data.toString().trim();
        debugLog(`Test input received: "${input}" - Instance #${this.instanceId}`);
        
        // Process the input as if it came from the UI
        this.processTestInput(input);
      });
      
      // Make sure stdin is in the right mode
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false); // We want line-buffered input for testing
      }
      process.stdin.resume();
    }
    
    debugLog(`Test input injection setup complete - Instance #${this.instanceId}`);
  }

  /**
   * Processes input received through the test injection system
   * Routes all input through handleSubmit() which handles both commands and messages
   */
  private processTestInput(input: string): void {
    debugLog(`Processing test input: "${input}" - Instance #${this.instanceId}`);
    
    if (input.length > 0) {
      this.handleSubmit(input);
    }
  }

  /**
   * Public method for tests to inject input directly
   * This can be called by test frameworks that have access to the app instance
   */
  public injectTestInput(input: string): void {
    if (!this.testInputEnabled) {
      debugLog(`Test input injection attempted but not enabled - Instance #${this.instanceId}`);
      return;
    }
    
    debugLog(`Direct test input injection: "${input}" - Instance #${this.instanceId}`);
    this.processTestInput(input);
  }
}
