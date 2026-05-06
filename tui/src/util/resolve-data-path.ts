import { join } from "node:path";

export function resolveDataPath(override?: string): string {
  const raw = override ?? Bun.env.EI_DATA_PATH ??
    join(Bun.env.XDG_DATA_HOME ?? join(Bun.env.HOME ?? "~", ".local", "share"), "ei");
  return raw.replace(/\/+$/, "");
}
