/**
 * D5 (wave-3 re-review): every literal `<`/`>` in a persisted claim must be
 * escaped BEFORE the claim is wrapped in its `<signal-claim>` boundary —
 * otherwise a claim containing the literal substring `</signal-claim>` (or
 * any other tag-shaped text) closes the boundary early and reaches
 * un-delimited prompt space. The escaped text is inert to a model reading
 * XML-shaped tags; it is never unescaped before rendering.
 *
 * `check.ts` and `ei.ts` otherwise keep their own file-specific formatting
 * helpers independent of one another (see `countTrailingPersonaMessages`/
 * `getLastPersonaMessage` in each file) — that split is real for those
 * helpers, which depend on file-specific types (`HeartbeatCheckPromptData`/
 * `EiHeartbeatPromptData`). `escapeSignalClaimText` was the one place that
 * "each file owns its own helpers" rule got applied inconsistently: it is a
 * pure, fully generic `(claim: string) => string` with no dependency on
 * either file's types, and both files already import shared helpers from
 * `../message-utils.js` and `../response/sections.js`. This file corrects
 * that inconsistency rather than reversing the general per-file-helpers
 * preference, which still holds everywhere else.
 */
export function escapeSignalClaimText(claim: string): string {
  return claim.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
