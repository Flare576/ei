// Last updated: 2026-02-22
// Prefix-based lookup: "gpt-4o" matches "gpt-4o", "gpt-4o-2024-08-06", "gpt-4o-mini", etc.
const KNOWN_CONTEXT_WINDOWS: [string, number][] = [
  // OpenAI
  ["gpt-4.1", 1_048_576],
  ["gpt-4o", 128_000],
  ["gpt-3.5-turbo", 16_384],

  // Anthropic
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-3.5", 200_000],
  ["claude-3", 200_000],

  // Google
  ["gemini-2.5", 1_000_000],
  ["gemini-2.0", 1_000_000],
  ["gemini-1.5", 1_000_000],

  // Meta Llama
  ["llama-3.3", 131_072],
  ["llama-3.2", 131_072],
  ["llama-3.1", 131_072],

  // Mistral
  ["mixtral", 32_768],
  ["mistral", 32_768],

  // DeepSeek
  ["deepseek-coder-v2", 163_840],
  ["deepseek-v3", 131_072],
  ["deepseek", 131_072],

  // Qwen
  ["qwen-2.5", 131_072],
  ["qwen", 131_072],
];

const DEFAULT_TOKEN_LIMIT = 8192;

export function getKnownContextWindow(modelName: string): number | undefined {
  const lower = modelName.toLowerCase();
  for (const [prefix, tokens] of KNOWN_CONTEXT_WINDOWS) {
    if (lower.startsWith(prefix.toLowerCase())) return tokens;
  }
  return undefined;
}

export { DEFAULT_TOKEN_LIMIT };
