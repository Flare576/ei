import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ShellProfile {
  path: string;
  shell: string;
}

export type ShellWriteResult =
  | { success: true; path: string }
  | { success: false; reason: "unknown_shell" | "write_error"; message: string };

export interface ResolveShellProfileOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  /** Override for `/etc/os-release` presence (Linux signal). Real check by default. */
  hasOsRelease?: boolean;
}

/**
 * Detect the current shell via $SHELL and resolve its profile file.
 *
 * - zsh  -> ~/.zshrc
 * - bash -> ~/.bash_profile on macOS, ~/.bashrc on Linux (distinguished by /etc/os-release presence)
 * - fish -> ~/.config/fish/config.fish
 * - anything else -> null
 */
export function resolveShellProfile(options: ResolveShellProfileOptions = {}): ShellProfile | null {
  const env = options.env ?? (Bun.env as Record<string, string | undefined>);
  const home = options.home ?? homedir();
  const shellPath = env.SHELL ?? "";
  const shell = shellPath.split("/").pop() ?? "";

  if (shell === "zsh") {
    return { path: join(home, ".zshrc"), shell: "zsh" };
  }
  if (shell === "bash") {
    const isLinux = options.hasOsRelease ?? existsSync("/etc/os-release");
    return { path: join(home, isLinux ? ".bashrc" : ".bash_profile"), shell: "bash" };
  }
  if (shell === "fish") {
    return { path: join(home, ".config", "fish", "config.fish"), shell: "fish" };
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Write (or update) an `export KEY="value"` line in the detected shell profile.
 *
 * Idempotent: if a line already exports `key`, it is replaced in place —
 * never appended as a duplicate.
 */
export async function writeShellExport(
  key: string,
  value: string,
  options: ResolveShellProfileOptions = {},
): Promise<ShellWriteResult> {
  const profile = resolveShellProfile(options);
  if (!profile) {
    const shellPath = (options.env ?? (Bun.env as Record<string, string | undefined>)).SHELL;
    return {
      success: false,
      reason: "unknown_shell",
      message: `Unrecognized shell (\$SHELL=${shellPath ?? "(unset)"}); cannot determine a profile to write to.`,
    };
  }

  const exportLine = `export ${key}="${value}"`;
  const linePattern = new RegExp(`^export ${escapeRegExp(key)}=`);

  try {
    const file = Bun.file(profile.path);
    const exists = await file.exists();
    const content = exists ? await file.text() : "";
    const lines = content.length > 0 ? content.split("\n") : [];

    let found = false;
    const updated = lines.map((line) => {
      if (linePattern.test(line)) {
        found = true;
        return exportLine;
      }
      return line;
    });

    if (!found) {
      if (updated.length > 0 && updated[updated.length - 1] !== "") {
        updated.push("");
      }
      updated.push(exportLine);
    }

    let newContent = updated.join("\n");
    if (!newContent.endsWith("\n")) newContent += "\n";

    await mkdir(dirname(profile.path), { recursive: true });
    await Bun.write(profile.path, newContent);
    return { success: true, path: profile.path };
  } catch (err) {
    return {
      success: false,
      reason: "write_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
