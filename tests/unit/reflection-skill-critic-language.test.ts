import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Bolt 002 R7/AT7 (D4, Beta's review [I2]): ADR-038 deleted the automatic
// Reflection Critic and this Bolt's own D1 removed the field
// (`external_reflection_only`) it read. No ACTIVE instruction in the
// `ei-manage-signals` skill (retired and replaced its now-deleted
// predecessor skill per ADR-039 item 10 / signal-ux Bolt 006) or the
// shipped CLI docs may attribute current behavior to that deleted
// critic/ceremony — Beta's original review found two live violations in
// the predecessor skill's own root dispatcher and CLI reference file: both
// said Ei's "automatic ceremony... refuses to run reflection" for a
// Persona linked to more than one Person record (true once, when an
// automatic critic existed to refuse on; false now — that stop is this
// skill's own enumeration rule, D4), and `src/cli/README.md`'s
// shipped-skill summary framed manual reflection as a workaround for a
// critic that still runs.
//
// This is a targeted grep for the EXACT present-tense phrasings Beta's
// review quoted as live violations — not a prose test of every
// historical-critic sentence (this Bolt's own Test Plan Skip List calls
// that brittle and tautological). Every read below collapses whitespace
// (`\s+` → one space) before matching, so a multi-word pattern isn't a
// false negative just because Markdown happened to hard-wrap a line in
// the middle of it.
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function listMarkdownFilesRecursively(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listMarkdownFilesRecursively(full));
    } else if (entry.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

/** Present-tense phrasings that describe the deleted automatic critic/ceremony as CURRENTLY running or CURRENTLY gating behavior — R7/AT7's own examples plus the exact strings Beta's review [I2] quoted. */
const ACTIVE_AUTOMATIC_CRITIC_PATTERNS: RegExp[] = [
  /Ei's automatic ceremony/i,
  /automatic (?:reflection )?critic can/i,
  /refuses to run reflection/i,
  /fills faster than Ei's automatic Reflection critic can/i,
];

describe("R7/AT7 (Bolt 002 D4): no active instruction attributes current behavior to the deleted automatic critic/ceremony", () => {
  const targets = [
    ...listMarkdownFilesRecursively(join(REPO_ROOT, "skills", "ei-manage-signals")),
    join(REPO_ROOT, "src", "cli", "README.md"),
  ];

  // Sanity check on the file-discovery helper itself — if this ever comes
  // back empty, every other assertion in this describe block passes
  // vacuously and silently stops meaning anything.
  it("found at least the two ei-manage-signals files and the CLI README Beta's review named", () => {
    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(targets.some((p) => p.endsWith(join("ei-manage-signals", "SKILL.md")))).toBe(true);
    expect(targets.some((p) => p.endsWith(join("ei-manage-signals", "references", "cli.md")))).toBe(true);
    expect(targets.some((p) => p.endsWith(join("src", "cli", "README.md")))).toBe(true);
  });

  it.each(targets)("%s contains none of the deleted critic's present-tense phrasings", (path) => {
    const contents = readFileSync(path, "utf-8").replace(/\s+/g, " ");
    for (const pattern of ACTIVE_AUTOMATIC_CRITIC_PATTERNS) {
      expect(contents).not.toMatch(pattern);
    }
  });

});
