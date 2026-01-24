import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

let idealResponse: FastScanResponse | null = null;

async function loadIdealResponse(): Promise<FastScanResponse> {
  if (idealResponse) return idealResponse;
  
  const idealPath = path.join(__dirname, 'fast-scan-combined-ideal-response.json');
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

function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

function itemsMatch(item1: FastScanItem | FastScanNewItem, item2: FastScanItem | FastScanNewItem): boolean {
  const norm1 = normalizeItemName(item1.name);
  const norm2 = normalizeItemName(item2.name);
  
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return true;
  }
  
  const words1 = new Set(norm1.split(/\s+/));
  const words2 = new Set(norm2.split(/\s+/));
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
  
  const typedResponse = parsed as FastScanResponse;
  
  const ideal = await loadIdealResponse();
  
  const allIdealItems = [...ideal.mentioned, ...ideal.new_items];
  const allResponseItems = [...typedResponse.mentioned, ...typedResponse.new_items];
  
  const foundItems: string[] = [];
  const missedItems: string[] = [];
  let typeMatches = 0;
  let confidenceMatches = 0;
  
  for (const idealItem of allIdealItems) {
    const match = allResponseItems.find(respItem => itemsMatch(idealItem, respItem));
    
    if (match) {
      foundItems.push(idealItem.name);
      if (match.type === idealItem.type) typeMatches++;
      if (match.confidence === idealItem.confidence) confidenceMatches++;
    } else {
      missedItems.push(idealItem.name);
    }
  }
  
  const extraItems = allResponseItems
    .filter(respItem => !allIdealItems.some(idealItem => itemsMatch(idealItem, respItem)))
    .map(item => item.name);
  
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
