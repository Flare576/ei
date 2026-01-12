import blessed from 'blessed';
import { appendDebugLog } from '../storage.js';

// Layout breakpoints
const LAYOUT_FULL_MIN_COLS = 100;
const LAYOUT_MEDIUM_MIN_COLS = 60;

export class LayoutManager {
  private screen: blessed.Widgets.Screen;
  private personaList!: blessed.Widgets.BoxElement;
  private chatHistory!: blessed.Widgets.BoxElement;
  private inputBox!: blessed.Widgets.TextboxElement;
  private statusBar!: blessed.Widgets.BoxElement;
  private submitHandler: ((text: string) => void) | null = null;
  private ctrlCHandler: (() => void) | null = null;

  constructor(screen: blessed.Widgets.Screen) {
    appendDebugLog('LayoutManager constructor called');
    this.screen = screen;
  }

  setSubmitHandler(handler: (text: string) => void) {
    // Wrap handler to prevent rapid duplicate calls
    let lastCallTime = 0;
    let lastCallText = '';
    
    this.submitHandler = (text: string) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;
      
      // Prevent duplicate calls within 100ms with same text
      if (timeSinceLastCall < 100 && text === lastCallText) {
        appendDebugLog('DEBUG: Prevented duplicate submit handler call');
        return;
      }
      
      lastCallTime = now;
      lastCallText = text;
      
      handler(text);
    };
  }

  setCtrlCHandler(handler: () => void) {
    this.ctrlCHandler = handler;
  }

  createLayout() {
    const width = Number(this.screen.width);
    const layoutType = width >= LAYOUT_FULL_MIN_COLS ? 'full' 
      : width >= LAYOUT_MEDIUM_MIN_COLS ? 'medium' 
      : 'compact';

    if (layoutType === 'full') {
      this.createFullLayout();
    } else if (layoutType === 'medium') {
      this.createMediumLayout();
    } else {
      this.createCompactLayout();
    }

    this.screen.append(this.personaList);
    this.screen.append(this.chatHistory);
    this.screen.append(this.inputBox);
    this.screen.append(this.statusBar);
  }

  private createFullLayout() {
    this.personaList = blessed.box({
      label: 'Personas',
      top: 0,
      left: 0,
      width: '20%',
      height: '100%-4',
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      keys: true,
      vi: true
    });

    this.chatHistory = blessed.box({
      label: 'Chat: ei',
      top: 0,
      left: '20%',
      width: '80%',
      height: '100%-4',
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      keys: true,
      vi: true
    });

    this.inputBox = blessed.textbox({
      label: 'Input',
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      keys: true,
      secret: false,
      censor: false,
      submit: true
    });

    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true
    });
  }

  private createMediumLayout() {
    this.personaList = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      tags: true
    });

    this.chatHistory = blessed.box({
      label: 'Chat: ei',
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-7',
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      keys: true,
      vi: true
    });

    this.inputBox = blessed.textbox({
      label: 'Input',
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      keys: true,
      secret: false,
      censor: false,
      submit: true
    });

    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true
    });
  }

  private createCompactLayout() {
    this.personaList = blessed.box({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      hidden: true
    });

    this.chatHistory = blessed.box({
      label: 'EI | ei',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-4',
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      keys: true,
      vi: true
    });

    this.inputBox = blessed.textbox({
      label: 'Input',
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      keys: true,
      secret: false,
      censor: false,
      submit: true
    });

    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true
    });
  }

  recreateLayout() {
    // Remove event handlers before removing elements
    this.removeEventHandlers();
    
    // Remove existing elements to prevent duplication
    this.screen.remove(this.personaList);
    this.screen.remove(this.chatHistory);
    this.screen.remove(this.inputBox);
    this.screen.remove(this.statusBar);
    
    // Clear screen to prevent corruption
    this.screen.clearRegion(0, Number(this.screen.width), 0, Number(this.screen.height));
    
    // Recreate layout for new terminal size
    this.createLayout();
    
    // Re-attach event handlers
    this.setupEventHandlers();
    
    // Force full screen refresh
    this.screen.realloc();
  }

  setupEventHandlers() {
    if (this.submitHandler && this.inputBox) {
      appendDebugLog('DEBUG: Setting up submit handler on inputBox');
      this.inputBox.on('submit', this.submitHandler);
      
      // Handle Ctrl+C at the input level (blessed way) since focused elements consume keypresses
      if (this.ctrlCHandler) {
        appendDebugLog('DEBUG: Setting up Ctrl+C handler on inputBox');
        this.inputBox.key(['C-c'], () => {
          appendDebugLog('=== INPUT BOX CTRL+C TRIGGERED ===');
          this.ctrlCHandler!();
        });
      }
    }
  }

  removeEventHandlers() {
    if (this.inputBox) {
      appendDebugLog('DEBUG: Removing submit handlers from inputBox');
      this.inputBox.removeAllListeners('submit');
    }
  }

  getPersonaList(): blessed.Widgets.BoxElement {
    return this.personaList;
  }

  getChatHistory(): blessed.Widgets.BoxElement {
    return this.chatHistory;
  }

  getInputBox(): blessed.Widgets.TextboxElement {
    return this.inputBox;
  }

  getStatusBar(): blessed.Widgets.BoxElement {
    return this.statusBar;
  }

  getLayoutType(): 'full' | 'medium' | 'compact' {
    const width = Number(this.screen.width);
    return width >= LAYOUT_FULL_MIN_COLS ? 'full' 
      : width >= LAYOUT_MEDIUM_MIN_COLS ? 'medium' 
      : 'compact';
  }

  isFullLayout(): boolean {
    return Number(this.screen.width) >= LAYOUT_FULL_MIN_COLS;
  }
}