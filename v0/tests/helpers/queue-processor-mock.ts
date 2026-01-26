import { vi } from 'vitest';

/**
 * Mock QueueProcessor for integration tests.
 * Prevents real async processing loops that would accumulate across tests.
 */
export function createQueueProcessorMock() {
  class MockQueueProcessor {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();
  }

  return {
    QueueProcessor: MockQueueProcessor,
  };
}
