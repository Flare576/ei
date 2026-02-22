import type { ChatMessage, ProviderAccount } from "./types.js";

export interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;
}

export interface ResolvedModel {
  provider: string;
  model: string;
  config: ProviderConfig;
  extraHeaders?: Record<string, string>;
}

export interface LLMCallOptions {
  signal?: AbortSignal;
  temperature?: number;
}

export interface LLMRawResponse {
  content: string | null;
  finishReason: string | null;
}

let llmCallCount = 0;



export function resolveModel(modelSpec?: string, accounts?: ProviderAccount[]): ResolvedModel {
  if (!modelSpec) {
    throw new Error("No model specified. Set a provider on this persona with /provider, or set a default_model in settings.");
  }
  let provider = "";
  let model = modelSpec;
  
  if (modelSpec.includes(":")) {
    const [p, ...rest] = modelSpec.split(":");
    provider = p;
    model = rest.join(":");
  }
  // Try to find matching account by name (case-insensitive)
  // Check both "provider:model" format AND bare account names
  if (accounts) {
    const searchName = provider || modelSpec; // If no ":", the whole spec might be an account name
    const matchingAccount = accounts.find(
      (acc) => acc.name.toLowerCase() === searchName.toLowerCase() && acc.enabled
    );
    if (matchingAccount) {
      // If bare account name was used, get model from account's default_model
      const resolvedModel = provider ? model : (matchingAccount.default_model || model);
      return {
        provider: matchingAccount.name,
        model: resolvedModel,
        config: {
          name: matchingAccount.name,
          baseURL: matchingAccount.url,
          apiKey: matchingAccount.api_key || "",
        },
        extraHeaders: matchingAccount.extra_headers,
      };
    }
  }
  
  throw new Error(
    `No provider "${provider || modelSpec}" found. Create one with /provider new, or check that it's enabled.`
  );
}

export async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  messages: ChatMessage[] = [],
  modelSpec?: string,
  options: LLMCallOptions = {},
  accounts?: ProviderAccount[]
): Promise<LLMRawResponse> {
  llmCallCount++;
  
  const { signal, temperature = 0.7 } = options;
  
  if (signal?.aborted) {
    throw new Error("LLM call aborted");
  }
  
  const { model, config, extraHeaders } = resolveModel(modelSpec, accounts);
  
  const chatMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
    { role: "user", content: userPrompt },
  ];
  
  const finalMessages = ensureUserFirst(chatMessages);
  
  if (finalMessages.length !== chatMessages.length) {
    console.log(`[LLM] Injected user-first placeholder (${chatMessages.length} → ${finalMessages.length} messages)`);
  }
  
  const totalChars = finalMessages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  console.log(`[LLM] Call #${llmCallCount} - ~${estimatedTokens} tokens (${totalChars} chars)`);
  
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...(extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      messages: finalMessages,
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

/**
 * Ensures the message array starts with a user message after system.
 * Some models (Gemma, Mistral) require system → user → assistant ordering.
 */
function ensureUserFirst(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return [];
  
  const result = [...messages];
  
  if (result[0].role === "system" && result.length > 1 && result[1].role === "assistant") {
    result.splice(1, 0, { role: "user", content: "(conversation start)" });
  }
  
  return result;
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
