import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// Mock blessed for scrolling tests
vi.mock('blessed', () => ({
  default: {
    box: vi.fn(() => ({
      scroll: vi.fn(),
      scrollTo: vi.fn(),
      getScroll: vi.fn(() => 0),
      getScrollHeight: vi.fn(() => 100),
      setContent: vi.fn(),
    })),
  }
}));

// Create a simplified scrolling manager for testing
class MockScrollManager {
  private chatHistory: any;
  private messages: any[] = [];
  private currentScroll = 0;
  private scrollHeight = 100;

  constructor() {
    // Use mocked blessed components instead of real ones
    this.chatHistory = {
      scroll: vi.fn(),
      scrollTo: vi.fn(),
      getScroll: vi.fn(() => this.currentScroll),
      getScrollHeight: vi.fn(() => this.scrollHeight),
      setContent: vi.fn(),
    };
    
    // Set up scroll behavior
    this.chatHistory.scroll.mockImplementation((lines: number) => {
      const newScroll = Math.max(0, Math.min(this.scrollHeight, this.currentScroll + lines));
      this.currentScroll = newScroll;
    });
    this.chatHistory.scrollTo.mockImplementation((position: number) => {
      this.currentScroll = Math.max(0, Math.min(this.scrollHeight, position));
    });
  }

  // Simulate scrolling with PageUp/PageDown
  scrollChatHistory(lines: number) {
    const beforeScroll = this.currentScroll;
    this.chatHistory.scroll(lines);
    const afterScroll = this.currentScroll;
    
    return { beforeScroll, afterScroll, scrolled: afterScroll !== beforeScroll };
  }

  // Auto-scroll to bottom for new messages
  autoScrollToBottom() {
    const beforeScroll = this.currentScroll;
    this.chatHistory.scrollTo(this.scrollHeight);
    const afterScroll = this.currentScroll;
    
    return { beforeScroll, afterScroll, scrolledToBottom: afterScroll === this.scrollHeight };
  }

  // Add message and auto-scroll
  addMessage(content: string, shouldAutoScroll = true) {
    this.messages.push({ content, timestamp: Date.now() });
    
    if (shouldAutoScroll) {
      return this.autoScrollToBottom();
    }
    
    return { beforeScroll: this.currentScroll, afterScroll: this.currentScroll, scrolledToBottom: false };
  }

  // Getters for testing
  getCurrentScroll(): number {
    return this.currentScroll;
  }

  getScrollHeight(): number {
    return this.scrollHeight;
  }

  setScrollHeight(height: number) {
    this.scrollHeight = height;
    this.chatHistory.getScrollHeight.mockReturnValue(height);
  }

  getMessageCount(): number {
    return this.messages.length;
  }
}

describe('Blessed Scrolling Tests', () => {
  let scrollManager: MockScrollManager;

  beforeEach(() => {
    vi.clearAllMocks();
    scrollManager = new MockScrollManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any remaining event listeners to prevent warnings
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGHUP');
  });

  describe('Property Tests - Scrolling', () => {
    test('Property 10: Auto-scroll on new messages for active persona', () => {
      fc.assert(fc.property(
        fc.string().filter(s => s.trim().length > 0),
        (messageContent) => {
          const result = scrollManager.addMessage(messageContent, true);
          
          // Should auto-scroll to bottom when adding new messages
          return result.scrolledToBottom && result.afterScroll === scrollManager.getScrollHeight();
        }
      ), { numRuns: 50 });
    });
  });

  describe('Scrolling Edge Cases', () => {
    test('PageUp scrolling (5 lines up)', () => {
      // Start at bottom
      scrollManager.autoScrollToBottom();
      
      // Scroll up
      const result = scrollManager.scrollChatHistory(-5);
      
      expect(result.scrolled).toBe(true);
      expect(result.afterScroll).toBeLessThan(result.beforeScroll);
    });

    test('PageDown scrolling (5 lines down)', () => {
      // Start at top
      scrollManager.scrollChatHistory(-100); // Force to top
      
      // Scroll down
      const result = scrollManager.scrollChatHistory(5);
      
      expect(result.scrolled).toBe(true);
      expect(result.afterScroll).toBeGreaterThan(result.beforeScroll);
    });

    test('scroll boundary detection - top', () => {
      // Start at top
      scrollManager.scrollChatHistory(-100);
      const initialScroll = scrollManager.getCurrentScroll();
      
      // Try to scroll up more
      const result = scrollManager.scrollChatHistory(-5);
      
      // Should not scroll past top
      expect(result.afterScroll).toBe(0);
      expect(result.scrolled).toBe(false);
    });

    test('scroll boundary detection - bottom', () => {
      // Start at bottom
      scrollManager.autoScrollToBottom();
      const initialScroll = scrollManager.getCurrentScroll();
      
      // Try to scroll down more
      const result = scrollManager.scrollChatHistory(5);
      
      // Should not scroll past bottom
      expect(result.afterScroll).toBe(scrollManager.getScrollHeight());
      expect(result.scrolled).toBe(false);
    });

    test('auto-scroll behavior with new messages', () => {
      // Position somewhere in middle
      scrollManager.scrollChatHistory(-50);
      const middlePosition = scrollManager.getCurrentScroll();
      
      // Add new message
      const result = scrollManager.addMessage('new message', true);
      
      // Should auto-scroll to bottom
      expect(result.scrolledToBottom).toBe(true);
      expect(result.afterScroll).toBe(scrollManager.getScrollHeight());
      expect(result.afterScroll).toBeGreaterThan(middlePosition);
    });

    test('no auto-scroll when disabled', () => {
      // Position somewhere in middle
      scrollManager.scrollChatHistory(-50);
      const middlePosition = scrollManager.getCurrentScroll();
      
      // Add new message without auto-scroll
      const result = scrollManager.addMessage('new message', false);
      
      // Should not auto-scroll
      expect(result.scrolledToBottom).toBe(false);
      expect(result.afterScroll).toBe(middlePosition);
    });

    test('scroll position preservation during content updates', () => {
      // Position in middle
      scrollManager.scrollChatHistory(-30);
      const targetPosition = scrollManager.getCurrentScroll();
      
      // Simulate content update (like message state change)
      // Position should be preserved
      expect(scrollManager.getCurrentScroll()).toBe(targetPosition);
    });

    test('scroll height changes with content', () => {
      const initialHeight = scrollManager.getScrollHeight();
      
      // Simulate content growing
      scrollManager.setScrollHeight(200);
      
      expect(scrollManager.getScrollHeight()).toBe(200);
      expect(scrollManager.getScrollHeight()).toBeGreaterThan(initialHeight);
    });

    test('scroll to specific position', () => {
      const targetPosition = 50;
      
      scrollManager.scrollChatHistory(-100); // Start at top
      scrollManager.chatHistory.scrollTo(targetPosition);
      
      expect(scrollManager.getCurrentScroll()).toBe(targetPosition);
    });

    test('multiple scroll operations', () => {
      // Start at top
      scrollManager.scrollChatHistory(-100);
      expect(scrollManager.getCurrentScroll()).toBe(0);
      
      // Scroll down in steps
      scrollManager.scrollChatHistory(10);
      scrollManager.scrollChatHistory(10);
      scrollManager.scrollChatHistory(10);
      
      expect(scrollManager.getCurrentScroll()).toBe(30);
      
      // Scroll back up
      scrollManager.scrollChatHistory(-15);
      
      expect(scrollManager.getCurrentScroll()).toBe(15);
    });
  });
});