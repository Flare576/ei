import { vi } from 'vitest';

/**
 * Creates mock LLM functions for integration tests.
 * Exports LLMAbortedError and a mocked sleep function.
 */
export function createLLMMocks() {
  return {
    LLMAbortedError: class extends Error {
      name = 'LLMAbortedError';
      constructor(message: string) {
        super(message);
        this.name = 'LLMAbortedError';
      }
    },
    sleep: vi.fn((ms: number) => Promise.resolve()),
  };
}
