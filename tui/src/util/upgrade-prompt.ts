/**
 * Decision logic for the startup "harness updated" nudge shown to EXISTING
 * users (i.e. those with at least one provider account already configured).
 *
 * Returns true whenever `local.json`'s `installed_version` is not exactly
 * `currentVersion`. That includes an ABSENT (or empty) stamp: an existing
 * user with no record either set up before the stamp existed or installed
 * via an older `ei --install`, so their harness hooks/skills are treated as
 * stale. First boot with no accounts never reaches this check — the caller
 * routes that to the onboarding wizard instead.
 *
 * This is intentionally decision-logic-only: no UI, no `local-state.ts`/
 * `pkg.version` reads. Callers are responsible for resolving
 * `installedVersion` (from `local.json` via `src/cli/local-state.ts`) and
 * `currentVersion` (from `pkg.version`) and for acting on the result
 * (rendering `ConfirmOverlay`, running the install, stamping the new
 * version).
 */
export function shouldShowUpgradePrompt(installedVersion: string | undefined, currentVersion: string): boolean {
  return installedVersion !== currentVersion;
}
