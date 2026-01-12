#!/usr/bin/env node

/**
 * Test Output Capture System for Blessed Applications
 * 
 * This module provides a way to capture blessed UI content in test mode
 * without interfering with normal blessed terminal rendering.
 * 
 * Similar to how EI_TEST_INPUT=true enables input injection,
 * EI_TEST_OUTPUT=true enables output capture for E2E testing.
 */

import blessed from 'blessed';
import { appendDebugLog } from '../storage.js';

export interface CapturedContent {
  timestamp: number;
  component: string;
  content: string;
  label?: string;
}

export interface TestOutputState {
  enabled: boolean;
  capturedContent: CapturedContent[];
  lastUpdate: number;
}

class TestOutputCapture {
  private static instance: TestOutputCapture | null = null;
  private state: TestOutputState;
  private originalMethods: Map<string, Function> = new Map();

  private constructor() {
    this.state = {
      enabled: process.env.NODE_ENV === 'test' || process.env.EI_TEST_OUTPUT === 'true',
      capturedContent: [],
      lastUpdate: 0
    };

    // Debug environment variables
    appendDebugLog(`TestOutputCapture: NODE_ENV=${process.env.NODE_ENV}, EI_TEST_OUTPUT=${process.env.EI_TEST_OUTPUT}`);
    appendDebugLog(`TestOutputCapture: Enabled=${this.state.enabled}`);

    if (this.state.enabled) {
      appendDebugLog('TestOutputCapture: Enabled - intercepting blessed rendering methods');
      this.interceptBlessedMethods();
    } else {
      appendDebugLog('TestOutputCapture: Disabled - not in test mode');
    }
  }

  static getInstance(): TestOutputCapture {
    if (!TestOutputCapture.instance) {
      TestOutputCapture.instance = new TestOutputCapture();
    }
    return TestOutputCapture.instance;
  }

  /**
   * Intercepts blessed widget methods to capture content updates
   */
  private interceptBlessedMethods(): void {
    try {
      appendDebugLog('TestOutputCapture: Starting method interception...');
      
      // Intercept blessed.box setContent method
      const originalBoxSetContent = blessed.box.prototype.setContent;
      this.originalMethods.set('box.setContent', originalBoxSetContent);
      appendDebugLog('TestOutputCapture: Intercepting blessed.box.prototype.setContent');
      
      blessed.box.prototype.setContent = function(content: string) {
        appendDebugLog(`TestOutputCapture: box.setContent called with content length: ${content?.length || 0}`);
        
        // Call original method first to maintain normal functionality
        const result = originalBoxSetContent.call(this, content);
        
        // Capture content for testing
        TestOutputCapture.getInstance().captureContent(
          this.type || 'box',
          content,
          this.options?.label
        );
        
        return result;
      };

      // Intercept blessed.textbox setContent method
      const originalTextboxSetContent = blessed.textbox.prototype.setContent;
      this.originalMethods.set('textbox.setContent', originalTextboxSetContent);
      appendDebugLog('TestOutputCapture: Intercepting blessed.textbox.prototype.setContent');
      
      blessed.textbox.prototype.setContent = function(content: string) {
        appendDebugLog(`TestOutputCapture: textbox.setContent called with content length: ${content?.length || 0}`);
        
        const result = originalTextboxSetContent.call(this, content);
        
        TestOutputCapture.getInstance().captureContent(
          this.type || 'textbox',
          content,
          this.options?.label
        );
        
        return result;
      };

      // Intercept blessed.textbox setValue method (for input content)
      const originalTextboxSetValue = blessed.textbox.prototype.setValue;
      this.originalMethods.set('textbox.setValue', originalTextboxSetValue);
      appendDebugLog('TestOutputCapture: Intercepting blessed.textbox.prototype.setValue');
      
      blessed.textbox.prototype.setValue = function(value: string) {
        appendDebugLog(`TestOutputCapture: textbox.setValue called with value length: ${value?.length || 0}`);
        
        const result = originalTextboxSetValue.call(this, value);
        
        TestOutputCapture.getInstance().captureContent(
          `${this.type || 'textbox'}-value`,
          value,
          this.options?.label
        );
        
        return result;
      };

      // Intercept screen.render to capture render events
      const originalScreenRender = blessed.screen.prototype.render;
      this.originalMethods.set('screen.render', originalScreenRender);
      appendDebugLog('TestOutputCapture: Intercepting blessed.screen.prototype.render');
      
      blessed.screen.prototype.render = function() {
        appendDebugLog('TestOutputCapture: screen.render called');
        
        const result = originalScreenRender.call(this);
        
        TestOutputCapture.getInstance().captureRenderEvent();
        
        return result;
      };

      appendDebugLog('TestOutputCapture: Blessed method interception complete');
    } catch (error) {
      appendDebugLog(`TestOutputCapture: Error during method interception: ${error}`);
    }
  }

  /**
   * Captures content from blessed widgets
   */
  private captureContent(component: string, content: string, label?: string): void {
    appendDebugLog(`TestOutputCapture: captureContent called - enabled: ${this.state.enabled}, component: ${component}, content length: ${content?.length || 0}, label: ${label || 'none'}`);
    
    if (!this.state.enabled) return;

    // Skip null/undefined content
    if (content == null) {
      appendDebugLog('TestOutputCapture: Skipping null/undefined content');
      return;
    }

    // Skip empty content or pure whitespace
    if (content.trim().length === 0) {
      appendDebugLog('TestOutputCapture: Skipping empty/whitespace content');
      return;
    }

    // Skip content that's just blessed formatting tags
    const cleanContent = content.replace(/\{[^}]*\}/g, '').trim();
    if (cleanContent.length === 0) {
      appendDebugLog('TestOutputCapture: Skipping content with only formatting tags');
      return;
    }

    const captured: CapturedContent = {
      timestamp: Date.now(),
      component,
      content: cleanContent,
      label
    };

    this.state.capturedContent.push(captured);
    this.state.lastUpdate = Date.now();

    // Keep only recent content (last 100 entries) to prevent memory issues
    if (this.state.capturedContent.length > 100) {
      this.state.capturedContent = this.state.capturedContent.slice(-100);
    }

    appendDebugLog(`TestOutputCapture: Captured ${component} content: "${cleanContent.slice(0, 50)}${cleanContent.length > 50 ? '...' : ''}" (total captured: ${this.state.capturedContent.length})`);
    
    // Also output to console so it appears in E2E test raw output
    console.log(`[TestOutputCapture] Captured ${component} content: "${cleanContent.slice(0, 50)}${cleanContent.length > 50 ? '...' : ''}" (total captured: ${this.state.capturedContent.length})`);
  }

  /**
   * Captures screen render events
   */
  private captureRenderEvent(): void {
    if (!this.state.enabled) return;

    this.state.lastUpdate = Date.now();
    appendDebugLog('TestOutputCapture: Screen render event captured');
  }

  /**
   * Gets all captured content
   */
  getCapturedContent(): CapturedContent[] {
    return [...this.state.capturedContent];
  }

  /**
   * Gets captured content for a specific component
   */
  getContentForComponent(component: string): CapturedContent[] {
    return this.state.capturedContent.filter(c => c.component === component);
  }

  /**
   * Gets the most recent content for a component
   */
  getLatestContentForComponent(component: string): CapturedContent | null {
    const content = this.getContentForComponent(component);
    return content.length > 0 ? content[content.length - 1] : null;
  }

  /**
   * Gets all captured content as readable text
   */
  getAllContentAsText(): string {
    return this.state.capturedContent
      .map(c => `[${c.component}${c.label ? `:${c.label}` : ''}] ${c.content}`)
      .join('\n');
  }

  /**
   * Gets content for a specific label (like "Chat: ei" or "Personas")
   */
  getContentForLabel(label: string): CapturedContent[] {
    return this.state.capturedContent.filter(c => c.label === label);
  }

  /**
   * Gets the latest content for a specific label
   */
  getLatestContentForLabel(label: string): CapturedContent | null {
    const content = this.getContentForLabel(label);
    return content.length > 0 ? content[content.length - 1] : null;
  }

  /**
   * Searches captured content for specific text
   */
  findContentContaining(searchText: string): CapturedContent[] {
    return this.state.capturedContent.filter(c => 
      c.content.toLowerCase().includes(searchText.toLowerCase())
    );
  }

  /**
   * Waits for content containing specific text to appear
   */
  async waitForContentContaining(searchText: string, timeout: number = 5000): Promise<CapturedContent> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkForContent = () => {
        const found = this.findContentContaining(searchText);
        if (found.length > 0) {
          resolve(found[found.length - 1]); // Return most recent match
          return;
        }

        if (Date.now() - startTime >= timeout) {
          const recentContent = this.getAllContentAsText().slice(-500);
          reject(new Error(`Content timeout after ${timeout}ms. Expected: "${searchText}". Recent content: "${recentContent}"`));
          return;
        }

        setTimeout(checkForContent, 100);
      };

      checkForContent();
    });
  }

  /**
   * Waits for content in a specific component
   */
  async waitForComponentContent(component: string, timeout: number = 5000): Promise<CapturedContent> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkForContent = () => {
        const content = this.getLatestContentForComponent(component);
        if (content && content.timestamp > startTime) {
          resolve(content);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error(`Component content timeout after ${timeout}ms for component: ${component}`));
          return;
        }

        setTimeout(checkForContent, 100);
      };

      checkForContent();
    });
  }

  /**
   * Clears captured content (useful for test setup)
   */
  clearCapturedContent(): void {
    this.state.capturedContent = [];
    this.state.lastUpdate = Date.now();
    appendDebugLog('TestOutputCapture: Cleared captured content');
  }

  /**
   * Gets the current state (for debugging)
   */
  getState(): TestOutputState {
    return { ...this.state };
  }

  /**
   * Checks if output capture is enabled
   */
  isEnabled(): boolean {
    return this.state.enabled;
  }

  /**
   * Restores original blessed methods (for cleanup)
   */
  restore(): void {
    if (!this.state.enabled) return;

    for (const [methodName, originalMethod] of this.originalMethods) {
      const [objectName, methodKey] = methodName.split('.');
      
      switch (objectName) {
        case 'box':
          (blessed.box.prototype as any)[methodKey] = originalMethod;
          break;
        case 'textbox':
          (blessed.textbox.prototype as any)[methodKey] = originalMethod;
          break;
        case 'screen':
          (blessed.screen.prototype as any)[methodKey] = originalMethod;
          break;
      }
    }

    this.originalMethods.clear();
    appendDebugLog('TestOutputCapture: Restored original blessed methods');
  }
}

// Export singleton instance and initialize immediately
export const testOutputCapture = TestOutputCapture.getInstance();

// Export convenience functions for E2E tests
export function getCapturedContent(): CapturedContent[] {
  return testOutputCapture.getCapturedContent();
}

export function getContentForComponent(component: string): CapturedContent[] {
  return testOutputCapture.getContentForComponent(component);
}

export function getLatestContentForComponent(component: string): CapturedContent | null {
  return testOutputCapture.getLatestContentForComponent(component);
}

export function getAllContentAsText(): string {
  return testOutputCapture.getAllContentAsText();
}

export function getContentForLabel(label: string): CapturedContent[] {
  return testOutputCapture.getContentForLabel(label);
}

export function getLatestContentForLabel(label: string): CapturedContent | null {
  return testOutputCapture.getLatestContentForLabel(label);
}

export function findContentContaining(searchText: string): CapturedContent[] {
  return testOutputCapture.findContentContaining(searchText);
}

export function waitForContentContaining(searchText: string, timeout?: number): Promise<CapturedContent> {
  return testOutputCapture.waitForContentContaining(searchText, timeout);
}

export function waitForComponentContent(component: string, timeout?: number): Promise<CapturedContent> {
  return testOutputCapture.waitForComponentContent(component, timeout);
}

export function clearCapturedContent(): void {
  testOutputCapture.clearCapturedContent();
}

export function isOutputCaptureEnabled(): boolean {
  return testOutputCapture.isEnabled();
}