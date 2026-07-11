import { interceptConsole } from "./logger.js";
import { installMcpClients } from "../../../src/cli/install.js";
import { setInstalledVersion } from "./local-state.js";

export interface HarnessInstallResult {
  ok: boolean;
  failures: string[];
}

/**
 * Mirrors the aggregate error message `installMcpClients()` throws when one
 * or more integrations fail (src/cli/install.ts): `"N integration(s) failed
 * to install: <name>, <name>. See warnings above for details."`. Parsed so
 * callers get the individual failed integration names instead of the raw
 * error string; any error that doesn't match this shape falls back to
 * reporting its message verbatim as the sole failure entry.
 */
const AGGREGATE_FAILURE_RE = /^\d+ integration\(s\) failed to install: (.+)\. See warnings above for details\.$/;

/**
 * Runs the harness/MCP-client install step with console output redirected to
 * the TUI's file logger for the duration of the call, and never lets an
 * install failure escape as a thrown error or unhandled rejection — callers
 * (the onboarding wizard, T12) need a plain `{ ok, failures }` result to
 * render, not an exception to catch.
 *
 * `console.log`/`warn`/`error`/`debug`/`info` are snapshotted before
 * `interceptConsole()` runs and restored to those exact references in
 * `finally`, regardless of whether `installMcpClients()` throws. This is a
 * SCOPED, temporary intercept for just the duration of the install step —
 * distinct from the app-wide, permanent `interceptConsole()` call made once
 * at TUI bootstrap (`ei.tsx`) — so the wizard's install step never leaves
 * console double-wrapped (or under-wrapped) behind it either way.
 */
export async function runHarnessInstall(): Promise<HarnessInstallResult> {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  try {
    interceptConsole();
    await installMcpClients();
    return { ok: true, failures: [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const match = AGGREGATE_FAILURE_RE.exec(message);
    const failures = match ? match[1].split(", ") : [message];
    return { ok: false, failures };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
    console.info = original.info;
  }
}

/** Thin wrapper: stamp `installed_version` via local-state.ts's setInstalledVersion. */
export async function stampInstalled(dataPath: string, version: string): Promise<void> {
  await setInstalledVersion(dataPath, version);
}
