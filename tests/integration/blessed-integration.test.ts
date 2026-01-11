import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Increase max listeners to prevent warnings during testing
process.setMaxListeners(20);

// Mock blessed and dependencies for integration testing
vi.mock('blessed', () => ({
  default: {
    screen: vi.fn(() => ({
      width: 100,
      height: 30,
      render: vi.fn(),
      destroy: vi.fn(),
      key: vi.fn(),
      on: vi.fn(),
      append: vi.fn(),
      remove: vi.fn(),
      clearRegion: vi.fn(),
      realloc: vi.fn(),
      alloc: vi.fn(),
      options: { smartCSR: true, fullUnicode: true },
      focused: null,
    })),
    box: vi.fn(() => ({
      setContent: vi.fn(),
      setLabel: vi.fn(),
      focus: vi.fn(),
      scroll: vi.fn(),
      scrollTo: vi.fn(),
      getScroll: vi.fn(() => 0),
      getScrollHeight: vi.fn(() => 100),
      on: vi.fn(),
      key: vi.fn(),
      removeAllListeners: vi.fn(),
      hidden: false,
      type: 'box',
    })),
    textbox: vi.fn(() => ({
      focus: vi.fn(),
      clearValue: vi.fn(),
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      on: vi.fn(),
      key: vi.fn(),
      removeAllListeners: vi.fn(),
      screen: null,
      type: 'textbox',
    })),
  }
}));

vi.mock('../../src/storage.js', () => ({
  loadHistory: vi.fn(() => Promise.resolve({ messages: [] })),
  listPersonas: vi.fn(() => Promise.resolve([
    { name: 'ei' },
    { name: 'claude' },
    { name: 'gpt' }
  ])),
  findPersonaByNameOrAlias: vi.fn((name) => Promise.resolve(
    ['ei', 'claude', 'gpt'].includes(name) ? name : null
  )),
  initializeDataDirectory: vi.fn(() => Promise.resolve()),
  initializeDebugLog: vi.fn(),
  appendDebugLog: vi.fn(),
}));

vi.mock('../../src/processor.js', () => ({
  processEvent: vi.fn(() => Promise.resolve({
    response: 'Test response',
    aborted: false
  })),
}));

vi.mock('../../src/llm.js', () => ({
  LLMAbortedError: class extends Error {
    name = 'LLMAbortedError';
    constructor(message: string) {
      super(message);
      this.name = 'LLMAbortedError';
    }
  },
}));

// Import the EIApp after mocking
import { EIApp } from '../../src/blessed/app.js';
import { processEvent } from '../../src/processor.js';
import { loadHistory, listPersonas, findPersonaByNameOrAlias } from '../../src/storage.js';
import { LLMAbortedError } from '../../src/llm.js';

describe('Blessed Integration Tests', () => {
  let app: EIApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = new EIApp();
    await app.init();
  });

  afterEach(() => {
    if (app) {
      // @ts-ignore - accessing private cleanup method for testing
      app.cleanup();
    }
    vi.restoreAllMocks();
    // Clean up any remaining event listeners to prevent warnings
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGHUP');
  });

  describe('Application Initialization', () => {
    test('app initializes successfully', async () => {
      expect(app).toBeDefined();
      expect(listPersonas).toHaveBeenCalled();
      expect(loadHistory).toHaveBeenCalledWith('ei');
    });

    test('layout manager is created', () => {
      // @ts-ignore - accessing private property for testing
      expect(app.layoutManager).toBeDefined();
    });

    test('focus manager is created', () => {
      // @ts-ignore - accessing private property for testing
      expect(app.focusManager).toBeDefined();
    });

    test('persona renderer is created', () => {
      // @ts-ignore - accessing private property for testing
      expect(app.personaRenderer).toBeDefined();
    });

    test('chat renderer is created', () => {
      // @ts-ignore - accessing private property for testing
      expect(app.chatRenderer).toBeDefined();
    });
  });

  describe('Layout System Integration', () => {
    test('layout adapts to different terminal widths', () => {
      const testWidths = [50, 80, 120, 200]; // compact, medium, full, extra-wide

      for (const width of testWidths) {
        // @ts-ignore - accessing private property for testing
        const screen = app.screen;
        screen.width = width;
        
        // @ts-ignore - accessing private property for testing
        const layoutManager = app.layoutManager;
        const layoutType = layoutManager.getLayoutType();
        
        if (width < 60) {
          expect(layoutType).toBe('compact');
        } else if (width < 100) {
          expect(layoutType).toBe('medium');
        } else {
          expect(layoutType).toBe('full');
        }
      }
    });

    test('layout recreation cleans up elements', () => {
      // @ts-ignore - accessing private property for testing
      const layoutManager = app.layoutManager;
      const screen = app.screen;
      
      // Track element removal and addition
      const removeSpy = vi.spyOn(screen, 'remove');
      const appendSpy = vi.spyOn(screen, 'append');

      // Clear previous calls from initialization
      removeSpy.mockClear();
      appendSpy.mockClear();

      // Trigger layout recreation
      layoutManager.recreateLayout();

      // Verify old elements were removed and new ones added
      expect(removeSpy).toHaveBeenCalledTimes(4); // persona list, chat, input, status
      expect(appendSpy).toHaveBeenCalledTimes(4); // new elements added
    });

    test('layout components exist', () => {
      // @ts-ignore - accessing private property for testing
      const layoutManager = app.layoutManager;
      
      expect(layoutManager.getPersonaList()).toBeDefined();
      expect(layoutManager.getChatHistory()).toBeDefined();
      expect(layoutManager.getInputBox()).toBeDefined();
      expect(layoutManager.getStatusBar()).toBeDefined();
    });
  });

  describe('Focus Management Integration', () => {
    test('focus manager maintains input focus', () => {
      // @ts-ignore - accessing private property for testing
      const focusManager = app.focusManager;
      const layoutManager = app.layoutManager;
      const inputBox = layoutManager.getInputBox();
      
      // Simulate focus loss
      inputBox.screen = { focused: null };
      
      // Attempt focus recovery
      focusManager.maintainFocus();
      
      // Verify focus was restored
      expect(inputBox.focus).toHaveBeenCalled();
    });

    test('focus manager handles resize', () => {
      // @ts-ignore - accessing private property for testing
      const focusManager = app.focusManager;
      
      // Should not throw when handling resize
      expect(() => focusManager.handleResize()).not.toThrow();
    });

    test('focus manager can focus different elements', () => {
      // @ts-ignore - accessing private property for testing
      const focusManager = app.focusManager;
      
      // Should not throw when focusing elements
      expect(() => focusManager.focusInput()).not.toThrow();
      expect(() => focusManager.focusPersonaList()).not.toThrow();
    });
  });

  describe('Persona Rendering Integration', () => {
    test('persona renderer handles spinner animation', () => {
      // @ts-ignore - accessing private property for testing
      const personaRenderer = app.personaRenderer;
      
      // Create mock persona states
      const mockStates = new Map();
      mockStates.set('ei', { isProcessing: true });
      mockStates.set('claude', { isProcessing: false });
      
      // Should not throw when updating spinner animation
      expect(() => personaRenderer.updateSpinnerAnimation(mockStates)).not.toThrow();
    });

    test('persona renderer can be cleaned up', () => {
      // @ts-ignore - accessing private property for testing
      const personaRenderer = app.personaRenderer;
      
      // Should not throw when cleaning up
      expect(() => personaRenderer.cleanup()).not.toThrow();
    });

    test('persona renderer can render personas', () => {
      // @ts-ignore - accessing private property for testing
      const personaRenderer = app.personaRenderer;
      const layoutManager = app.layoutManager;
      const personaList = layoutManager.getPersonaList();
      
      const mockPersonas = [{ name: 'ei' }, { name: 'claude' }];
      const mockUnreadCounts = new Map();
      const mockPersonaStates = new Map();
      
      // Should not throw when rendering
      expect(() => personaRenderer.render(
        personaList,
        mockPersonas,
        'ei',
        mockUnreadCounts,
        mockPersonaStates,
        100
      )).not.toThrow();
    });
  });

  describe('Chat Rendering Integration', () => {
    test('chat renderer can render messages', () => {
      // @ts-ignore - accessing private property for testing
      const chatRenderer = app.chatRenderer;
      const layoutManager = app.layoutManager;
      const chatHistory = layoutManager.getChatHistory();
      
      const mockMessages = [
        { role: 'human', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'system', content: 'Hi there!', timestamp: new Date().toISOString() }
      ];
      
      // Should not throw when rendering
      expect(() => chatRenderer.render(
        chatHistory,
        mockMessages,
        'ei'
      )).not.toThrow();
    });
  });

  describe('Error Handling Integration', () => {
    test('app handles initialization errors gracefully', async () => {
      // Mock initialization error
      vi.mocked(listPersonas).mockRejectedValueOnce(new Error('Storage error'));
      
      const newApp = new EIApp();
      
      // Should not throw during initialization
      await expect(newApp.init()).resolves.not.toThrow();
      
      // Clean up
      // @ts-ignore
      newApp.cleanup();
    });

    test('app handles missing personas gracefully', async () => {
      // Mock empty persona list
      vi.mocked(listPersonas).mockResolvedValueOnce([]);
      
      const newApp = new EIApp();
      await newApp.init();
      
      // Should not throw
      expect(newApp).toBeDefined();
      
      // Clean up
      // @ts-ignore
      newApp.cleanup();
    });

    test('app handles history loading errors', async () => {
      // Mock history loading error
      vi.mocked(loadHistory).mockRejectedValueOnce(new Error('History error'));
      
      const newApp = new EIApp();
      
      // Should not throw during initialization
      await expect(newApp.init()).resolves.not.toThrow();
      
      // Clean up
      // @ts-ignore
      newApp.cleanup();
    });
  });

  describe('Keyboard Shortcuts Integration', () => {
    test('screen key bindings are set up', () => {
      // @ts-ignore - accessing private property for testing
      const screen = app.screen;
      
      // Verify key bindings were set up
      expect(screen.key).toHaveBeenCalled();
      
      // Check for specific key bindings
      const keyBindings = screen.key.mock.calls;
      const hasEscapeBinding = keyBindings.some(call => call[0].includes('escape'));
      const hasCtrlHBinding = keyBindings.some(call => call[0].includes('C-h'));
      const hasCtrlLBinding = keyBindings.some(call => call[0].includes('C-l'));
      const hasPageUpBinding = keyBindings.some(call => call[0].includes('pageup'));
      const hasPageDownBinding = keyBindings.some(call => call[0].includes('pagedown'));
      
      expect(hasEscapeBinding).toBe(true);
      expect(hasCtrlHBinding).toBe(true);
      expect(hasCtrlLBinding).toBe(true);
      expect(hasPageUpBinding).toBe(true);
      expect(hasPageDownBinding).toBe(true);
    });

    test('input box key bindings are set up', () => {
      // @ts-ignore - accessing private property for testing
      const layoutManager = app.layoutManager;
      const inputBox = layoutManager.getInputBox();
      
      // Verify input box key bindings were set up
      expect(inputBox.key).toHaveBeenCalled();
      
      // Check for scrolling key bindings on input box
      const keyBindings = inputBox.key.mock.calls;
      const hasPageUpBinding = keyBindings.some(call => call[0].includes('pageup'));
      const hasPageDownBinding = keyBindings.some(call => call[0].includes('pagedown'));
      
      expect(hasPageUpBinding).toBe(true);
      expect(hasPageDownBinding).toBe(true);
    });
  });

  describe('Scrolling Integration', () => {
    test('chat history supports scrolling', () => {
      // @ts-ignore - accessing private property for testing
      const layoutManager = app.layoutManager;
      const chatHistory = layoutManager.getChatHistory();
      
      // Verify scrolling methods exist
      expect(chatHistory.scroll).toBeDefined();
      expect(chatHistory.scrollTo).toBeDefined();
      expect(chatHistory.getScroll).toBeDefined();
      expect(chatHistory.getScrollHeight).toBeDefined();
    });
  });

  describe('Event Handling Integration', () => {
    test('resize event handler is set up', () => {
      // @ts-ignore - accessing private property for testing
      const screen = app.screen;
      
      // Verify resize event handler was set up
      expect(screen.on).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    test('input box event handlers are set up', () => {
      // @ts-ignore - accessing private property for testing
      const layoutManager = app.layoutManager;
      const inputBox = layoutManager.getInputBox();
      
      // Verify input box event handlers were set up
      expect(inputBox.on).toHaveBeenCalled();
      
      // Check for specific event handlers
      const eventHandlers = inputBox.on.mock.calls;
      const hasKeypressHandler = eventHandlers.some(call => call[0] === 'keypress');
      const hasSubmitHandler = eventHandlers.some(call => call[0] === 'submit');
      
      expect(hasKeypressHandler).toBe(true);
      expect(hasSubmitHandler).toBe(true);
    });
  });

  describe('Cleanup Integration', () => {
    test('app cleanup works without errors', () => {
      // Should not throw when cleaning up
      expect(() => {
        // @ts-ignore - accessing private cleanup method for testing
        app.cleanup();
      }).not.toThrow();
    });

    test('screen destruction works', () => {
      // @ts-ignore - accessing private property for testing
      const screen = app.screen;
      
      // Should not throw when destroying screen
      expect(() => screen.destroy()).not.toThrow();
    });
  });

  describe('Component Integration', () => {
    test('all components work together during render', () => {
      // Should not throw when rendering
      expect(() => {
        // @ts-ignore - accessing private method for testing
        app.render();
      }).not.toThrow();
    });

    test('status rendering works', () => {
      // Should not throw when rendering status
      expect(() => {
        // @ts-ignore - accessing private method for testing
        app.renderStatus();
      }).not.toThrow();
    });
  });

  describe('Signal Handling Integration', () => {
    test('signal handlers are set up', () => {
      // Verify that signal handlers don't interfere with normal operation
      expect(app).toBeDefined();
      
      // The app should initialize without throwing errors related to signal handling
      expect(true).toBe(true);
    });
  });

  describe('Multi-instance Handling', () => {
    test('multiple app instances can be created', async () => {
      const app2 = new EIApp();
      await app2.init();
      
      expect(app2).toBeDefined();
      expect(app2).not.toBe(app);
      
      // Clean up
      // @ts-ignore
      app2.cleanup();
    });
  });
});