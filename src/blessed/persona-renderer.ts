import blessed from 'blessed';
import type { PersonaState } from '../types.js';
import { appendDebugLog } from '../storage.js';

// Layout breakpoints
const LAYOUT_FULL_MIN_COLS = 100;
const LAYOUT_MEDIUM_MIN_COLS = 60;

// Spinner frames for thinking indicators
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class PersonaRenderer {
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private screen: blessed.Widgets.Screen | null = null;
  private renderCallback: (() => void) | null = null;

  setScreen(screen: blessed.Widgets.Screen) {
    this.screen = screen;
  }

  setRenderCallback(callback: () => void) {
    this.renderCallback = callback;
  }

  render(
    personaList: blessed.Widgets.BoxElement,
    personas: any[],
    activePersona: string,
    unreadCounts: Map<string, number>,
    personaStates: Map<string, PersonaState>,
    screenWidth: number
  ) {
    if (personaList.hidden) return;

    const layoutType = screenWidth >= LAYOUT_FULL_MIN_COLS ? 'full' 
      : screenWidth >= LAYOUT_MEDIUM_MIN_COLS ? 'medium' 
      : 'compact';

    if (layoutType === 'full') {
      this.renderFullLayout(personaList, personas, activePersona, unreadCounts, personaStates);
    } else if (layoutType === 'medium') {
      this.renderMediumLayout(personaList, personas, activePersona, unreadCounts, personaStates);
    }
  }

  private renderFullLayout(
    personaList: blessed.Widgets.BoxElement,
    personas: any[],
    activePersona: string,
    unreadCounts: Map<string, number>,
    personaStates: Map<string, PersonaState>
  ) {
    const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

    const personaText = personas.map(p => {
      const marker = p.name === activePersona ? '{green-fg}>{/green-fg} ' : '  ';
      const unread = unreadCounts.get(p.name) || 0;
      const unreadStr = unread ? ` {red-fg}(${unread}){/red-fg}` : '';
      const ps = personaStates.get(p.name);
      const heartbeatIn = ps ? Math.max(0, Math.floor((ps.lastActivity + HEARTBEAT_INTERVAL_MS - Date.now()) / 60000)) : 0;
      const timeStr = heartbeatIn > 0 ? ` ${heartbeatIn}m` : '';
      
      // Add thinking indicator using spinner frames
      const thinkingStr = ps?.isProcessing ? ` {cyan-fg}${SPINNER_FRAMES[this.spinnerFrame]}{/cyan-fg}` : '';
      
      return `${marker}{cyan-fg}${p.name}{/cyan-fg}${timeStr}${unreadStr}${thinkingStr}`;
    }).join('\n');
    
    personaList.setContent(personaText);
  }

  private renderMediumLayout(
    personaList: blessed.Widgets.BoxElement,
    personas: any[],
    activePersona: string,
    unreadCounts: Map<string, number>,
    personaStates: Map<string, PersonaState>
  ) {
    const personaText = personas.map(p => {
      const marker = p.name === activePersona ? `{green-fg}[${p.name}]{/green-fg}` : p.name;
      const unread = unreadCounts.get(p.name) || 0;
      const unreadStr = unread ? `{red-fg}(${unread}){/red-fg}` : '';
      const ps = personaStates.get(p.name);
      
      // Add thinking indicator for medium layout using spinner frames
      const thinkingStr = ps?.isProcessing ? ` {cyan-fg}${SPINNER_FRAMES[this.spinnerFrame]}{/cyan-fg}` : '';
      
      return `${marker}${unreadStr}${thinkingStr}`;
    }).join(' | ');
    
    personaList.setContent(personaText);
  }

  updateSpinnerAnimation(personaStates: Map<string, PersonaState>) {
    // Check if any persona is processing
    const hasProcessing = Array.from(personaStates.values()).some(ps => ps.isProcessing);
    
    if (hasProcessing) {
      this.startSpinnerAnimation();
    } else {
      this.stopSpinnerAnimation();
    }
  }

  private startSpinnerAnimation() {
    if (this.spinnerInterval) return; // Already running
    
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      // Trigger full re-render to update spinner frame
      if (this.renderCallback) {
        this.renderCallback();
      } else if (this.screen) {
        this.screen.render();
      } else {
        appendDebugLog('DEBUG: No screen reference for spinner animation');
      }
    }, 80);
  }

  private stopSpinnerAnimation() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  cleanup() {
    this.stopSpinnerAnimation();
  }
}