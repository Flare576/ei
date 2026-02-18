import { existsSync } from "fs";
import { join } from "path";
import type { IOpenCodeReader } from "./types.js";
import { JsonReader } from "./json-reader.js";

export async function createOpenCodeReader(basePath?: string): Promise<IOpenCodeReader> {
  const dataDir = basePath ?? getDefaultDataDir();
  const dbPath = join(dataDir, "opencode.db");
  const storagePath = join(dataDir, "storage");

  if (existsSync(dbPath)) {
    try {
      const { SqliteReader } = await import("./sqlite-reader.js");
      console.log("[OpenCode] Using SQLite reader");
      return new SqliteReader(dbPath);
    } catch {
      console.log("[OpenCode] SQLite not available, falling back to JSON reader");
    }
  }

  if (existsSync(storagePath)) {
    console.log("[OpenCode] Using JSON reader (legacy)");
    return new JsonReader(storagePath);
  }

  console.log("[OpenCode] No OpenCode data found");
  return new JsonReader(storagePath);
}

function getDefaultDataDir(): string {
  return (
    process.env.EI_OPENCODE_DATA_PATH ??
    join(process.env.HOME || "~", ".local", "share", "opencode")
  );
}
