import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Signal UX Stint holistic close-out (round 1, Sisyphus A1/Beta A3): three
// shipped docs still described the retired automatic Reflection critic as
// the live mechanism for persona identity edits and link-cardinality
// guidance. That critic and both TUI/Web reflection UIs are retired
// (ADR-039); identity edits now happen via the five native persona tools
// during a live conversation, or via `ei update persona` from CLI/MCP.
// Commit 79265cff replaced all three passages.
//
// This is a targeted content-regression check on the exact corrected
// passages and the exact retired phrasings they replaced — following
// tests/unit/reflection-skill-critic-language.test.ts's approach: stable
// targeted file reads, whitespace collapsed (`\s+` -> one space) before
// matching, so a Markdown hard-wrap doesn't produce a false negative. It
// is not an exhaustive source-text check of either file.
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function readNormalized(path: string): string {
  return readFileSync(path, "utf-8").replace(/\s+/g, " ");
}

describe("Signal UX close-out: docs describe the surviving native-tool/ei update persona mechanism, not the retired reflection critic", () => {
  it("src/README.md distinguishes synchronous native identity-tool writes from `ei update persona`'s safe self-drain or queued correction", () => {
    const contents = readNormalized(join(REPO_ROOT, "src", "README.md"));

    // Native identity tools write through synchronously during a live conversation.
    expect(contents).toMatch(/get_my_identity/);
    expect(contents).toMatch(/edit_trait/);
    expect(contents).toMatch(/edit_topic/);
    expect(contents).toMatch(/update_description/);
    expect(contents).toMatch(/during a live conversation/);
    expect(contents).toMatch(
      /those writes apply immediately and synchronously, with no staging step\./,
    );

    // `ei update persona` self-drains only when safe; a live lock (or backup-only/
    // sync-pending state) queues its correction for the Processor.
    expect(contents).toMatch(/`ei update persona`/);
    expect(contents).toMatch(
      /`writeCorrection` self-\s*drains it straight into `state\.json` within that same call when no live instance holds the lock/,
    );
    expect(contents).toMatch(
      /only appends to `corrections\.json` and returns `drainMode: "queued"`/,
    );

    // Native tools are synchronous; the CLI/MCP correction path is not universally so.
    expect(contents).not.toMatch(/both write immediately/i);

    // Retired: the fire-and-forget persona-side critic pass this replaced.
    expect(contents).not.toMatch(
      /Reflection\*\* \(fire-and-forget alongside Phase 4\): Persona-side critic pass on person records\./,
    );
  });

  it("CONTRACTS.md points enumerate-all guidance at live Observation→Signal resolution of every linked Person record, not a PersonLog", () => {
    const contents = readNormalized(join(REPO_ROOT, "CONTRACTS.md"));

    // Current consumer: enumerate every linked Person record through the dedicated resolver.
    expect(contents).toMatch(/resolvePersonaLinkedPeople/);
    expect(contents).toMatch(/Observation→Signal ingestion pipeline's live branch/);
    expect(contents).toMatch(
      /it enumerates every Person record linked to the subject persona via `resolvePersonaLinkedPeople\(\)`/,
    );

    // False current-consumer claim from the round-1 correction: no PersonLog is read here.
    expect(contents).not.toMatch(
      /Observation→Signal ingestion pipeline that reads a persona's linked PersonLog is the current consumer this guards\./,
    );

    // Retired: the reflection-critic example this replaced.
    expect(contents).not.toMatch(/For the reflection critic, that means clearing the wrong log\./);
  });

  it("src/cli.ts's --json-file docs recommend `ei update persona` especially, not the retired 'persona reflection especially' phrasing", () => {
    const contents = readNormalized(join(REPO_ROOT, "src", "cli.ts"));

    // Current: both --json-file descriptions (JSDoc + CLI help) name
    // `ei update persona` as the flag's motivating sensitive payload. The
    // CLI-help occurrence escapes its backticks (it's inside a template
    // literal); the JSDoc occurrence does not — match both delimiter forms.
    const occurrences = contents.match(/ei update persona\\?` especially/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    // Retired: the unadorned "persona reflection especially" phrasing.
    expect(contents).not.toMatch(/persona reflection especially/);
  });
});
