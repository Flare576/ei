/**
 * Ei-curated effective limits for known models.
 *
 * These are NOT the provider's advertised maximums — they're the limits Ei uses in practice.
 * For example, Haiku's advertised context is 200k but real-world extraction quality degrades
 * above ~100k, so we cap it there. When adding new models, prefer conservative values based
 * on actual usage over marketing specs.
 *
 * Consumed two ways:
 * - Creation time (`tui/src/util/provider-detection.ts` `buildProviderAccounts`): stamps these
 *   values onto a freshly-detected ModelConfig as a starting point.
 * - Call time (`llm-client.ts` `callLLMRaw`): used as a fallback default whenever the stored
 *   ModelConfig doesn't have an explicit value — so a value dropped or never set on the stored
 *   config (e.g. a hand-edited or renamed model entry) still resolves correctly. An explicit
 *   field on the ModelConfig always wins over this table.
 */
export interface KnownModelLimits {
  token_limit?: number;
  max_output_tokens?: number;
  temperature_disabled?: boolean;
}

export const KNOWN_MODEL_LIMITS: Readonly<Record<string, KnownModelLimits>> = {
  // Anthropic — claude-opus-4.x
  // Models from 4-8 onward always use extended thinking and reject the temperature parameter.
  "claude-opus-4-8":              { token_limit: 200000, max_output_tokens: 128000, temperature_disabled: true },
  "claude-opus-4-7":              { token_limit: 200000, max_output_tokens: 128000 },
  "claude-opus-4-6":              { token_limit: 200000, max_output_tokens: 128000 },
  "claude-opus-4-5-20251101":     { token_limit: 200000, max_output_tokens: 64000 },
  "claude-opus-4-1-20250805":     { token_limit: 200000, max_output_tokens: 32000 },
  // Anthropic — claude-sonnet-5.x
  "claude-sonnet-5":              { token_limit: 200000, max_output_tokens: 128000, temperature_disabled: true },
  // Anthropic — claude-sonnet-4.x
  "claude-sonnet-4-6":            { token_limit: 200000, max_output_tokens: 64000 },
  "claude-sonnet-4-5-20250929":   { token_limit: 200000, max_output_tokens: 64000 },
  // Anthropic — claude-haiku-4.x
  // Note: advertised context is 200k but extraction quality degrades above ~100k in practice
  "claude-haiku-4-5-20251001":    { token_limit: 100000, max_output_tokens: 64000 },
};
