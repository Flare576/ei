/**
 * Decision logic for the startup "harness updated" nudge shown to EXISTING
 * users (i.e. those with at least one provider account already configured).
 *
 * This is intentionally decision-logic-only: no UI, no `local-state.ts`/
 * `pkg.version` reads. Callers are responsible for resolving
 * `installedVersion` (from `local.json` via `local-state.ts`) and
 * `currentVersion` (from `pkg.version`) and for acting on the result
 * (rendering `ConfirmOverlay`, running the install, stamping the new
 * version) — see Wave 4's wiring task.
 */
export function shouldShowUpgradePrompt(installedVersion: string | undefined, currentVersion: string): boolean {
  if (!installedVersion) return false;
  return installedVersion !== currentVersion;
}
