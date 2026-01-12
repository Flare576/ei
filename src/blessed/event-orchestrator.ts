import { IEventOrchestrator, EventOrchestrationDependencies } from './interfaces.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

// Ctrl+C confirmation window - user has this long to press Ctrl+C again to exit
const CTRL_C_CONFIRMATION_WINDOW_MS = 3000; // 3 seconds

/**
 * EventOrchestrator - Handles event setup and coordination
 * 
 * Extracted from app.ts to centralize all event handling logic.
 * Manages screen events, key bindings, resize handling, signal handlers,
 * and Ctrl+C confirmation logic.
 */
export class EventOrchestrator implements IEventOrchestrator {
  private screen: EventOrchestrationDependencies['screen'];
  private layoutManager: EventOrchestrationDependencies['layoutManager'];
  private focusManager: EventOrchestrationDependencies['focusManager'];
  private uiOrchestrator: EventOrchestrationDependencies['uiOrchestrator'];
  private personaManager: EventOrchestrationDependencies['personaManager'];
  private messageProcessor: EventOrchestrationDependencies['messageProcessor'];
  private commandHandler: EventOrchestrationDependencies['commandHandler'];
  
  // Ctrl+C state tracking
  private ctrlCWarningTimestamp: number | null = null;
  private inputHasText = false;
  
  // Prevent duplicate submissions
  private lastSubmissionTime = 0;
  private lastSubmissionText = '';

  constructor(dependencies: EventOrchestrationDependencies) {
    this.screen = dependencies.screen;
    this.layoutManager = dependencies.layoutManager;
    this.focusManager = dependencies.focusManager;
    this.uiOrchestrator = dependencies.uiOrchestrator;
    this.personaManager = dependencies.personaManager;
    this.messageProcessor = dependencies.messageProcessor;
    this.commandHandler = dependencies.commandHandler;
    
    debugLog('EventOrchestrator initialized');
  }

  /**
   * Set up all event handlers
   */
  setupEventHandlers(): void {
    debugLog('EventOrchestrator: setupEventHandlers called');
    
    // Set up layout manager handlers
    this.layoutManager.setSubmitHandler((text: string) => this.handleSubmit(text));
    this.layoutManager.setCtrlCHandler(() => this.handleCtrlC());
    
    // Input handling is managed by LayoutManager
    this.layoutManager.setupEventHandlers();

    // Key bindings on screen level (only for non-input keys)
    this.screen.key(['escape', 'q'], () => {
      debugLog('Screen key handler: cleaning up and exiting...');
      this.executeGracefulExit();
    });

    // Focus management keys
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
    this.layoutManager.getInputBox().on('keypress', (ch: any, key: any) => {
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
  }

  /**
   * Set up signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    // Handle termination signals gracefully, but let blessed handle Ctrl+C
    const gracefulExit = () => {
      debugLog('Graceful exit called');
      this.executeGracefulExit();
    };
    
    // Only handle non-interactive signals
    process.on('SIGTERM', gracefulExit);
    process.on('SIGHUP', gracefulExit);
    
    // Don't override SIGINT - let blessed handle Ctrl+C through key bindings
  }

  /**
   * Handle resize events
   */
  private handleResize(): void {
    debugLog(`handleResize called - screen size: ${this.screen.width}x${this.screen.height}`);
    this.focusManager.handleResize();
    
    // Re-establish scrolling key bindings on the new input box after resize
    this.setupScrollingKeyBindings();
    
    this.uiOrchestrator.render();
  }

  /**
   * Set up scrolling key bindings
   */
  private setupScrollingKeyBindings(): void {
    // Scrolling key bindings on screen level (for when no element has focus)
    this.screen.key(['pageup'], () => {
      this.uiOrchestrator.scrollChatHistory(-5);
    });

    this.screen.key(['pagedown'], () => {
      this.uiOrchestrator.scrollChatHistory(5);
    });

    // Also add scrolling to input box for when it has focus
    this.layoutManager.getInputBox().key(['pageup'], () => {
      this.uiOrchestrator.scrollChatHistory(-5);
    });

    this.layoutManager.getInputBox().key(['pagedown'], () => {
      this.uiOrchestrator.scrollChatHistory(5);
    });
  }

  /**
   * Handle form submission
   * @param text - Submitted text
   */
  private async handleSubmit(text: string): Promise<void> {
    if (!text.trim()) return;

    debugLog(`handleSubmit called: "${text}"`);

    // Prevent duplicate submissions within 2 seconds
    const now = Date.now();
    const timeSinceLastSubmit = now - this.lastSubmissionTime;
    
    if (timeSinceLastSubmit < 2000 && text === this.lastSubmissionText) {
      debugLog('Duplicate submission prevented');
      return;
    }
    
    this.lastSubmissionTime = now;
    this.lastSubmissionText = text;

    this.uiOrchestrator.setStatus(null);
    
    // Reset Ctrl+C warning timestamp and input state
    this.ctrlCWarningTimestamp = null;
    this.inputHasText = false;

    // Handle commands
    if (text.startsWith('/')) {
      const parsedCommand = this.commandHandler.parseCommand(text);
      if (parsedCommand) {
        await this.commandHandler.executeCommand(parsedCommand);
      } else {
        this.uiOrchestrator.setStatus(`Unknown command: ${text}`);
      }
      this.layoutManager.getInputBox().clearValue();
      this.focusManager.maintainFocus();
      return;
    }

    // Add user message and queue for processing
    await this.messageProcessor.processMessage(this.personaManager.getCurrentPersona(), text);
    this.layoutManager.getInputBox().clearValue();
    
    this.focusManager.maintainFocus();
    this.uiOrchestrator.render();
  }

  /**
   * Handle Ctrl+C with confirmation logic
   */
  private handleCtrlC(): void {
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
      const activePs = this.personaManager.getPersonaState(this.personaManager.getCurrentPersona());
      
      // If active persona isn't processing but others are, check confirmation window
      if (!activePs.isProcessing) {
        const backgroundProcessing = this.personaManager.getBackgroundProcessingPersonas();
        const now = Date.now();
        const timeSinceWarning = this.ctrlCWarningTimestamp ? now - this.ctrlCWarningTimestamp : Infinity;
        
        if (backgroundProcessing.length > 0 && 
            this.ctrlCWarningTimestamp && 
            timeSinceWarning <= CTRL_C_CONFIRMATION_WINDOW_MS) {
          debugLog('BRANCH: User confirmed exit within confirmation window - forcing exit');
          this.executeGracefulExit();
          return;
        }
      }
    }
    
    // Delegate to shared exit logic
    this.executeExitLogic();
    debugLog('=== CTRL+C HANDLER END ===');
  }

  /**
   * Execute exit logic with priority handling
   */
  private executeExitLogic(): void {
    debugLog('=== EXIT LOGIC START ===');
    debugLog('Exit logic called - starting proper handling chain');
    
    const activePs = this.personaManager.getPersonaState(this.personaManager.getCurrentPersona());
    debugLog(`Active persona: ${this.personaManager.getCurrentPersona()}`);
    debugLog(`Active persona state: isProcessing=${activePs.isProcessing}, messageQueue=${activePs.messageQueue.length}`);
    
    // Priority 1: Abort active persona processing
    if (activePs.isProcessing) {
      debugLog('BRANCH: Aborting active persona operation');
      this.messageProcessor.abortProcessing(this.personaManager.getCurrentPersona());
      this.uiOrchestrator.setStatus('Aborted current operation');
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
      this.uiOrchestrator.setStatus('Input cleared');
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
      this.uiOrchestrator.setStatus(`Processing in progress for: ${names}. Press Ctrl+C again or use /quit --force to exit immediately.`);
      debugLog('=== EXIT LOGIC END (warning shown) ===');
      return;
    }

    // Priority 4: Exit application with graceful degradation
    debugLog('BRANCH: Exiting application - no blocking conditions');
    this.executeGracefulExit();
  }

  /**
   * Execute graceful exit with cleanup
   */
  private executeGracefulExit(): void {
    try {
      // Clean up persona manager
      this.personaManager.cleanup();
      
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

  /**
   * Handle refresh command
   */
  private handleRefreshCommand(): void {
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
    
    this.uiOrchestrator.setStatus(`UI refreshed - Terminal size: ${screenWidth}x${screenHeight}`);
  }
}