/**
 * Shared Blessed Mock Utilities
 * 
 * Provides consistent blessed mocks across integration tests.
 * Use these instead of copying the same mock code into every test file.
 * 
 * Usage:
 *   vi.mock('blessed', createBlessedMock);
 * 
 * With overrides:
 *   vi.mock('blessed', () => createBlessedMock({ 
 *     screen: { width: 200 } 
 *   }));
 */

import { vi } from 'vitest';

/**
 * Creates a mock screen object with all common properties
 */
export function createScreenMock(overrides: any = {}) {
  return {
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
    exec: vi.fn((cmd, args, opts, callback) => callback && callback(null, true)),
    focused: null,
    options: { smartCSR: true, fullUnicode: true },
    ...overrides,
  };
}

/**
 * Creates a mock box widget with all common properties
 */
export function createBoxMock(overrides: any = {}) {
  return {
    setContent: vi.fn(),
    setLabel: vi.fn(),
    focus: vi.fn(),
    scroll: vi.fn(),
    scrollTo: vi.fn(),
    getScroll: vi.fn(() => 0),
    getScrollHeight: vi.fn(() => 100),
    show: vi.fn(),
    hide: vi.fn(),
    on: vi.fn(),
    key: vi.fn(),
    removeAllListeners: vi.fn(),
    hidden: false,
    type: 'box',
    ...overrides,
  };
}

/**
 * Creates a mock textbox widget with all common properties
 */
export function createTextboxMock(overrides: any = {}) {
  return {
    focus: vi.fn(),
    clearValue: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
    cancel: vi.fn(),
    listeners: vi.fn(() => []),
    show: vi.fn(),
    hide: vi.fn(),
    on: vi.fn(),
    key: vi.fn(),
    unkey: vi.fn(),
    removeAllListeners: vi.fn(),
    screen: null,
    type: 'textbox',
    ...overrides,
  };
}

/**
 * Creates a mock message widget (modal popup) with display() method
 * 
 * The message widget is used for modal popups like help screens.
 * Key behaviors:
 * - display(content, duration, callback) shows the modal
 * - duration=-1 means wait for keypress
 * - callback is called when dismissed
 */
export function createMessageMock(overrides: any = {}) {
  return {
    display: vi.fn((content: string, duration: number, callback?: () => void) => {
      // Simulate immediate dismissal in tests
      if (callback) {
        callback();
      }
    }),
    hide: vi.fn(),
    show: vi.fn(),
    setContent: vi.fn(),
    on: vi.fn(),
    key: vi.fn(),
    removeAllListeners: vi.fn(),
    hidden: true,
    type: 'message',
    ...overrides,
  };
}

/**
 * Options for customizing the blessed mock
 */
export interface BlessedMockOptions {
  screen?: Partial<ReturnType<typeof createScreenMock>>;
  box?: Partial<ReturnType<typeof createBoxMock>>;
  textbox?: Partial<ReturnType<typeof createTextboxMock>>;
  message?: Partial<ReturnType<typeof createMessageMock>>;
}

/**
 * Creates a complete blessed mock for vi.mock('blessed')
 * 
 * This provides all the blessed widgets used by the EI application.
 * Each widget factory returns a fresh mock instance.
 * 
 * @param options - Optional overrides for specific widget properties
 * @returns Mock blessed module suitable for vi.mock()
 * 
 * @example
 * // Basic usage (most common)
 * vi.mock('blessed', createBlessedMock);
 * 
 * @example
 * // With custom screen width
 * vi.mock('blessed', () => createBlessedMock({ 
 *   screen: { width: 200 } 
 * }));
 * 
 * @example
 * // With custom box behavior
 * vi.mock('blessed', () => createBlessedMock({
 *   box: { 
 *     getScroll: vi.fn(() => 50),
 *     hidden: true
 *   }
 * }));
 */
export function createBlessedMock(options: BlessedMockOptions = {}) {
  return {
    default: {
      screen: vi.fn(() => createScreenMock(options.screen)),
      box: vi.fn(() => createBoxMock(options.box)),
      textbox: vi.fn(() => createTextboxMock(options.textbox)),
      message: vi.fn(() => createMessageMock(options.message)),
    }
  };
}
