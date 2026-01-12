import { IPersonaManager, PersonaManagerDependencies } from './interfaces.js';
import type { PersonaState, Message, MessageState } from '../types.js';
import { loadHistory, listPersonas } from '../storage.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

const STARTUP_HISTORY_COUNT = 20;

/**
 * PersonaManager - Manages persona state and switching
 * 
 * Extracted from app.ts to centralize all persona-related logic.
 * Handles persona switching, state management, unread counts, and UI coordination.
 */
export class PersonaManager implements IPersonaManager {
  private personaRenderer: PersonaManagerDependencies['personaRenderer'];
  private chatRenderer: PersonaManagerDependencies['chatRenderer'];
  private layoutManager: PersonaManagerDependencies['layoutManager'];
  
  private personas: any[] = [];
  private activePersona = 'ei';
  private personaStates = new Map<string, PersonaState>();
  private unreadCounts = new Map<string, number>();

  constructor(dependencies: PersonaManagerDependencies) {
    this.personaRenderer = dependencies.personaRenderer;
    this.chatRenderer = dependencies.chatRenderer;
    this.layoutManager = dependencies.layoutManager;
    
    debugLog('PersonaManager initialized');
  }

  /**
   * Initialize the persona manager with persona list
   * @param personas - Array of persona objects
   */
  async initialize(personas: any[]): Promise<void> {
    this.personas = personas;
    debugLog(`PersonaManager initialized with ${personas.length} personas`);
  }

  /**
   * Switch to a different persona
   * @param name - Name of the persona to switch to
   * @returns Promise that resolves with recent messages when switch is complete
   */
  async switchPersona(name: string): Promise<Message[]> {
    if (name === this.activePersona) {
      debugLog(`switchPersona: already on persona ${name}`);
      const history = await loadHistory(name);
      return history.messages.slice(-STARTUP_HISTORY_COUNT);
    }

    debugLog(`switchPersona: switching from ${this.activePersona} to ${name}`);

    try {
      const history = await loadHistory(name);
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      const ps = this.getOrCreatePersonaState(name);
      ps.unreadCount = 0;
      this.unreadCounts.delete(name);
      
      this.activePersona = name;
      
      this.layoutManager.getChatHistory().setLabel(`Chat: ${name}`);
      
      debugLog(`switchPersona: successfully switched to ${name}`);
      
      // Reset scroll position
      this.layoutManager.getChatHistory().scrollTo(0);
      
      return recent;
    } catch (err) {
      const errorMsg = `Error loading persona: ${err instanceof Error ? err.message : String(err)}`;
      debugLog(`switchPersona error: ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  /**
   * Get the currently active persona name
   * @returns Current persona name
   */
  getCurrentPersona(): string {
    return this.activePersona;
  }

  /**
   * Get persona state for a specific persona
   * @param name - Persona name
   * @returns PersonaState object
   */
  getPersonaState(name: string): PersonaState {
    return this.getOrCreatePersonaState(name);
  }

  /**
   * Update unread count for a persona
   * @param persona - Persona name
   * @param delta - Change in unread count (can be negative)
   */
  updateUnreadCount(persona: string, delta: number): void {
    const ps = this.getOrCreatePersonaState(persona);
    ps.unreadCount = Math.max(0, ps.unreadCount + delta);
    
    if (ps.unreadCount > 0) {
      this.unreadCounts.set(persona, ps.unreadCount);
    } else {
      this.unreadCounts.delete(persona);
    }
    
    debugLog(`updateUnreadCount: ${persona} now has ${ps.unreadCount} unread messages`);
  }

  /**
   * Get all persona states
   * @returns Map of persona names to PersonaState objects
   */
  getAllPersonaStates(): Map<string, PersonaState> {
    return this.personaStates;
  }

  /**
   * Get unread counts for all personas
   * @returns Map of persona names to unread counts
   */
  getUnreadCounts(): Map<string, number> {
    return this.unreadCounts;
  }

  /**
   * Get list of all available personas
   * @returns Array of persona objects
   */
  getPersonas(): any[] {
    return this.personas;
  }

  /**
   * Set the active persona (internal state only, no switching logic)
   * @param name - Persona name to set as active
   */
  setActivePersona(name: string): void {
    this.activePersona = name;
    debugLog(`setActivePersona: active persona set to ${name}`);
  }

  /**
   * Get or create persona state for a given persona
   * @param personaName - Name of the persona
   * @returns PersonaState object
   */
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
      debugLog(`getOrCreatePersonaState: created new state for ${personaName}`);
    }
    return ps;
  }

  /**
   * Update spinner animation based on persona processing states
   */
  updateSpinnerAnimation(): void {
    this.personaRenderer.updateSpinnerAnimation(this.personaStates);
  }

  /**
   * Get personas that are currently processing in the background
   * @returns Array of persona names that are processing
   */
  getBackgroundProcessingPersonas(): string[] {
    return Array.from(this.personaStates.entries())
      .filter(([name, ps]) => ps.isProcessing && name !== this.activePersona)
      .map(([name]) => name);
  }

  /**
   * Check if any persona is currently processing
   * @returns True if any persona is processing
   */
  isAnyPersonaProcessing(): boolean {
    return Array.from(this.personaStates.values()).some(ps => ps.isProcessing);
  }

  /**
   * Get personas that are currently processing (active or background)
   * @returns Array of persona names that are processing
   */
  getProcessingPersonas(): string[] {
    return Array.from(this.personaStates.entries())
      .filter(([name, ps]) => ps.isProcessing)
      .map(([name]) => name);
  }

  /**
   * Cleanup persona manager resources
   */
  cleanup(): void {
    debugLog('PersonaManager cleanup starting');
    
    // Clean up all persona states
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
        debugLog(`Error cleaning up persona ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    debugLog('PersonaManager cleanup completed');
  }
}