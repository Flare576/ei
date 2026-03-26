import type { LLMResponse } from "../types.js";
import type { StateManager } from "../state-manager.js";

export function handlePersonaPreview(_response: LLMResponse, _state: StateManager): void {
  // Intentionally empty — state writes are not needed for preview generation.
  // The Processor post-dispatch block handles: completeness validation, re-queue, and Promise resolution.
}
