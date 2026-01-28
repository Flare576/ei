import type { ChatMessage } from "./types.js";

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;
}

export interface LLMCallOptions {
  signal?: AbortSignal;
  temperature?: number;
}

export interface LLMRawResponse {
  content: string | null;
  finishReason: string | null;
}

const PROVIDERS: Record<string, () => ProviderConfig> = {
  local: () => ({
    name: "Local (LM Studio/Ollama)",
    baseURL: getEnv("EI_LLM_BASE_URL", "http://127.0.0.1:1234/v1"),
    apiKey: getEnv("EI_LLM_API_KEY", "not-needed"),
  }),
  openai: () => ({
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: getEnv("EI_OPENAI_API_KEY", ""),
  }),
  google: () => ({
    name: "Google AI Studio",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: getEnv("EI_GOOGLE_API_KEY", ""),
  }),
  anthropic: () => ({
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: getEnv("EI_ANTHROPIC_API_KEY", ""),
  }),
  x: () => ({
    name: "xAI (Grok)",
    baseURL: "https://api.x.ai/v1",
    apiKey: getEnv("EI_XAI_API_KEY", ""),
  }),
};

function getEnv(key: string, fallback: string): string {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(key);
      if (stored) return stored;
    }
  } catch {
    // localStorage not available
  }

  try {
    if (typeof globalThis !== "undefined" && "process" in globalThis) {
      const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
      return proc?.env?.[key] ?? fallback;
    }
  } catch {
    // Browser environment without process
  }
  return fallback;
}

export function resolveModel(modelSpec?: string): { provider: string; model: string; config: ProviderConfig } {
  const spec = modelSpec || getEnv("EI_LLM_MODEL", "local-model");
  
  let provider = "local";
  let model = spec;
  
  if (spec.includes(":")) {
    const [p, ...rest] = spec.split(":");
    provider = p;
    model = rest.join(":");
  }
  
  const configFn = PROVIDERS[provider];
  if (!configFn) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  
  return { provider, model, config: configFn() };
}

export async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  messages: ChatMessage[] = [],
  modelSpec?: string,
  options: LLMCallOptions = {}
): Promise<LLMRawResponse> {
  const { signal, temperature = 0.7 } = options;
  
  if (signal?.aborted) {
    throw new Error("LLM call aborted");
  }
  
  const { model, config } = resolveModel(modelSpec);
  
  const chatMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
    { role: "user", content: userPrompt },
  ];
  
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey && config.apiKey !== "not-needed" 
        ? { Authorization: `Bearer ${config.apiKey}` } 
        : {}),
    },
    body: JSON.stringify({
      model,
      messages: chatMessages,
      temperature,
    }),
    signal,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }
  
  const data = await response.json();
  const choice = data.choices?.[0];
  
  return {
    content: choice?.message?.content ?? null,
    finishReason: choice?.finish_reason ?? null,
  };
}

const JSON_REPAIR_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\/\/[^\n]*/g, replacement: "" },
  { pattern: /\\'/g, replacement: "'" },
  { pattern: /:\s*(\d{4}-\d{2}-\d{2}T[^"}\],\n]+)/g, replacement: ': "$1"' },
  { pattern: /:\s*0([1-9][0-9]*)([,\s\n\r\]}])/g, replacement: ": 0.$1$2" },
  { pattern: /,(\s*[\]}])/g, replacement: "$1" },
];

export function repairJSON(jsonStr: string): string {
  let repaired = JSON_REPAIR_PATTERNS.reduce(
    (str, { pattern, replacement }) => str.replace(pattern, replacement),
    jsonStr
  );
  
  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired += '"';
  }
  
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += "]";
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += "}";
  }
  
  return repaired;
}

export function parseJSONResponse(content: string): unknown {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
  
  try {
    return JSON.parse(jsonStr);
  } catch {
    const repaired = repairJSON(jsonStr);
    return JSON.parse(repaired);
  }
}

export function cleanResponseContent(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}
