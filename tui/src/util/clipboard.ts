import { platform } from "os";

/**
 * Write OSC 52 escape sequence to stdout.
 * Works in terminals that support it (Kitty, Alacritty, etc.).
 * Apple Terminal.app does NOT support OSC 52 — use copyNative() for macOS.
 */
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return;
  const base64 = Buffer.from(text).toString("base64");
  const osc52 = `\x1b]52;c;${base64}\x07`;
  const inTmux = process.env["TMUX"] || process.env["STY"];
  const sequence = inTmux ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52;
  process.stdout.write(sequence);
}

/**
 * Copy text to clipboard using the best available native method.
 * Mirrors OpenCode's clipboard.ts approach.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Always attempt OSC 52 (works over SSH, in supported terminals)
  writeOsc52(text);

  const os = platform();

  if (os === "darwin") {
    // osascript is the reliable path on macOS (works in Apple Terminal + tmux)
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const proc = Bun.spawn(
      ["osascript", "-e", `set the clipboard to "${escaped}"`],
      { stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited.catch(() => {});
    return;
  }

  if (os === "linux") {
    if (process.env["WAYLAND_DISPLAY"] && Bun.which("wl-copy")) {
      const proc = Bun.spawn(["wl-copy"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited.catch(() => {});
      return;
    }
    if (Bun.which("xclip")) {
      const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited.catch(() => {});
      return;
    }
    if (Bun.which("xsel")) {
      const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited.catch(() => {});
      return;
    }
  }
}
