/**
 * Validator for fast-scan extraction prompts.
 * 
 * Checks that the LLM returns valid JSON matching the expected schema:
 * {
 *   "mentioned": [{ "name": string, "type": string, "confidence": string }],
 *   "new_items": [{ "name": string, "type": string, "confidence": string, "reason": string }]
 * }
 */

interface FastScanItem {
  name: string;
  type: 'fact' | 'trait' | 'topic' | 'person';
  confidence: 'high' | 'medium' | 'low';
}

interface FastScanNewItem extends FastScanItem {
  reason: string;
}

interface FastScanResponse {
  mentioned: FastScanItem[];
  new_items: FastScanNewItem[];
}

export interface ValidationResult {
  success: boolean;
  parsed?: FastScanResponse;
  error?: string;
}

function extractJSON(response: string): string {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // Try to extract JSON from thinking tags
  const thinkingMatch = response.match(/<think>[\s\S]*?<\/think>\s*([\s\S]*)/);
  if (thinkingMatch) {
    return thinkingMatch[1].trim();
  }
  
  return response.trim();
}

function validateItem(item: unknown, requireReason: boolean): string | null {
  if (typeof item !== 'object' || item === null) {
    return 'Item must be an object';
  }
  
  const obj = item as Record<string, unknown>;
  
  if (typeof obj.name !== 'string' || !obj.name) {
    return 'Item missing required field: name (string)';
  }
  
  const validTypes = ['fact', 'trait', 'topic', 'person'];
  if (!validTypes.includes(obj.type as string)) {
    return `Invalid type: ${obj.type} (must be: ${validTypes.join(', ')})`;
  }
  
  const validConfidence = ['high', 'medium', 'low'];
  if (!validConfidence.includes(obj.confidence as string)) {
    return `Invalid confidence: ${obj.confidence} (must be: ${validConfidence.join(', ')})`;
  }
  
  if (requireReason && (typeof obj.reason !== 'string' || !obj.reason)) {
    return 'new_items must include a reason (string)';
  }
  
  return null;
}

export function validate(response: string): ValidationResult {
  // Extract JSON from response
  const jsonStr = extractJSON(response);
  
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return {
      success: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  
  // Validate structure
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      error: 'Response must be a JSON object',
    };
  }
  
  const obj = parsed as Record<string, unknown>;
  
  // Validate mentioned array
  if (!Array.isArray(obj.mentioned)) {
    return {
      success: false,
      error: 'Missing or invalid field: mentioned (must be array)',
    };
  }
  
  for (let i = 0; i < obj.mentioned.length; i++) {
    const error = validateItem(obj.mentioned[i], false);
    if (error) {
      return {
        success: false,
        error: `mentioned[${i}]: ${error}`,
      };
    }
  }
  
  // Validate new_items array
  if (!Array.isArray(obj.new_items)) {
    return {
      success: false,
      error: 'Missing or invalid field: new_items (must be array)',
    };
  }
  
  for (let i = 0; i < obj.new_items.length; i++) {
    const error = validateItem(obj.new_items[i], true);
    if (error) {
      return {
        success: false,
        error: `new_items[${i}]: ${error}`,
      };
    }
  }
  
  return {
    success: true,
    parsed: parsed as FastScanResponse,
  };
}
