import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { resolveShellProfile, writeShellExport } from "../../../src/util/shell-profile";

describe("resolveShellProfile", () => {
  const home = "/home/testuser";

  it("resolves zsh to ~/.zshrc", () => {
    const result = resolveShellProfile({ env: { SHELL: "/bin/zsh" }, home });
    expect(result).toEqual({ path: join(home, ".zshrc"), shell: "zsh" });
  });

  it("resolves bash to ~/.bash_profile on macOS (no /etc/os-release)", () => {
    const result = resolveShellProfile({ env: { SHELL: "/bin/bash" }, home, hasOsRelease: false });
    expect(result).toEqual({ path: join(home, ".bash_profile"), shell: "bash" });
  });

  it("resolves bash to ~/.bashrc on Linux (/etc/os-release present)", () => {
    const result = resolveShellProfile({ env: { SHELL: "/bin/bash" }, home, hasOsRelease: true });
    expect(result).toEqual({ path: join(home, ".bashrc"), shell: "bash" });
  });

  it("resolves fish to ~/.config/fish/config.fish", () => {
    const result = resolveShellProfile({ env: { SHELL: "/usr/local/bin/fish" }, home });
    expect(result).toEqual({ path: join(home, ".config", "fish", "config.fish"), shell: "fish" });
  });

  it("returns null for an unrecognized shell", () => {
    const result = resolveShellProfile({ env: { SHELL: "/bin/tcsh" }, home });
    expect(result).toBeNull();
  });

  it("returns null when $SHELL is unset", () => {
    const result = resolveShellProfile({ env: {}, home });
    expect(result).toBeNull();
  });
});

describe("writeShellExport", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await mkdtemp(join(tmpdir(), "ei-shell-profile-test-"));
  });

  afterEach(async () => {
    await rm(dataPath, { recursive: true, force: true });
  });

  it("returns unknown_shell for an unrecognized $SHELL", async () => {
    const result = await writeShellExport("EI_FOO", "bar", { env: { SHELL: "/bin/tcsh" }, home: dataPath });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("unknown_shell");
      expect(result.message).toContain("tcsh");
    }
  });

  it("writes a new export line into a fresh profile", async () => {
    const result = await writeShellExport("EI_FOO", "bar", {
      env: { SHELL: "/bin/zsh" },
      home: dataPath,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.path).toBe(join(dataPath, ".zshrc"));

    const content = await Bun.file(result.path).text();
    const matches = content.split("\n").filter((l) => l.startsWith("export EI_FOO="));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('export EI_FOO="bar"');
  });

  it("is idempotent: calling twice with the same key/value leaves exactly one export line", async () => {
    const opts = { env: { SHELL: "/bin/zsh" }, home: dataPath };
    const first = await writeShellExport("EI_FOO", "bar", opts);
    const second = await writeShellExport("EI_FOO", "bar", opts);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const profilePath = join(dataPath, ".zshrc");
    const content = await Bun.file(profilePath).text();
    const matches = content.split("\n").filter((l) => l.startsWith("export EI_FOO="));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('export EI_FOO="bar"');
  });

  it("replaces the value in place on a second call with a different value (no duplicate line)", async () => {
    const opts = { env: { SHELL: "/bin/zsh" }, home: dataPath };
    await writeShellExport("EI_FOO", "bar", opts);
    await writeShellExport("EI_FOO", "baz", opts);

    const profilePath = join(dataPath, ".zshrc");
    const content = await Bun.file(profilePath).text();
    const matches = content.split("\n").filter((l) => l.startsWith("export EI_FOO="));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe('export EI_FOO="baz"');
  });

  it("preserves unrelated existing lines in the profile", async () => {
    const profilePath = join(dataPath, ".zshrc");
    await Bun.write(profilePath, 'export OTHER_VAR="keep-me"\nalias ll="ls -la"\n');

    await writeShellExport("EI_FOO", "bar", { env: { SHELL: "/bin/zsh" }, home: dataPath });

    const content = await Bun.file(profilePath).text();
    expect(content).toContain('export OTHER_VAR="keep-me"');
    expect(content).toContain('alias ll="ls -la"');
    expect(content).toContain('export EI_FOO="bar"');
  });

  it("surfaces write_error with a message when the profile path is unwritable", async () => {
    // Point the "profile" at a path that is itself a directory — writing to it
    // (and reading it as text) fails, forcing the write_error branch.
    const trapDir = join(dataPath, ".zshrc");
    await mkdir(trapDir, { recursive: true });

    const result = await writeShellExport("EI_FOO", "bar", { env: { SHELL: "/bin/zsh" }, home: dataPath });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("write_error");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
