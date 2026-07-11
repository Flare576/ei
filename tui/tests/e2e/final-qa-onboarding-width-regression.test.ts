// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable.
//
// REAL tui-test E2E regression capture (run via a genuine PTY under Node 20,
// per Main's live confirmation that tui-test itself works fine here — the
// documented node-pty ABI mismatch is specific to running e2e files under
// plain `bun test`, not `tui-test` proper).
//
// Both tests below are EXPECTED TO FAIL (red) and are left in place as
// reproducible evidence — see .sisyphus/evidence/final-qa/ for the full
// writeup and the exact commands used to isolate root cause. Every timing
// primitive used here is the SAME `expect(...).toBeVisible({ timeout })`
// option already used by every other file in this directory (e.g.
// provider-command.test.ts) — no hand-authored setTimeout/Promise wait of
// any kind. Real-PTY rendering timing is inherently platform-clock-bound;
// the library's own bounded-poll matcher is the correct primitive for it.
//
// FINDING #1 (primary/blocking): OnboardingOverlay.tsx's content box is
// hardcoded to `width={150}` columns (absolute, not a percentage/min-width
// clamp). The outer wrapper is `position="absolute" ... alignItems="center"
// justifyContent="center"`, so centering a 150-col child inside a narrower
// parent pushes it off both edges — nothing inside is ever paintable.
// Confirmed via real PTY runs: at columns:220 (the width
// onboarding-overlay.test.tsx's bun:test harness deliberately uses)
// "Welcome to Ei!" renders in <1s; at columns:100 (this repo's OWN e2e
// convention — every other file in tui/tests/e2e/ uses `columns: 100`) it
// never renders even after a real 25s wait (manual buffer dump showed a
// fully blank screen). Real-world impact: most terminal windows are
// narrower than 150 columns, so the fresh-install wizard — the single most
// basic scenario in this whole plan — is silently INVISIBLE on first boot
// for the majority of real users.
//
// FINDING #2 (independent of #1): even at an adequate width, pressing
// Escape at the Welcome step no longer returns to the normal "Ready" app
// state. OnboardingOverlay's Welcome step treats ANY key (Escape included)
// as "advance to Install" — there is no affordance to exit the wizard
// entirely before reaching Done, unlike the deleted WelcomeOverlay's
// dismiss-on-any-key contract.
//
// Combined, these TWO regressions break two PRE-EXISTING tests in
// provider-command.test.ts ("/provider with empty accounts opens provider
// editor (no-op editor shows 'No content')" and its editor-creates-one
// sibling) — confirmed via a clean `main`-branch worktree run (10/10 pass)
// vs this branch (fails). Captured in a dedicated file rather than edited
// into provider-command.test.ts because that file is plan-scope this task's
// brief says not to touch, and this file's purpose is documenting the
// regression for the fix, not being the permanent test for it.
import { test, expect } from "@microsoft/tui-test";
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { BUN_PATH } from "./fixtures.js";

function freshNoAccountsDataPath(label: string): string {
  const dataPath = `/tmp/ei-final-qa-width-${label}-${process.pid}-${Date.now()}`;
  rmSync(dataPath, { recursive: true, force: true });
  mkdirSync(dataPath, { recursive: true });
  const timestamp = new Date().toISOString();
  writeFileSync(
    join(dataPath, "state.json"),
    JSON.stringify({
      version: 1,
      timestamp,
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        quotes: [],
        last_updated: timestamp,
        settings: { auto_save_interval_ms: 999999999 },
      },
      personas: {},
      queue: [],
    })
  );
  return dataPath;
}

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  rows: 30,
  // 100 columns: this repo's OWN e2e convention — every other e2e file in
  // this directory (provider-command.test.ts, basic-commands.test.ts,
  // etc.) uses this exact width.
  columns: 100,
  env: {
    EI_DATA_PATH: freshNoAccountsDataPath("narrow"),
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
    EI_E2E_MODE: "1",
  },
});

test("REGRESSION #1 — the fresh-install wizard's Welcome step becomes visible at 100 columns", async ({ terminal }) => {
  // Same timeout value provider-command.test.ts's own (now-broken) "empty
  // accounts" tests already use for this exact assertion.
  await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 5000 });
});

test.use({
  program: { file: BUN_PATH, args: ["run", "dev"] },
  rows: 34,
  // Wide enough that REGRESSION #1 is not a factor here — isolates this
  // as a SEPARATE regression from the layout-width one.
  columns: 220,
  env: {
    EI_DATA_PATH: freshNoAccountsDataPath("wide-escape"),
    PATH: process.env.PATH!,
    HOME: process.env.HOME!,
    TERM: "xterm-256color",
    EDITOR: "true",
    EI_E2E_MODE: "1",
  },
});

test("REGRESSION #2 — pressing Escape at the Welcome step returns to the normal 'Ready' app state", async ({ terminal }) => {
  await expect(terminal.getByText("Welcome to Ei!")).toBeVisible({ timeout: 15000 });
  terminal.keyEscape();
  // provider-command.test.ts's pre-existing "empty accounts" tests assume
  // this exact contract (Escape -> "Ready"), carried over from the
  // deleted WelcomeOverlay's dismiss-on-any-key behavior.
  await expect(terminal.getByText("Ready")).toBeVisible({ timeout: 5000 });
});
