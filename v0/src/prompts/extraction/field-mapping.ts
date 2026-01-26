import type { DataItemBase } from "../../types.js";

/**
 * Map code field names to prompt-friendly names.
 * Used when building prompts to make field semantics clearer for LLMs.
 * 
 * Mapping:
 * - level_current → exposure_current (how recently/frequently exposed)
 * - level_ideal → exposure_desired (how much they want to discuss)
 */
export function mapFieldsToPrompt(item: DataItemBase): Record<string, unknown> {
  const result: Record<string, unknown> = { ...item };
  
  if ('level_current' in item) {
    result.exposure_current = (item as any).level_current;
    delete result.level_current;
  }
  if ('level_ideal' in item) {
    result.exposure_desired = (item as any).level_ideal;
    delete result.level_ideal;
  }
  
  return result;
}

/**
 * Map prompt field names back to code names.
 * Used when parsing LLM responses.
 * 
 * Mapping:
 * - exposure_current → level_current
 * - exposure_desired → level_ideal
 * - exposure_impact → (stays as-is, processed separately for decay calculation)
 */
export function mapFieldsFromPrompt(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  
  if ('exposure_current' in data) {
    result.level_current = data.exposure_current;
    delete result.exposure_current;
  }
  if ('exposure_desired' in data) {
    result.level_ideal = data.exposure_desired;
    delete result.exposure_desired;
  }
  
  // exposure_impact stays as-is - it's handled separately in the extraction logic
  
  return result;
}
