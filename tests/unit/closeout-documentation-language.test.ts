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
  it("src/README.md describes native-tool/live-conversation identity edits and ei update persona, and drops the retired persona-side critic pass", () => {
    const contents = readNormalized(join(REPO_ROOT, "src", "README.md"));

    // Current mechanism: native identity tools during a live conversation.
    expect(contents).toMatch(/get_my_identity/);
    expect(contents).toMatch(/edit_trait/);
    expect(contents).toMatch(/edit_topic/);
    expect(contents).toMatch(/update_description/);
    expect(contents).toMatch(/during a live conversation/);

    // Current mechanism: CLI/MCP identity edits via `ei update persona`.
    expect(contents).toMatch(/`ei update persona`/);

    // Retired: the fire-and-forget persona-side critic pass this replaced.
    expect(contents).not.toMatch(
      /Reflection\*\* \(fire-and-forget alongside Phase 4\): Persona-side critic pass on person records\./,
    );
  });

  it("CONTRACTS.md points the enumerate-all link guidance at the current Observation->Signal consumer, not the retired reflection critic", () => {
    const contents = readNormalized(join(REPO_ROOT, "CONTRACTS.md"));

    // Current consumer: resolvePersonaLinkedPeople, enumerate-all guidance.
    expect(contents).toMatch(/resolvePersonaLinkedPeople/);
    expect(contents).toMatch(
      /Observation.Signal ingestion pipeline that reads a persona's linked PersonLog is the current consumer this guards\./,
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
