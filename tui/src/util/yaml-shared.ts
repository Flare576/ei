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

// =============================================================================
// STABLE IDENTITY RESOLUTION (issue #86)
// =============================================================================

/**
 * Resolves the stable id for one edited YAML entry (provider model, persona
 * trait, or persona topic) against the entries that existed before the edit.
 *
 * Editable YAML round-tripped through `*ToYAML` always carries the entry's
 * `id`, so a rename (a name-only change) still resolves to its original id
 * here — that is the fix for issue #86: renaming must not mint a new
 * identity or orphan every settings/persona/queue reference to the old one.
 *
 * - `id` present: must belong to `existing` and must not collide with an id
 *   already resolved earlier in the same edit. Both are hard errors — a
 *   silently accepted foreign or duplicate id would corrupt or merge
 *   unrelated records instead of just failing loudly.
 * - `id` absent: falls back to matching `existing` by `name`. This is the
 *   pre-existing behavior, kept for hand-written YAML that never carries an
 *   `id` field. No match on either axis means a genuinely new entry, which
 *   mints a fresh id.
 */
export function resolveEntryId<E extends { id: string; name: string }>(
  candidate: { id?: string; name: string },
  existing: readonly E[],
  seenIds: Set<string>,
  entityLabel: string
): string {
  if (candidate.id !== undefined) {
    if (!existing.some(e => e.id === candidate.id)) {
      throw new Error(
        `${entityLabel} identity "${candidate.id}" (name: "${candidate.name}") does not belong to this record.`
      );
    }
    if (seenIds.has(candidate.id)) {
      throw new Error(`${entityLabel} identity "${candidate.id}" is used by more than one entry.`);
    }
    seenIds.add(candidate.id);
    return candidate.id;
  }
  const byName = existing.find(e => e.name === candidate.name && !seenIds.has(e.id));
  if (byName) {
    seenIds.add(byName.id);
    return byName.id;
  }
  return crypto.randomUUID();
}
