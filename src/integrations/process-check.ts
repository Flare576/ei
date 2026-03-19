const isBrowser = typeof document !== "undefined";

/**
 * Returns true if any process with the given name is currently running.
 * Always returns true in browser environments (process inspection not available).
 * On Windows uses `tasklist`; on macOS/Linux uses `pgrep -x`.
 */
export async function isProcessRunning(processName: string): Promise<boolean> {
  if (isBrowser) return true;
  try {
    const CHILD_PROCESS = "child_process";
    const { execSync } = await import(/* @vite-ignore */ CHILD_PROCESS);
    if (process.platform === "win32") {
      const out = execSync(
        `tasklist /FI "IMAGENAME eq ${processName}.exe" /NH 2>NUL`
      ).toString();
      return out.toLowerCase().includes(`${processName.toLowerCase()}.exe`);
    }
    execSync(`pgrep -x ${processName}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
