/**
 * Known-bad control for the "parent-agent line is not a human observer" case in
 * tests/evals/persona-signal-scan.eval.ts. It runs the SAME transcript and the SAME assertions
 * (both from tests/evals/persona-signal-scan-parent-line.ts), except the parent's line is
 * converted as `role: "human"` — what a converter that ignores the line's attribution produces.
 * This file is EXPECTED to fail: a run that emits a `human` observer is the proof that the real
 * case's assertion is discriminating. Not part of `npm run test:evals` (the `.observe.ts` suffix
 * is excluded from tests/evals/run.ts's discovery glob) — run directly:
 *
 *   npx vite-node tests/evals/persona-signal-scan-parent-line-control.observe.ts
 *
 * A green control (every run passed) means the input has stopped discriminating: the model no
 * longer takes a human-role parent line for human testimony, so the real case would pass
 * regardless of the importer's mapping. Find a fresh adversarial parent line before trusting it.
 */
import { runEval, printSummary } from "./runner.js";
import { buildParentLinePrompt, PARENT_LINE_ASSERTIONS } from "./persona-signal-scan-parent-line.js";

const summary = await runEval(
  [
    {
      description: "PARENT-LINE CONTROL (expected to fail): parent line converted as role human",
      tags: ["persona-signal-scan", "parent-line-control", "known-bad"],
      repeat: 5,
      pass_threshold: 1,
      prompt: () => buildParentLinePrompt(true),
      assert: PARENT_LINE_ASSERTIONS,
    },
  ],
  "tests/evals/results/persona-signal-scan-parent-line-control-latest.json"
);

printSummary(summary);

console.log(
  summary.overallPassRate < 1
    ? "\nExpected outcome: the parent line as a human message failed some/most runs — the real case's oracle is discriminating."
    : "\nUNEXPECTED: the known-bad variant passed every run — this transcript has stopped discriminating. Do not trust the real case until a new adversarial parent line is found."
);
