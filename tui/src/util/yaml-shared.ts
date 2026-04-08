// =============================================================================
// GUID <-> DISPLAY NAME HELPERS
// =============================================================================

import type { ProviderAccount } from "../../../src/core/types.js";

/**
 * Convert a model GUID to "ProviderName:modelName" display string.
 * Falls back to the raw GUID if the model is not found.
 */
export function modelGuidToDisplay(guid: string, accounts: ProviderAccount[]): string {
  for (const account of accounts) {
    const model = (account.models ?? []).find(m => m.id === guid);
    if (model) return `${account.name}:${model.name}`;
  }
  return guid; // fallback: return raw GUID if not found
}

/**
 * Resolve "ProviderName:modelName" display string back to a model GUID.
 * Returns undefined if no matching provider+model is found.
 * Handles colons in model names by treating everything after the first colon as the model name.
 */
export function displayToModelGuid(display: string, accounts: ProviderAccount[]): string | undefined {
  const colonIdx = display.indexOf(':');
  if (colonIdx < 0) return undefined;
  const providerName = display.substring(0, colonIdx);
  const modelName = display.substring(colonIdx + 1);
  const account = accounts.find(a => a.name === providerName);
  const model = (account?.models ?? []).find(m => m.name === modelName);
  return model?.id;
}
