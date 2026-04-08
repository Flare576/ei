/**
 * Built-in identifier types shipped with Ei.
 *
 * Title Case — these are display labels in UI dropdowns, not database columns.
 * Matching is always case-insensitive, so existing lowercase records still work
 * until the user edits them.
 *
 * Any string is valid as an identifier type — users can define their own
 * (e.g. "Slack RNP", "sehimu_thinara"). This list is purely for discoverability.
 */
export const BUILT_IN_IDENTIFIER_TYPES: readonly string[] = [
  'Full Name',
  'First Name',
  'Nickname',
  'Email',
  'GitHub',
  'Discord',
  'Roblox',
  'Reddit',
  'Twitter',
  'FF14',
  'Relationship',
  'Ei Persona',
] as const;
