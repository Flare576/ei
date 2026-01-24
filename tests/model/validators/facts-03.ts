import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FactItem {
  type_of_fact: string;
  value_of_fact: string;
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
}

interface FactsResponse {
  mentioned: FactItem[];
  new_items: FactItem[];
}

export interface ValidationResult {
  success: boolean;
  parsed?: FactsResponse;
  error?: string;
  score?: number;
  analysis?: {
    totalIdealItems: number;
    foundItems: number;
    missedItems: string[];
    extraItems: string[];
    typeMatches: number;
    confidenceMatches: number;
    hallucinationPenalty: number;
  };
}

let idealResponse: FactsResponse | null = null;

async function loadIdealResponse(): Promise<FactsResponse> {
  if (idealResponse) return idealResponse;
  
  const idealPath = path.join(__dirname, 'facts-03-ideal.json');
  const content = await fs.readFile(idealPath, 'utf-8');
  idealResponse = JSON.parse(content);
  return idealResponse!;
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

function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

function factsMatch(item1: FactItem, item2: FactItem): boolean {
  const type1 = normalizeValue(item1.type_of_fact);
  const type2 = normalizeValue(item2.type_of_fact);
  const val1 = normalizeValue(item1.value_of_fact);
  const val2 = normalizeValue(item2.value_of_fact);
  
  if (type1 === type2 && (val1.includes(val2) || val2.includes(val1))) {
    return true;
  }
  
  const words1 = new Set([...type1.split(/\s+/), ...val1.split(/\s+/)]);
  const words2 = new Set([...type2.split(/\s+/), ...val2.split(/\s+/)]);
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const jaccardSimilarity = intersection.size / union.size;
  return jaccardSimilarity > 0.5;
}

function validateItem(item: unknown, requireReason: boolean): string | null {
  if (typeof item !== 'object' || item === null) {
    return 'Item must be an object';
  }
  
  const obj = item as Record<string, unknown>;
  
  if (typeof obj.type_of_fact !== 'string' || !obj.type_of_fact) {
    return 'Item missing required field: type_of_fact (string)';
  }
  
  if (typeof obj.value_of_fact !== 'string' || !obj.value_of_fact) {
    return 'Item missing required field: value_of_fact (string)';
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

export async function validate(response: string): Promise<ValidationResult> {
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
  
  const typedResponse = parsed as FactsResponse;
  
  const ideal = await loadIdealResponse();
  
  const allIdealItems = [...ideal.mentioned, ...ideal.new_items];
  const allResponseItems = [...typedResponse.mentioned, ...typedResponse.new_items];
  
  const foundItems: string[] = [];
  const missedItems: string[] = [];
  let typeMatches = 0;
  let confidenceMatches = 0;
  
  for (const idealItem of allIdealItems) {
    const match = allResponseItems.find(respItem => factsMatch(idealItem, respItem));
    
    if (match) {
      foundItems.push(`${idealItem.type_of_fact}: ${idealItem.value_of_fact}`);
      if (normalizeValue(match.type_of_fact) === normalizeValue(idealItem.type_of_fact)) typeMatches++;
      if (match.confidence === idealItem.confidence) confidenceMatches++;
    } else {
      missedItems.push(`${idealItem.type_of_fact}: ${idealItem.value_of_fact}`);
    }
  }
  
  const extraItems = allResponseItems
    .filter(respItem => !allIdealItems.some(idealItem => factsMatch(idealItem, respItem)))
    .map(item => `${item.type_of_fact}: ${item.value_of_fact}`);
  
  const recallScore = foundItems.length / allIdealItems.length;
  const precisionScore = allResponseItems.length > 0 
    ? (allResponseItems.length - extraItems.length) / allResponseItems.length 
    : 0;
  
  const typeAccuracy = foundItems.length > 0 ? typeMatches / foundItems.length : 0;
  const confidenceAccuracy = foundItems.length > 0 ? confidenceMatches / foundItems.length : 0;
  
  const hallucinationPenalty = extraItems.length * 0.05;
  
  const baseScore = (recallScore * 0.4) + (precisionScore * 0.3) + (typeAccuracy * 0.2) + (confidenceAccuracy * 0.1);
  const score = Math.max(0, baseScore - hallucinationPenalty);
  
  return {
    success: true,
    parsed: typedResponse,
    score: Math.round(score * 100) / 100,
    analysis: {
      totalIdealItems: allIdealItems.length,
      foundItems: foundItems.length,
      missedItems,
      extraItems,
      typeMatches,
      confidenceMatches,
      hallucinationPenalty,
    },
  };
}
