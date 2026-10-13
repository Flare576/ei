import { existsSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

/**
 * Points EI_DATA_PATH at an empty throwaway directory and returns its cleanup.
 *
 * Several tests rely on module mocks to keep a real write path (e.g.
 * createPersonaEntity, createEntity) from running. When a mock fails to
 * intercept (e.g. under Bun's `node` shim, see AGENTS.md), the real code
 * resolves its data directory from EI_DATA_PATH and, with the developer's value
 * inherited from their shell, writes straight into their live state.json. With
 * an empty directory that failure mode is a loud "No saved state found" instead
 * of silent data pollution. Tests that need a populated data dir still set
 * their own EI_DATA_PATH.
 *
 * The embedding model cache lives under `<data dir>/embeddings` and is not user
 * data; a few tests load the real model, so it is symlinked in rather than
 * re-downloaded into the empty directory.
 *
 * Shared by every test tier's setup file (vitest root, vitest tui, bun:test) so
 * the policy cannot drift between them.
 */
export function isolateDataPath(): () => void {
  const realDataPath = process.env.EI_DATA_PATH ?? join(homedir(), ".local", "share", "ei");
  const dir = mkdtempSync(join(tmpdir(), "ei-test-data-"));

  const realEmbeddings = join(realDataPath, "embeddings");
  if (existsSync(realEmbeddings)) {
    symlinkSync(realEmbeddings, join(dir, "embeddings"), "dir");
  }

  process.env.EI_DATA_PATH = dir;

  // rmSync removes the embeddings symlink itself, never its target.
  return () => rmSync(dir, { recursive: true, force: true });
}
