#!/usr/bin/env node

import blessed from 'blessed';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
// Import test output capture early to intercept blessed methods before they're used
import { testOutputCapture } from './test-output-capture.js';

import { loadHistory, listPersonas, findPersonaByNameOrAlias, initializeDataDirectory, initializeDebugLog, appendDebugLog, getPendingMessages, replacePendingMessages, appendHumanMessage, getUnprocessedMessages, loadConceptMap, saveConceptMap } from '../storage.js';
import { createPersonaWithLLM, saveNewPersona } from '../persona-creator.js';
import type { Concept } from '../types.js';
import { ConceptQueue } from '../concept-queue.js';
import { processEvent } from '../processor.js';
import { LLMAbortedError } from '../llm.js';
import type { Message, MessageState, PersonaState } from '../types.js';
import { LayoutManager } from './layout-manager.js';
import { FocusManager } from './focus-manager.js';
import { PersonaRenderer } from './persona-renderer.js';
import { ChatRenderer } from './chat-renderer.js';

// Initialize debug log file
initializeDebugLog();

function debugLog(message: string) {
  appendDebugLog(message);
}

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = DEBUG ? 600 * 1000 : THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;
const STARTUP_HISTORY_COUNT = 20;

// Ctrl+C confirmation window - user has this long to press Ctrl+C again to exit
const CTRL_C_CONFIRMATION_WINDOW_MS = 3000; // 3 seconds

// Stale message concept processing constants
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const STALE_MESSAGE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

// Heartbeat trigger constants
const DESIRE_GAP_THRESHOLD = 0.3;   // Trigger when level_ideal - level_current exceeds this
const SENTIMENT_FLOOR = -0.5;        // Don't bring up topics with sentiment below this
const MIN_DECAY_CHANGE = 0.001; // Threshold to avoid micro-updates
const MIN_HOURS_SINCE_UPDATE = 0.1; // Skip if updated in last 6 minutes

/**
 * Logarithmic decay formula for level_current.
 * 
 * Rate is fastest at middle values (0.5), slowest at extremes (0.0, 1.0).
 * This models natural "forgetting" - recent memories fade quickly,
 * but deeply ingrained or completely forgotten things change slowly.
 * 
 * Formula: decay = k * value * (1 - value) * hours
 * Where k is a tuning constant (default 0.1)
 */
function calculateLogarithmicDecay(currentValue: number, hoursSinceUpdate: number): number {
  const K = 0.1; // Tuning constant - adjust based on feel
  const decay = K * currentValue * (1 - currentValue) * hoursSinceUpdate;
  
  // Always decay toward 0.0
  return Math.max(0, currentValue - decay);
}

export class EIApp {
  private screen: blessed.Widgets.Screen;
  private layoutManager: LayoutManager;
  private focusManager: FocusManager;
  private personaRenderer: PersonaRenderer;
  private chatRenderer: ChatRenderer;
  
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
    
    // Check if we're in test mode
    this.testInputEnabled = process.env.NODE_ENV === 'test' || process.env.EI_TEST_INPUT === 'true';
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

    this.addMessage('human', actualContent, 'processing');
    await appendHumanMessage(actualContent, this.activePersona);
    this.queueMessage(actualContent);
    this.layoutManager.getInputBox().clearValue();
    
    this.focusManager.maintainFocus();
    this.render();
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
      case 'help':
      case 'h':
        this.setStatus('Commands: /persona, /editor|/e, /quit|/q [--force], /refresh, /help | Keys: Ctrl+E (editor), Ctrl+H (personas), Ctrl+L (input), Ctrl+R (refresh), Ctrl+C (exit)');
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

    const foundPersona = await findPersonaByNameOrAlias(trimmed.toLowerCase());
    if (foundPersona) {
      await this.switchPersona(foundPersona);
    } else {
      const validationError = this.validatePersonaName(trimmed);
      if (validationError) {
        this.setStatus(validationError);
        return;
      }
      this.pendingPersonaCreation = { name: trimmed, stage: 'confirm' };
      this.setStatus(`Persona '${trimmed}' not found. Create it? (y/n)`);
    }
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
    this.resetPersonaHeartbeat(this.activePersona);

    if (ps.isProcessing) {
      this.abortPersonaOperation(this.activePersona);
      return;
    }

    const totalLength = ps.messageQueue.join(' ').length;
    if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
      // Clear any pending debounce timer since we're processing immediately
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
        abortController: null
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
    
    ps.lastActivity = Date.now();
    
    ps.heartbeatTimer = setTimeout(async () => {
      if (ps.messageQueue.length > 0 || ps.isProcessing) {
        this.resetPersonaHeartbeat(personaName);
        return;
      }

      try {
        await this.applyConceptDecay(personaName);
        
        const shouldSpeak = await this.checkConceptDeltas(personaName);
        
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

  private async applyConceptDecay(personaName: string): Promise<boolean> {
    const concepts = await loadConceptMap("system", personaName);
    const now = Date.now();
    let changed = false;
    
    for (const concept of concepts.concepts) {
      const lastUpdated = concept.last_updated 
        ? new Date(concept.last_updated).getTime() 
        : now;
      const hoursSince = (now - lastUpdated) / (1000 * 60 * 60);
      
      if (hoursSince < MIN_HOURS_SINCE_UPDATE) continue;
      
      const newValue = calculateLogarithmicDecay(concept.level_current, hoursSince);
      const decay = concept.level_current - newValue;
      if (Math.abs(decay) > MIN_DECAY_CHANGE) {
        concept.level_current = newValue;
        concept.last_updated = new Date().toISOString();
        changed = true;
        debugLog(`Decay applied to "${concept.name}": ${decay.toFixed(4)} (now ${concept.level_current.toFixed(2)})`);
      }
    }
    
    if (changed) {
      await saveConceptMap(concepts, personaName);
      debugLog(`Applied concept decay to ${personaName}`);
    }
    
    return changed;
  }

  private async checkConceptDeltas(personaName: string): Promise<boolean> {
    const concepts = await loadConceptMap("system", personaName);
    
    for (const concept of concepts.concepts) {
      // Only trigger if they WANT to discuss MORE than they have been
      const desireGap = concept.level_ideal - concept.level_current;
      
      if (desireGap >= DESIRE_GAP_THRESHOLD && concept.sentiment > SENTIMENT_FLOOR) {
        debugLog(`Heartbeat trigger: "${concept.name}" - desire gap ${desireGap.toFixed(2)}, sentiment ${concept.sentiment.toFixed(2)}`);
        return true;
      }
    }
    
    return false;
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
    if (personaName === this.activePersona) return;

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
      const history = await loadHistory('ei');
      this.messages = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      for (const persona of this.personas) {
        this.resetPersonaHeartbeat(persona.name);
      }
      
      this.startStaleMessageChecker();
      
      this.focusManager.focusInput();
      this.render();
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
   */
  private processTestInput(input: string): void {
    debugLog(`Processing test input: "${input}" - Instance #${this.instanceId}`);
    
    // Handle commands (starting with /)
    if (input.startsWith('/')) {
      debugLog(`Test command detected: "${input}" - Instance #${this.instanceId}`);
      
      // Normalize command by trimming and converting to lowercase
      const normalizedCommand = input.trim().toLowerCase();
      
      if (normalizedCommand === '/quit' || normalizedCommand === '/q') {
        debugLog(`Test quit command - Instance #${this.instanceId}`);
        this.handleQuit();
        return;
      }
      
      // Handle other commands here as they're implemented
      debugLog(`Unknown test command: "${input}" - Instance #${this.instanceId}`);
      return;
    }
    
    // Handle regular messages
    if (input.length > 0) {
      debugLog(`Test message submission: "${input}" - Instance #${this.instanceId}`);
      this.handleSubmit(input);
    }
  }

  /**
   * Handles quit command for testing
   */
  private handleQuit(): void {
    debugLog(`Handling quit command - Instance #${this.instanceId}`);
    
    // Clean exit for testing
    this.screen.destroy();
    process.exit(0);
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