#!/usr/bin/env node

import blessed from 'blessed';
import { loadHistory, listPersonas, findPersonaByNameOrAlias, initializeDataDirectory, initializeDebugLog, appendDebugLog } from '../storage.js';
import { LLMAbortedError } from '../llm.js';
import type { Message, MessageState, PersonaState } from '../types.js';
import { LayoutManager } from './layout-manager.js';
import { FocusManager } from './focus-manager.js';
import { PersonaRenderer } from './persona-renderer.js';
import { ChatRenderer } from './chat-renderer.js';
import { CommandHandler } from './command-handler.js';
import { PersonaManager } from './persona-manager.js';
import { MessageProcessor } from './message-processor.js';
import { TestSupport } from './test-support.js';
import type { ICommandHandler, IPersonaManager, IMessageProcessor, ITestSupport } from './interfaces.js';

// Initialize debug log file
initializeDebugLog();

function debugLog(message: string) {
  appendDebugLog(message);
}

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const STARTUP_HISTORY_COUNT = 20;

// Ctrl+C confirmation window - user has this long to press Ctrl+C again to exit
const CTRL_C_CONFIRMATION_WINDOW_MS = 3000; // 3 seconds

export class EIApp {
  private screen: blessed.Widgets.Screen;
  private layoutManager: LayoutManager;
  private focusManager: FocusManager;
  private personaRenderer: PersonaRenderer;
  private chatRenderer: ChatRenderer;
  private commandHandler: ICommandHandler;
  private personaManager: IPersonaManager;
  private messageProcessor: IMessageProcessor;
  private testSupport: ITestSupport;
  
  private personas: any[] = [];
  private activePersona = 'ei';
  private messages: Message[] = [];
  private statusMessage: string | null = null;
  
  // Ctrl+C state tracking
  private ctrlCWarningTimestamp: number | null = null;
  private inputHasText = false;
  
  // Prevent duplicate submissions
  private lastSubmissionTime = 0;
  private lastSubmissionText = '';
  
  // Track instance creation
  private static instanceCount = 0;
  private instanceId: number;

  constructor() {
    EIApp.instanceCount++;
    this.instanceId = EIApp.instanceCount;
    debugLog(`EIApp constructor starting - Instance #${this.instanceId}`);
    
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

    // Initialize PersonaManager
    this.personaManager = new PersonaManager({
      personaRenderer: this.personaRenderer,
      chatRenderer: this.chatRenderer,
      layoutManager: this.layoutManager
    });
    debugLog(`PersonaManager created - Instance #${this.instanceId}`);

    // Initialize MessageProcessor
    this.messageProcessor = new MessageProcessor({
      chatRenderer: this.chatRenderer,
      personaManager: this.personaManager,
      app: this as any
    });
    debugLog(`MessageProcessor created - Instance #${this.instanceId}`);

    // Initialize CommandHandler with proper dependencies
    this.commandHandler = new CommandHandler({
      personaManager: this.personaManager,
      messageProcessor: this.messageProcessor,
      app: this as any
    });
    debugLog(`CommandHandler created - Instance #${this.instanceId}`);

    // Initialize TestSupport
    this.testSupport = new TestSupport({
      commandHandler: this.commandHandler,
      messageProcessor: this.messageProcessor,
      app: this as any
    }, this.instanceId);
    debugLog(`TestSupport created - Instance #${this.instanceId}`);

    // Pass screen reference to persona renderer for spinner animation
    this.personaRenderer.setScreen(this.screen);
    this.personaRenderer.setRenderCallback(() => this.render());
    debugLog(`PersonaRenderer configured - Instance #${this.instanceId}`);

    // Set up event handlers
    this.layoutManager.setSubmitHandler((text: string) => this.handleSubmit(text));
    this.layoutManager.setCtrlCHandler(() => this.handleCtrlC());
    debugLog(`Submit and Ctrl+C handlers set - Instance #${this.instanceId}`);

    // Set up test input injection if enabled
    this.testSupport.setupTestInputInjection();

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

    // Set up scrolling key bindings
    this.setupScrollingKeyBindings();

    // Track input text changes for Ctrl+C logic
    this.layoutManager.getInputBox().on('keypress', (ch, key) => {
      // Check if input has text after keypress
      setTimeout(() => {
        const currentValue = this.layoutManager.getInputBox().getValue();
        const hasText = currentValue.trim().length > 0;
        
        if (hasText !== this.inputHasText) {
          debugLog(`Input text state changed: ${this.inputHasText} -> ${hasText} (value: "${currentValue}")`);
          this.inputHasText = hasText;
        }
        
        // Reset Ctrl+C warning timestamp on any keypress EXCEPT Ctrl+C itself
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
    if (!text.trim()) return;

    debugLog(`handleSubmit called - Instance #${this.instanceId}: "${text}"`);

    // Prevent duplicate submissions within 2 seconds
    const now = Date.now();
    const timeSinceLastSubmit = now - this.lastSubmissionTime;
    
    if (timeSinceLastSubmit < 2000 && text === this.lastSubmissionText) {
      debugLog(`Duplicate submission prevented - Instance #${this.instanceId}`);
      return;
    }
    
    this.lastSubmissionTime = now;
    this.lastSubmissionText = text;

    debugLog(`handleSubmit: processing "${text}" - Instance #${this.instanceId}`);

    this.setStatus(null);
    
    // Reset Ctrl+C warning timestamp and input state
    this.ctrlCWarningTimestamp = null;
    this.inputHasText = false;

    // Handle commands
    if (text.startsWith('/')) {
      const parsedCommand = this.commandHandler.parseCommand(text);
      if (parsedCommand) {
        await this.commandHandler.executeCommand(parsedCommand);
      } else {
        this.setStatus(`Unknown command: ${text}`);
      }
      this.layoutManager.getInputBox().clearValue();
      this.focusManager.maintainFocus();
      return;
    }

    // Add user message and queue for processing
    await this.messageProcessor.processMessage(this.activePersona, text);
    this.layoutManager.getInputBox().clearValue();
    
    this.focusManager.maintainFocus();
    this.render();
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


  private updateLastHumanMessageState(newState: MessageState | undefined) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'human' && this.messages[i].state !== 'sent') {
        this.messages[i] = { ...this.messages[i], state: newState };
        break;
      }
    }
  }







  private async switchPersona(personaName: string) {
    if (personaName === this.activePersona) return;

    try {
      const recent = await this.personaManager.switchPersona(personaName);
      
      this.activePersona = personaName;
      this.messages = recent;
      
      this.setStatus(`Switched to persona: ${personaName}`);
      
      this.messageProcessor.resetHeartbeat(personaName);
      
      // Reset scroll position and render
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

  // Public methods for CommandHandler delegation
  public executeExitLogic() {
    debugLog('=== EXIT LOGIC START ===');
    debugLog('Exit logic called - starting proper handling chain');
    
    const activePs = this.personaManager.getPersonaState(this.activePersona);
    debugLog(`Active persona: ${this.activePersona}`);
    debugLog(`Active persona state: isProcessing=${activePs.isProcessing}, messageQueue=${activePs.messageQueue.length}`);
    
    // Priority 1: Abort active persona processing
    if (activePs.isProcessing) {
      debugLog('BRANCH: Aborting active persona operation');
      this.messageProcessor.abortProcessing(this.activePersona);
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
    const backgroundProcessing = this.personaManager.getBackgroundProcessingPersonas();
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

  public handleRefreshCommand() {
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

  public cleanup() {
    debugLog('Starting cleanup process...');
    let cleanupErrors: string[] = [];
    
    try {
      // Clean up persona manager
      try {
        this.personaManager.cleanup();
        debugLog('PersonaManager cleanup completed');
      } catch (error) {
        const errorMsg = `Failed to cleanup PersonaManager: ${error instanceof Error ? error.message : String(error)}`;
        debugLog(errorMsg);
        cleanupErrors.push(errorMsg);
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

  public getCurrentPersona(): string {
    return this.activePersona;
  }

  private render() {
    this.personaRenderer.render(
      this.layoutManager.getPersonaList(),
      this.personas,
      this.activePersona,
      this.personaManager.getUnreadCounts(),
      this.personaManager.getAllPersonaStates(),
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
    if (this.messageProcessor.isProcessing(this.activePersona)) {
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

  private handleCtrlC() {
    debugLog('=== CTRL+C HANDLER START ===');
    debugLog('Ctrl+C pressed - delegating to shared exit logic');
    
    // Check if ANY persona is processing (active or background)
    const anyProcessing = this.personaManager.isAnyPersonaProcessing();
    const processingPersonas = this.personaManager.getProcessingPersonas();
    
    // Detailed persona state logging
    debugLog('=== ALL PERSONA STATES ===');
    for (const [name, ps] of this.personaManager.getAllPersonaStates().entries()) {
      debugLog(`${name}: isProcessing=${ps.isProcessing}, messageQueue=${ps.messageQueue.length}, heartbeatTimer=${ps.heartbeatTimer ? 'active' : 'null'}, debounceTimer=${ps.debounceTimer ? 'active' : 'null'}`);
    }
    debugLog('=== END PERSONA STATES ===');
    
    debugLog(`Any processing: ${anyProcessing}`);
    debugLog(`Processing personas: [${processingPersonas.join(', ')}]`);
    
    // Special handling for Ctrl+C confirmation window
    if (anyProcessing) {
      const activePs = this.personaManager.getPersonaState(this.activePersona);
      
      // If active persona isn't processing but others are, check confirmation window
      if (!activePs.isProcessing) {
        const backgroundProcessing = this.personaManager.getBackgroundProcessingPersonas();
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

  async init() {
    debugLog(`init() called - Instance #${this.instanceId}`);
    try {
      await initializeDataDirectory();
      this.personas = await listPersonas();
      
      // Initialize PersonaManager with personas
      await this.personaManager.initialize(this.personas);
      
      const history = await loadHistory('ei');
      this.messages = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      // Initialize heartbeats for all personas
      this.messageProcessor.initializeHeartbeats(this.personas);
      
      this.focusManager.focusInput();
      this.render();
      this.autoScrollToBottom();
      
      // Debug: Check if screen is properly set up for input
      debugLog(`Screen setup - smartCSR: ${this.screen.options.smartCSR}, fullUnicode: ${this.screen.options.fullUnicode}`);
      debugLog(`Screen focused element: ${this.screen.focused ? this.screen.focused.type : 'none'}`);
      debugLog(`Input box element type: ${this.layoutManager.getInputBox().type}`);
      
      debugLog(`init() completed - Instance #${this.instanceId}`);
    } catch (err) {
      this.setStatus(`Initialization error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }



  /**
   * Public method for tests to inject input directly
   * This can be called by test frameworks that have access to the app instance
   */
  public injectTestInput(input: string): void {
    this.testSupport.injectTestInput(input);
  }
}