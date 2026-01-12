import { IUIOrchestrator, UIOrchestrationDependencies } from './interfaces.js';
import type { Message, MessageState } from '../types.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

/**
 * UIOrchestrator - Handles UI rendering, scrolling, and coordination
 * 
 * Extracted from app.ts to centralize all UI orchestration logic.
 * Manages rendering coordination between modules, scrolling behavior,
 * status display, and UI state management.
 */
export class UIOrchestrator implements IUIOrchestrator {
  private layoutManager: UIOrchestrationDependencies['layoutManager'];
  private personaRenderer: UIOrchestrationDependencies['personaRenderer'];
  private chatRenderer: UIOrchestrationDependencies['chatRenderer'];
  private personaManager: UIOrchestrationDependencies['personaManager'];
  private messageProcessor: UIOrchestrationDependencies['messageProcessor'];
  private screen: UIOrchestrationDependencies['screen'];
  
  private messages: Message[] = [];
  private statusMessage: string | null = null;

  constructor(dependencies: UIOrchestrationDependencies) {
    this.layoutManager = dependencies.layoutManager;
    this.personaRenderer = dependencies.personaRenderer;
    this.chatRenderer = dependencies.chatRenderer;
    this.personaManager = dependencies.personaManager;
    this.messageProcessor = dependencies.messageProcessor;
    this.screen = dependencies.screen;
    
    debugLog('UIOrchestrator initialized');
  }

  /**
   * Add a message to the current chat
   * @param role - Message role (human or system)
   * @param content - Message content
   * @param state - Optional message state
   */
  addMessage(role: 'human' | 'system', content: string, state?: MessageState): void {
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

  /**
   * Update the state of the last human message
   * @param newState - New message state
   */
  updateLastHumanMessageState(newState: MessageState | undefined): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'human' && this.messages[i].state !== 'sent') {
        this.messages[i] = { ...this.messages[i], state: newState };
        break;
      }
    }
  }

  /**
   * Set status message
   * @param message - Status message or null to clear
   */
  setStatus(message: string | null): void {
    this.statusMessage = message;
    this.render();
  }

  /**
   * Render the complete UI
   */
  render(): void {
    this.personaRenderer.render(
      this.layoutManager.getPersonaList(),
      this.personaManager.getPersonas(),
      this.personaManager.getCurrentPersona(),
      this.personaManager.getUnreadCounts(),
      this.personaManager.getAllPersonaStates(),
      this.screen.width as number
    );
    
    this.chatRenderer.render(
      this.layoutManager.getChatHistory(),
      this.messages,
      this.personaManager.getCurrentPersona()
    );
    
    this.renderStatus();
    this.screen.render();
  }

  /**
   * Scroll chat history by specified number of lines
   * @param lines - Number of lines to scroll (positive = down, negative = up)
   */
  scrollChatHistory(lines: number): void {
    debugLog(`SCROLL: attempting to scroll ${lines} lines`);
    
    const beforeScroll = this.layoutManager.getChatHistory().getScroll();
    this.layoutManager.getChatHistory().scroll(lines);
    const afterScroll = this.layoutManager.getChatHistory().getScroll();
    
    debugLog(`SCROLL: moved from ${beforeScroll} to ${afterScroll}`);
    this.screen.render();
  }

  /**
   * Auto-scroll chat to bottom
   */
  autoScrollToBottom(): void {
    debugLog(`DEBUG autoScroll: letting blessed handle scroll to bottom`);
    this.layoutManager.getChatHistory().scrollTo(this.layoutManager.getChatHistory().getScrollHeight());
    const actualScroll = this.layoutManager.getChatHistory().getScroll();
    debugLog(`DEBUG autoScroll: ended at position ${actualScroll}`);
  }

  /**
   * Get current messages for active persona
   * @returns Array of messages
   */
  getMessages(): Message[] {
    return this.messages;
  }

  /**
   * Set messages for current persona (used during persona switching)
   * @param messages - Array of messages to set
   */
  setMessages(messages: Message[]): void {
    this.messages = messages;
    debugLog(`UIOrchestrator: set ${messages.length} messages`);
  }

  /**
   * Render status bar with processing indicator and status message
   */
  private renderStatus(): void {
    let status = '';
    if (this.messageProcessor.isProcessing(this.personaManager.getCurrentPersona())) {
      status += '{cyan-fg}thinking...{/cyan-fg} ';
    }
    if (this.statusMessage) {
      status += this.statusMessage;
    }
    this.layoutManager.getStatusBar().setContent(status);
  }
}