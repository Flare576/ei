import { installMcpClients } from "./install.js";
import { getDataPath } from "./retrieval.js";
import { setInstalledVersion } from "./local-state.js";

/**
 * `ei --install`: run the installer, then record `version` as
 * `installed_version` in `local.json` so the TUI's upgrade prompt knows this
 * machine's hooks/skills are current.
 *
 * Stamps only when `installMcpClients()` completes without throwing — its
 * aggregate failure error propagates unchanged and leaves any existing
 * (stale) stamp, or the absence of one, untouched so the TUI re-prompts.
 */
export async function installAndStamp(version: string): Promise<void> {
  await installMcpClients();
  await setInstalledVersion(getDataPath(), version);
}
