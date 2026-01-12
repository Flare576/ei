#!/usr/bin/env node

import blessed from 'blessed';
import { initializeDataDirectory, initializeDebugLog, appendDebugLog, listPersonas, loadHistory } from '../storage.js';
import type { Message, MessageState } from '../types.js';
import { LayoutManager } from './layout-manager.js';
import { FocusManager } from './focus-manager.js';
import { PersonaRenderer } from './persona-renderer.js';
import { ChatRenderer } from './chat-renderer.js';
import { CommandHandler } from './command-handler.js';
import { PersonaManager } from './persona-manager.js';
import { MessageProcessor } from './message-processor.js';
import { TestSupport } from './test-support.js';
import { UIOrchestrator } from './ui-orchestrator.js';
import { EventOrchestrator } from './event-orchestrator.js';
import type { ICommandHandler, IPersonaManager, IMessageProcessor, ITestSupport, IUIOrchestrator, IEventOrchestrator, IEIApp } from './interfaces.js';

// Initialize debug log file
initializeDebugLog();

function debugLog(message: string) {
  appendDebugLog(message);
}

// Constants
const STARTUP_HISTORY_COUNT = 20;

export class EIApp implements IEIApp {
  public screen: blessed.Widgets.Screen;
  public layoutManager: LayoutManager;
  public focusManager: FocusManager;
  public personaRenderer: PersonaRenderer;
  public chatRenderer: ChatRenderer;
  private commandHandler: ICommandHandler;
  private personaManager: IPersonaManager;
  private messageProcessor: IMessageProcessor;
  private testSupport: ITestSupport;
  private uiOrchestrator: IUIOrchestrator;
  private eventOrchestrator: IEventOrchestrator;
  
  private personas: any[] = [];
  
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

    // Initialize core UI managers
    this.layoutManager = new LayoutManager(this.screen);
    this.focusManager = new FocusManager(this.layoutManager);
    this.personaRenderer = new PersonaRenderer();
    this.chatRenderer = new ChatRenderer();

    // Initialize business logic modules with dependency injection
    this.personaManager = new PersonaManager({
      personaRenderer: this.personaRenderer,
      chatRenderer: this.chatRenderer,
      layoutManager: this.layoutManager
    });

    this.messageProcessor = new MessageProcessor({
      chatRenderer: this.chatRenderer,
      personaManager: this.personaManager,
      app: this
    });

    this.commandHandler = new CommandHandler({
      personaManager: this.personaManager,
      messageProcessor: this.messageProcessor,
      app: this
    });

    this.testSupport = new TestSupport({
      commandHandler: this.commandHandler,
      messageProcessor: this.messageProcessor,
      app: this
    }, this.instanceId);

    this.uiOrchestrator = new UIOrchestrator({
      layoutManager: this.layoutManager,
      personaRenderer: this.personaRenderer,
      chatRenderer: this.chatRenderer,
      personaManager: this.personaManager,
      messageProcessor: this.messageProcessor,
      screen: this.screen
    });

    this.eventOrchestrator = new EventOrchestrator({
      screen: this.screen,
      layoutManager: this.layoutManager,
      focusManager: this.focusManager,
      uiOrchestrator: this.uiOrchestrator,
      personaManager: this.personaManager,
      messageProcessor: this.messageProcessor,
      commandHandler: this.commandHandler
    });

    debugLog(`All modules initialized - Instance #${this.instanceId}`);

    // Configure module interactions and setup
    this.setupModuleInteractions();
    this.setupLayout();
    this.setupEventHandlers();
    this.setupSignalHandlers();
    
    debugLog(`EIApp constructor completed - Instance #${this.instanceId}`);
  }

  private setupModuleInteractions() {
    // Configure PersonaRenderer with screen and render callback
    this.personaRenderer.setScreen(this.screen);
    this.personaRenderer.setRenderCallback(() => this.uiOrchestrator.render());
    
    // Set up test input injection if enabled
    this.testSupport.setupTestInputInjection();
    
    debugLog(`Module interactions configured - Instance #${this.instanceId}`);
  }

  private setupLayout() {
    debugLog(`setupLayout called - Instance #${this.instanceId}`);
    this.layoutManager.createLayout();
  }

  private setupEventHandlers() {
    debugLog(`setupEventHandlers called - Instance #${this.instanceId}`);
    this.eventOrchestrator.setupEventHandlers();
  }

  private setupSignalHandlers() {
    this.eventOrchestrator.setupSignalHandlers();
  }

  async init() {
    debugLog(`init() called - Instance #${this.instanceId}`);
    try {
      await initializeDataDirectory();
      this.personas = await listPersonas();
      
      // Initialize PersonaManager with personas
      await this.personaManager.initialize(this.personas);
      
      const history = await loadHistory('ei');
      const messages = history.messages.slice(-STARTUP_HISTORY_COUNT);
      this.uiOrchestrator.setMessages(messages);
      
      // Initialize heartbeats for all personas
      this.messageProcessor.initializeHeartbeats(this.personas);
      
      this.focusManager.focusInput();
      this.uiOrchestrator.render();
      this.uiOrchestrator.autoScrollToBottom();
      
      // Debug: Check if screen is properly set up for input
      debugLog(`Screen setup - smartCSR: ${this.screen.options.smartCSR}, fullUnicode: ${this.screen.options.fullUnicode}`);
      debugLog(`Screen focused element: ${this.screen.focused ? this.screen.focused.type : 'none'}`);
      debugLog(`Input box element type: ${this.layoutManager.getInputBox().type}`);
      
      debugLog(`init() completed - Instance #${this.instanceId}`);
    } catch (err) {
      this.uiOrchestrator.setStatus(`Initialization error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Cleanup method for graceful shutdown
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

  // Public interface methods for module delegation
  public injectTestInput(input: string): void {
    this.testSupport.injectTestInput(input);
  }

  public addMessage(role: 'human' | 'system', content: string, state?: MessageState): void {
    this.uiOrchestrator.addMessage(role, content, state);
  }

  public setStatus(message: string | null): void {
    this.uiOrchestrator.setStatus(message);
  }

  public render(): void {
    this.uiOrchestrator.render();
  }

  public getMessages(): Message[] {
    return this.uiOrchestrator.getMessages();
  }

  public updateLastHumanMessageState(newState: MessageState | undefined): void {
    this.uiOrchestrator.updateLastHumanMessageState(newState);
  }

  public autoScrollToBottom(): void {
    this.uiOrchestrator.autoScrollToBottom();
  }

  public getCurrentPersona(): string {
    return this.personaManager.getCurrentPersona();
  }

  // Legacy methods for CommandHandler delegation (temporary - will be removed)
  public executeExitLogic?(): void {
    // Delegate to EventOrchestrator's exit logic
    this.eventOrchestrator.triggerExitLogic();
  }

  public handleRefreshCommand?(): void {
    // Delegate to EventOrchestrator's refresh logic
    this.eventOrchestrator.triggerRefreshCommand();
  }

  // ============================================================================
  // BACKWARD COMPATIBILITY METHODS FOR INTEGRATION TESTS
  // ============================================================================
  // These methods provide access to internal state for integration tests
  // They should be removed once tests are updated to use the new architecture
  
  // Note: These getters expose private properties for testing
  // The properties are already public via the private field declarations above

  public getOrCreatePersonaState(name: string) {
    return this.personaManager.getPersonaState(name);
  }

  public async handleCommand(input: string): Promise<void> {
    const command = this.commandHandler.parseCommand(input);
    if (command) {
      await this.commandHandler.executeCommand(command);
    }
  }

  public get statusMessage(): string | null {
    // Access status through UI orchestrator
    return (this.uiOrchestrator as any).statusMessage || null;
  }

  public set statusMessage(message: string | null) {
    this.uiOrchestrator.setStatus(message);
  }

  public get isProcessing(): boolean {
    return this.messageProcessor.isProcessing(this.personaManager.getCurrentPersona());
  }

  public set isProcessing(value: boolean) {
    // This is a read-only computed property in the new architecture
    debugLog(`Attempted to set isProcessing to ${value} - this is now computed from persona states`);
  }

  public get inputHasText(): boolean {
    const inputBox = this.layoutManager.getInputBox();
    return inputBox.getValue().trim().length > 0;
  }

  public set inputHasText(value: boolean) {
    // This is a computed property based on input box content
    debugLog(`Attempted to set inputHasText to ${value} - this is now computed from input box`);
  }

  public get ctrlCWarningTimestamp(): number | null {
    // Access through event orchestrator if needed
    return (this.eventOrchestrator as any).ctrlCWarningTimestamp || null;
  }

  public setupScrollingKeyBindings(): void {
    // This is now handled by EventOrchestrator during initialization
    debugLog('setupScrollingKeyBindings called - this is now handled by EventOrchestrator');
  }

  public renderStatus(): void {
    // Delegate to UI orchestrator
    (this.uiOrchestrator as any).renderStatus();
  }
}