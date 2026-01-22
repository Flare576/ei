import OpenAI from "openai";
import { appendDebugLog } from "./storage.js";

// =============================================================================
// Provider Configuration and Client Management
// =============================================================================

/**
 * Configuration for an LLM provider endpoint
 */
export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;  // Display name for /model --list
  defaultHeaders?: Record<string, string>;
}

/**
 * Registry of supported LLM providers.
 * Uses lazy evaluation (functions) so env vars are read at resolution time.
 */
const PROVIDERS: Record<string, () => ProviderConfig> = {
  local: () => ({
    name: "Local (LM Studio/Ollama)",
    baseURL: process.env.EI_LLM_BASE_URL || "http://127.0.0.1:1234/v1",
    apiKey: process.env.EI_LLM_API_KEY || "not-needed",
  }),
  openai: () => ({
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.EI_OPENAI_API_KEY || "",
  }),
  google: () => ({
    name: "Google AI Studio",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.EI_GOOGLE_API_KEY || "",
  }),
  anthropic: () => ({
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: process.env.EI_ANTHROPIC_API_KEY || "",
    defaultHeaders: {
      "anthropic-version": "2023-06-01",
    },
  }),
  x: () => ({
    name: "xAI (Grok)",
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.EI_XAI_API_KEY || "",
  }),
};

/**
 * Cache for OpenAI client instances, keyed by provider name.
 * Prevents creating redundant client instances for the same provider.
 */
const clientCache = new Map<string, OpenAI>();

/**
 * Get or create an OpenAI client for the specified provider.
 * Clients are cached to avoid redundant instance creation.
 * 
 * @param provider - Provider key (e.g., "local", "openai", "google")
 * @returns OpenAI client configured for the provider
 * @throws Error if provider is unknown or API key is missing (for non-local providers)
 */
function getOrCreateClient(provider: string): OpenAI {
  if (clientCache.has(provider)) {
    return clientCache.get(provider)!;
  }

  const configFn = PROVIDERS[provider];
  if (!configFn) {
    throw new Error(`Unknown provider: ${provider}. Valid providers: ${Object.keys(PROVIDERS).join(", ")}`);
  }

  const config = configFn();
  if (!config.apiKey && provider !== "local") {
    const envVarName = provider === "x" ? "EI_XAI_API_KEY" : `EI_${provider.toUpperCase()}_API_KEY`;
    throw new Error(`No API key configured for provider: ${provider}. Set ${envVarName}`);
  }

  const newClient = new OpenAI({ 
    baseURL: config.baseURL, 
    apiKey: config.apiKey,
    defaultHeaders: config.defaultHeaders,
  });
  clientCache.set(provider, newClient);
  return newClient;
}

/**
 * Result of resolving a model specification
 */
export interface ResolvedModel {
  client: OpenAI;
  model: string;
  provider: string;
}

/**
 * LLM operation types for operation-specific model defaults.
 * Each operation type can have a different default model configured via env var.
 */
export type LLMOperation = "response" | "concept" | "generation";

/**
 * Maps operation types to their corresponding environment variable names.
 * These env vars provide operation-specific model defaults.
 */
const OPERATION_ENV_VARS: Record<LLMOperation, string> = {
  response: "EI_MODEL_RESPONSE",
  concept: "EI_MODEL_CONCEPT",
  generation: "EI_MODEL_GENERATION",
};

/**
 * Parse a model specification and return the appropriate client and model name.
 * 
 * Model spec format: "provider:model" (e.g., "openai:gpt-4o", "google:gemini-pro")
 * Bare model names (no colon) assume "local" provider.
 * 
 * Resolution chain (highest to lowest priority):
 * 1. Explicit modelSpec parameter
 * 2. Operation-specific env var (EI_MODEL_RESPONSE, EI_MODEL_CONCEPT, EI_MODEL_GENERATION)
 * 3. Global EI_LLM_MODEL env var
 * 4. Hardcoded default: local:google/gemma-3-12b
 * 
 * @param modelSpec - Model specification string, or undefined for fallback chain
 * @param operation - Operation type for operation-specific model selection
 * @returns Resolved model with client, model name, and provider
 * @throws Error if provider is unknown or API key is missing
 */
export function resolveModel(modelSpec?: string, operation?: LLMOperation): ResolvedModel {
  let spec: string;

  if (modelSpec) {
    // 1. Explicit model spec (highest priority)
    spec = modelSpec;
  } else if (operation) {
    // 2. Operation-specific env var
    const opEnvVar = OPERATION_ENV_VARS[operation];
    const opModel = process.env[opEnvVar];
    if (opModel) {
      spec = opModel;
    } else {
      // 3. Global default
      spec = process.env.EI_LLM_MODEL || "local:qwen/qwen3-14b";
    }
  } else {
    // 3. Global default (no operation specified)
    spec = process.env.EI_LLM_MODEL || "local:qwen/qwen3-14b";
  }

  let provider: string;
  let model: string;

  if (spec.includes(":")) {
    [provider, model] = spec.split(":", 2);
  } else {
    // Bare model name assumes local provider
    provider = "local";
    model = spec;
  }

  return {
    client: getOrCreateClient(provider),
    model,
    provider,
  };
}

/**
 * Status information for a provider
 */
export interface ProviderStatus {
  name: string;
  provider: string;
  configured: boolean;
  baseURL: string;
}

/**
 * Get the configuration status of all providers.
 * Useful for displaying available providers in /model --list.
 * 
 * @returns Array of provider status objects
 */
export function getProviderStatuses(): ProviderStatus[] {
  return Object.entries(PROVIDERS).map(([key, configFn]) => {
    const config = configFn();
    return {
      provider: key,
      name: config.name,
      configured: key === "local" || !!config.apiKey,
      baseURL: config.baseURL,
    };
  });
}

/**
 * Clear the client cache. Primarily for testing.
 * @internal
 */
export function clearClientCache(): void {
  clientCache.clear();
}

export class LLMAbortedError extends Error {
  constructor() {
    super("LLM call aborted");
    this.name = "LLMAbortedError";
  }
}

export class LLMTruncatedError extends Error {
  constructor(message?: string) {
    super(message || "LLM response was truncated due to token limit. Consider simplifying the request or increasing MAX_TOKENS.");
    this.name = "LLMTruncatedError";
  }
}

const JSON_REPAIR_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Remove JavaScript-style comments (// ...) - must be first to avoid breaking other repairs
  { pattern: /\/\/[^\n]*/g, replacement: "" },
  // Fix missing opening quote before ISO date values: 2026-01-18T... → "2026-01-18T..."
  { pattern: /:\s*(\d{4}-\d{2}-\d{2}T[^"}\],\n]+)/g, replacement: ': "$1"' },
  // Fix leading zeros: 03 → 0.3, 015 → 0.15
  { pattern: /:\s*0([1-9][0-9]*)([,\s\n\r\]}])/g, replacement: ": 0.$1$2" },
  // Remove trailing commas before ] or }
  { pattern: /,(\s*[\]}])/g, replacement: "$1" },
];

// Attempt to fix truncated JSON by closing open structures
function attemptTruncationRepair(jsonStr: string): string {
  let repaired = jsonStr.trim();
  
  // If it looks like JSON got cut off mid-string, try to close it
  // Count unbalanced quotes (simple heuristic - not perfect for escaped quotes)
  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    // Odd number of quotes - string is unclosed
    repaired += '"';
  }
  
  // Count braces/brackets and close them
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  // Close any unclosed structures
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }
  
  return repaired;
}

function repairJSON(jsonStr: string): string {
  return JSON_REPAIR_PATTERNS.reduce(
    (str, { pattern, replacement }) => str.replace(pattern, replacement),
    jsonStr
  );
}

export interface LLMOptions {
  signal?: AbortSignal;
  temperature?: number;
  model?: string;
  operation?: LLMOperation;
}

interface LLMRawResponse {
  content: string | null;
  finishReason: string | null;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "AbortError" || err.message.includes("aborted");
  }
  return false;
}

const DEBUG = process.env.DEBUG || process.argv.includes("--debug") || process.argv.includes("-d");

// =============================================================================
// Rate Limit Handling
// =============================================================================

export const RATE_LIMIT_CODES = [429, 529]; // 429 = standard rate limit, 529 = Anthropic overload
export const MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 1000;

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    return RATE_LIMIT_CODES.includes((err as { status: number }).status);
  }
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<LLMRawResponse> {
  const { signal, temperature = 0.7, model: modelSpec, operation } = options;
  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  const { client, model, provider } = resolveModel(modelSpec, operation);

  if (DEBUG) {
    appendDebugLog(`[LLM] Using ${provider}:${model} for operation: ${operation || 'unspecified'}`);
    appendDebugLog(`[LLM] System prompt:\n${systemPrompt}`);
    appendDebugLog(`[LLM] User prompt:\n${userPrompt}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new LLMAbortedError();
    }

    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
        },
        { signal }
      );

      if (signal?.aborted) {
        throw new LLMAbortedError();
      }

      return {
        content: response.choices[0]?.message?.content?.trim() ?? null,
        finishReason: response.choices[0]?.finish_reason ?? null,
      };
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        throw new LLMAbortedError();
      }

      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        appendDebugLog(`[LLM] Rate limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${backoffMs}ms...`);
        await sleep(backoffMs);
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

function cleanModelResponse(content: string): string {
  let cleaned = content;
  
  const responseTagMatch = cleaned.match(/<RESPONSE>([\s\S]*?)<\/RESPONSE>/i);
  if (responseTagMatch) {
    cleaned = responseTagMatch[1];
  }
  
  cleaned = cleaned.replace(/^[\s\S]*?<\/thinking>/i, '');
  cleaned = cleaned.replace(/^[\s\S]*?<\/think>/i, '');
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  return cleaned.trim();
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<string | null> {
  const { content } = await callLLMRaw(systemPrompt, userPrompt, options);

  if (!content) return null;

  const cleaned = cleanModelResponse(content);

  const noMessagePatterns = [
    /^no message$/i,
    /^\[no message\]$/i,
    /^no response$/i,
    /^\[no response\]$/i,
  ];

  for (const pattern of noMessagePatterns) {
    if (pattern.test(cleaned)) return null;
  }

  return cleaned;
}

class JSONParseFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JSONParseFailure";
  }
}

/**
 * Attempts to parse JSON from LLM response, applying repairs if needed.
 * Returns null if LLM returns no content.
 * Throws JSONParseFailure if content exists but cannot be parsed.
 * @internal
 */
async function attemptJSONParse<T>(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<T | null> {
  const { content, finishReason } = await callLLMRaw(systemPrompt, userPrompt, options);
  
  if (finishReason === "length") {
    throw new LLMTruncatedError(
      "LLM response was truncated due to token limit. The concept map may be too large. Consider simplifying the request."
    );
  }
  
  if (!content) return null;

  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const thinkingTagMatch = content.match(/<think>[\s\S]*?<\/think>\s*([\s\S]*)/);
  
  let jsonStr: string;
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else if (thinkingTagMatch) {
    jsonStr = thinkingTagMatch[1].trim();
  } else {
    jsonStr = content.trim();
  }

  try {
    return JSON.parse(jsonStr) as T;
  } catch (firstErr) {
    appendDebugLog(`[LLM] JSON parse failed (attempt 1), trying repairs. Error: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`);
    appendDebugLog(`[LLM] Raw content length: ${content.length}, finishReason: ${finishReason}`);
    
    const repaired = repairJSON(jsonStr);
    try {
      appendDebugLog("[LLM] Standard JSON repair applied successfully");
      return JSON.parse(repaired) as T;
    } catch (secondErr) {
      appendDebugLog(`[LLM] Standard repair failed, trying truncation repair. Error: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`);
      
      const truncationRepaired = attemptTruncationRepair(repaired);
      try {
        appendDebugLog("[LLM] Truncation repair applied successfully");
        return JSON.parse(truncationRepaired) as T;
      } catch (thirdErr) {
        appendDebugLog("[LLM] All JSON repairs failed. Logging full content for diagnosis:");
        appendDebugLog(`[LLM] Original raw content:\n${content}`);
        appendDebugLog(`[LLM] Extracted JSON:\n${jsonStr}`);
        appendDebugLog(`[LLM] After standard repair:\n${repaired}`);
        appendDebugLog(`[LLM] After truncation repair:\n${truncationRepaired}`);
        throw new JSONParseFailure(`Invalid JSON from LLM: ${thirdErr instanceof Error ? thirdErr.message : String(thirdErr)}`);
      }
    }
  }
}

export async function callLLMForJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<T | null> {
  try {
    return await attemptJSONParse<T>(systemPrompt, userPrompt, options);
  } catch (err) {
    if (err instanceof LLMTruncatedError) {
      throw err;
    }
    
    if (!(err instanceof JSONParseFailure)) {
      throw err;
    }
    
    const enhancedSystemPrompt = systemPrompt + `

CRITICAL: Your response MUST be valid JSON. No markdown code fences, no explanations, just the JSON object/array.`;
    
    console.warn("[LLM] JSON parse failed, retrying with enhanced guidance...");
    
    try {
      return await attemptJSONParse<T>(enhancedSystemPrompt, userPrompt, options);
    } catch (retryErr) {
      if (retryErr instanceof JSONParseFailure) {
        throw new Error("Invalid JSON from LLM even after retry with enhanced guidance");
      }
      throw retryErr;
    }
  }
}
