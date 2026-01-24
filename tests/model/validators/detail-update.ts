export interface DetailUpdateResponse {
  name: string;
  description: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  success: boolean;
  parsed?: DetailUpdateResponse;
  error?: string;
}

function extractJSON(response: string): string {
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  const thinkingMatch = response.match(/<think>[\s\S]*?<\/think>\s*([\s\S]*)/);
  if (thinkingMatch) {
    return thinkingMatch[1].trim();
  }
  
  return response.trim();
}

export function validate(response: string): ValidationResult {
  const jsonStr = extractJSON(response);
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return {
      success: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      error: 'Response must be a JSON object',
    };
  }
  
  const obj = parsed as Record<string, unknown>;
  
  if (typeof obj.name !== 'string' || !obj.name) {
    return {
      success: false,
      error: 'Missing or invalid field: name (must be non-empty string)',
    };
  }
  
  if (typeof obj.description !== 'string' || !obj.description) {
    return {
      success: false,
      error: 'Missing or invalid field: description (must be non-empty string)',
    };
  }
  
  return {
    success: true,
    parsed: parsed as DetailUpdateResponse,
  };
}
