import type { LayoutManager } from './layout-manager.js';
import { appendDebugLog } from '../storage.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

export class FocusManager {
  private layoutManager: LayoutManager;

  constructor(layoutManager: LayoutManager) {
    this.layoutManager = layoutManager;
  }

  maintainFocus() {
    if (!this.isInputFocused()) {
      this.layoutManager.getInputBox().focus();
    }
  }

  focusInput() {
    this.layoutManager.getInputBox().focus();
  }

  focusPersonaList() {
    if (this.layoutManager.isFullLayout()) {
      this.layoutManager.getPersonaList().focus();
    }
  }

  handleResize() {
    debugLog(`FocusManager.handleResize called - preserving input state`);
    // Preserve input state across resize
    const currentValue = this.layoutManager.getInputBox().getValue();
    const wasFocused = this.isInputFocused();
    
    // recreateLayout() handles removing old handlers and setting up new ones internally
    this.layoutManager.recreateLayout();
    
    // Restore input state and focus
    this.layoutManager.getInputBox().setValue(currentValue);
    if (wasFocused) {
      this.layoutManager.getInputBox().focus();
    }
    
    // Scroll to bottom to show latest messages after resize (acceptable behavior)
    // This ensures user sees recent content rather than being stuck at the top
    setTimeout(() => {
      const chatHistory = this.layoutManager.getChatHistory();
      chatHistory.scrollTo(chatHistory.getScrollHeight());
      debugLog(`Post-resize: scrolled to bottom (${chatHistory.getScroll()})`);
    }, 0);
    
    debugLog(`FocusManager.handleResize completed`);
  }

  private isInputFocused(): boolean {
    // Check if input box has focus using blessed's focus tracking
    return this.layoutManager.getInputBox().screen?.focused === this.layoutManager.getInputBox();
  }
}