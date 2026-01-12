import { IMessageProcessor, MessageProcessorDependencies } from './interfaces.js';
import type { PersonaState, Message, MessageState } from '../types.js';
import { processEvent } from '../processor.js';
import { LLMAbortedError } from '../llm.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

// Constants extracted from app.ts
const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = DEBUG ? 600 * 1000 : THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;

/**
 * MessageProcessor - Handles message queuing and LLM processing
 * 
 * Extracted from app.ts to centralize all message processing logic.
 * Manages message queuing, LLM interactions, heartbeat system, debouncing,
 * and AbortController management for cancellation.
 */
export class MessageProcessor implements IMessageProcessor {
  private chatRenderer: MessageProcessorDependencies['chatRenderer'];
  private personaManager: MessageProcessorDependencies['personaManager'];
  private app: MessageProcessorDependencies['app'];

  constructor(dependencies: MessageProcessorDependencies) {
    this.chatRenderer = dependencies.chatRenderer;
    this.personaManager = dependencies.personaManager;
    this.app = dependencies.app;
    
    debugLog('MessageProcessor initialized');
  }

  /**
   * Process a user message for a specific persona
   * @param persona - Persona name
   * @param message - User message content
   * @returns Promise that resolves when processing is complete
   */
  async processMessage(persona: string, message: string): Promise<void> {
    debugLog(`processMessage called for ${persona}: "${message}"`);
    
    // Add user message to chat
    this.app.addMessage('human', message, 'processing');
    
    // Queue the message for processing
    this.queueMessage(persona, message);
    
    // Trigger UI update
    this.app.render();
  }

  /**
   * Start heartbeat timer for a persona
   * @param persona - Persona name
   */
  startHeartbeat(persona: string): void {
    this.resetHeartbeat(persona);
  }

  /**
   * Stop heartbeat timer for a persona
   * @param persona - Persona name
   */
  stopHeartbeat(persona: string): void {
    const ps = this.personaManager.getPersonaState(persona);
    
    if (ps.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
      ps.heartbeatTimer = null;
      debugLog(`Stopped heartbeat for persona: ${persona}`);
    }
  }

  /**
   * Abort processing for a persona
   * @param persona - Persona name
   */
  abortProcessing(persona: string): void {
    const ps = this.personaManager.getPersonaState(persona);
    if (ps?.abortController) {
      ps.abortController.abort();
      ps.abortController = null;
      
      // Update message state if this is the active persona
      if (persona === this.personaManager.getCurrentPersona()) {
        this.app.updateLastHumanMessageState('failed');
      }
      
      ps.messageQueue = [];
      ps.isProcessing = false;
      this.personaManager.updateSpinnerAnimation();
      
      debugLog(`Aborted processing for persona: ${persona}`);
    }
  }

  /**
   * Check if a persona is currently processing
   * @param persona - Persona name
   * @returns True if processing, false otherwise
   */
  isProcessing(persona: string): boolean {
    const ps = this.personaManager.getPersonaState(persona);
    return ps.isProcessing;
  }

  /**
   * Queue a message for processing
   * @param persona - Persona name
   * @param message - Message to queue
   */
  queueMessage(persona: string, message: string): void {
    const ps = this.personaManager.getPersonaState(persona);
    ps.messageQueue.push(message.trim());
    this.resetHeartbeat(persona);

    if (ps.isProcessing) {
      this.abortProcessing(persona);
      return;
    }

    const totalLength = ps.messageQueue.join(' ').length;
    if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
      // Clear any pending debounce timer since we're processing immediately
      if (ps.debounceTimer) {
        clearTimeout(ps.debounceTimer);
        ps.debounceTimer = null;
      }
      debugLog(`queueMessage: immediate processing for ${persona} (length: ${totalLength})`);
      this.processPersonaQueue(persona);
    } else {
      debugLog(`queueMessage: scheduling debounce for ${persona} (length: ${totalLength})`);
      this.scheduleDebounce(persona);
    }
  }

  /**
   * Reset heartbeat timer for a persona
   * @param persona - Persona name
   */
  resetHeartbeat(persona: string): void {
    const ps = this.personaManager.getPersonaState(persona);
    
    if (ps.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
    }
    
    ps.lastActivity = Date.now();
    
    ps.heartbeatTimer = setTimeout(async () => {
      if (ps.messageQueue.length > 0 || ps.isProcessing) {
        this.resetHeartbeat(persona);
        return;
      }

      ps.abortController = new AbortController();
      ps.isProcessing = true;
      this.personaManager.updateSpinnerAnimation();
      
      const isActivePersona = persona === this.personaManager.getCurrentPersona();
      if (isActivePersona) {
        this.app.render();
      }

      try {
        const result = await processEvent(null, persona, DEBUG, ps.abortController.signal);
        if (!result.aborted && result.response) {
          if (isActivePersona) {
            this.app.addMessage('system', result.response);
          } else {
            this.personaManager.updateUnreadCount(persona, 1);
          }
        }
      } catch (err) {
        if (!(err instanceof LLMAbortedError)) {
          if (isActivePersona) {
            this.app.setStatus(`Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } finally {
        ps.isProcessing = false;
        ps.abortController = null;
        this.personaManager.updateSpinnerAnimation();
        if (isActivePersona) {
          this.app.render();
        }
        this.resetHeartbeat(persona);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Schedule debounced processing for a persona
   * @param persona - Persona name
   */
  scheduleDebounce(persona: string): void {
    const ps = this.personaManager.getPersonaState(persona);
    
    if (ps.debounceTimer) {
      clearTimeout(ps.debounceTimer);
    }
    debugLog(`scheduleDebounce: scheduling ${persona} in ${DEBOUNCE_MS}ms`);
    ps.debounceTimer = setTimeout(() => {
      debugLog(`scheduleDebounce: timer fired for ${persona}`);
      this.processPersonaQueue(persona);
    }, DEBOUNCE_MS);
  }

  /**
   * Initialize heartbeats for all personas
   * @param personas - Array of persona objects
   */
  initializeHeartbeats(personas: any[]): void {
    debugLog(`Initializing heartbeats for ${personas.length} personas`);
    for (const persona of personas) {
      this.resetHeartbeat(persona.name);
    }
  }

  /**
   * Process the message queue for a specific persona
   * @param personaName - Name of the persona to process
   */
  private async processPersonaQueue(personaName: string): Promise<void> {
    const ps = this.personaManager.getPersonaState(personaName);
    
    if (ps.messageQueue.length === 0 || ps.isProcessing) {
      debugLog(`processPersonaQueue: skipping ${personaName} - queue:${ps.messageQueue.length}, processing:${ps.isProcessing}`);
      return;
    }

    debugLog(`processPersonaQueue: starting ${personaName} with ${ps.messageQueue.length} messages`);
    
    const combinedMessage = ps.messageQueue.join('\n');
    ps.abortController = new AbortController();
    ps.isProcessing = true;
    this.personaManager.updateSpinnerAnimation();
    
    const isActivePersona = personaName === this.personaManager.getCurrentPersona();
    if (isActivePersona) {
      this.app.render();
    }

    try {
      const result = await processEvent(combinedMessage, personaName, DEBUG, ps.abortController.signal);
      
      if (!result.aborted) {
        ps.messageQueue = [];
        if (isActivePersona) {
          this.app.updateLastHumanMessageState('sent');
        }
        if (result.response) {
          if (isActivePersona) {
            this.app.addMessage('system', result.response);
          } else {
            this.personaManager.updateUnreadCount(personaName, 1);
          }
        }
      }
    } catch (err) {
      if (!(err instanceof LLMAbortedError)) {
        ps.messageQueue = [];
        if (isActivePersona) {
          this.app.updateLastHumanMessageState('failed');
          this.app.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      debugLog(`processPersonaQueue: finished ${personaName}`);
      ps.isProcessing = false;
      ps.abortController = null;
      this.personaManager.updateSpinnerAnimation();
      
      if (isActivePersona) {
        this.app.render();
      }

      if (ps.messageQueue.length > 0) {
        debugLog(`processPersonaQueue: retriggering ${personaName} - queue has ${ps.messageQueue.length} messages`);
        this.processPersonaQueue(personaName);
      }
    }
  }
}