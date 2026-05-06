/**
 * Resolves the Ei data directory path using the same precedence everywhere:
 *   1. EI_DATA_PATH env var (explicit override)
 *   2. $XDG_DATA_HOME/ei
 *   3. ~/.local/share/ei
 *
 * Cross-env: works in Bun, Node, and browser (browser will always return null
 * since no filesystem env is available, which is the correct behaviour there).
 *
 * Trailing slashes are stripped so callers can safely do `path.join(dataPath, "logs")`.
 */
export function resolveDataPath(): string | null {
  const env: Record<string, string | undefined> =
    (typeof Bun !== "undefined" && (Bun as { env?: Record<string, string> }).env) ||
    (typeof process !== "undefined" && process.env) ||
    {};

  const raw = env.EI_DATA_PATH ||
    (() => {
      const xdg = env.XDG_DATA_HOME ||
        (env.HOME ? `${env.HOME}/.local/share` : null);
      return xdg ? `${xdg}/ei` : null;
    })();

  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}
