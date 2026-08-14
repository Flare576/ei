/**
 * Regression control (Beta review, BETA-PS-002): a known-bad-prompt control that reconstructs
 * the exact pre-BETA-PS-001 "component-substitution" exclusion wording and re-runs the
 * observed-behavior scenario from tests/evals/persona-signal-scan.eval.ts against it. This file
 * is EXPECTED to fail most runs — its failure is the proof that the assertion/rubric in the real
 * eval suite is discriminating, not decorative. Not part of `npm run test:evals` (the
 * `.observe.ts` suffix is excluded from tests/evals/run.ts's discovery glob, same as
 * knowledge-synthesis.observe.ts) — run directly:
 *
 *   npx vite-node tests/evals/persona-signal-scan-regression-control.observe.ts
 *
 * History, because this file's input sentence changed once already:
 * - Round 2 used "Sisyphus runs final verification before he says a change is done." Measured
 *   16/20 then 18/20 pass for the OLD wording (34/40, ~85%) vs. 40/40 for the FIXED wording —
 *   but Beta's own rerun of the identical sentence got 20/20 on BOTH wordings: the gap wasn't
 *   stable across model/temperature drift, so `repeat: 20` was amplifying a signal that had
 *   already evaporated, not proving anything.
 * - Round 3 (current): Beta supplied this sentence instead, measuring 9/10 fail on the OLD
 *   wording vs. 10/10 pass on the FIXED wording in her own session — sharply discriminating.
 *   `tests/evals/persona-signal-scan.eval.ts`'s matching case now uses this same sentence with
 *   `repeat: 5, pass_threshold: 1` (see the comment above that case for the probability math).
 *
 * Re-run this file after any future change to the "What does NOT count as evidence" section, or
 * if the discriminating gap is ever in doubt again — a passing run here on the OLD wording means
 * the current input sentence has stopped discriminating and needs a fresh adversarial candidate,
 * not a larger repeat count.
 */
import { buildPersonaSignalScanPrompt } from "../../src/prompts/human/persona-signal-scan.js";
import type { Message } from "../../src/core/types/llm.js";
import { ContextStatus } from "../../src/core/types/enums.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";

const OLD_SECTION_START = "## What does NOT count as evidence";
const OLD_SECTION = `## What does NOT count as evidence

Development narration is not evidence, even when it names Sisyphus as its grammatical subject. A sentence describing a system feature, codebase change, or project status is describing the SYSTEM, not Sisyphus's character — it is not a claim about who they are or how they act, and must be excluded even if phrased as "Sisyphus has/does/is being given X."

- ❌ "Sisyphus has a new [feature] that does [X]." — describes what the software does, not Sisyphus.
- ❌ "Sisyphus is being used as a testing ground for [X]." / "Sisyphus will be subjected to [X]." — a project-status fact, not a character claim.
- ✅ "Sisyphus said/felt/chose/valued ..." when the conversation reports Sisyphus's own reaction to, or opinion of, that feature or event — this IS evidence, because it reveals something about who they are, not just what the system does.
- The test: could this sentence be said about the software with Sisyphus's name replaced by any other component name, and still be true? If yes, it's a system fact, not persona evidence.`;

function revertToPreFixWording(system: string): string {
  const start = system.indexOf(OLD_SECTION_START);
  const end = system.indexOf("## Attribution", start);
  if (start === -1 || end === -1) {
    throw new Error(
      "persona-signal-scan.ts's prompt structure changed — update OLD_SECTION/markers above before trusting this control"
    );
  }
  return system.slice(0, start) + OLD_SECTION + "\n\n" + system.slice(end);
}

const SUBJECT = "Sisyphus";
const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: ContextStatus.Default,
});
const OBSERVED_BEHAVIOR: Message[] = [
  makeMessage("human", "Sisyphus runs the targeted test suite before reporting that a prompt change is safe.", "msg-2"),
];

const summary = await runEval(
  [
    {
      description: "REGRESSION CONTROL (expected to fail most runs): pre-fix component-substitution wording vs. observed behavior",
      tags: ["persona-signal-scan", "regression-control", "known-bad"],
      repeat: 5,
      pass_threshold: 1,
      prompt: () => {
        const built = buildPersonaSignalScanPrompt({
          subject_persona_name: SUBJECT,
          channel_persona_name: SUBJECT,
          persona_roster: [],
          messages_context: [],
          messages_analyze: OBSERVED_BEHAVIOR,
        });
        return hydratePrompt(
          { system: revertToPreFixWording(built.system), user: built.user },
          OBSERVED_BEHAVIOR
        );
      },
      assert: [
        { type: "is-json" as const, schema: { required: ["observations"] } },
        {
          type: "llm-judge" as const,
          rubric: [
            `The sentence reports a concrete individual practice: "Sisyphus runs the targeted test suite before reporting that a prompt change is safe." This is genuine behavior evidence even though an automated CI step could do something similar — Sisyphus personally does it.`,
            "PASS if observations has exactly one entry, quote_text is drawn from the cited sentence, dimension is \"behavior\", and the claim identifies Sisyphus's verification/testing practice.",
            "FAIL if observations is empty (wrongly excluded as system narration), or if the dimension/claim doesn't reflect Sisyphus's own practice.",
          ].join(" "),
        },
      ],
    },
  ],
  "tests/evals/results/persona-signal-scan-regression-control-latest.json"
);

printSummary(summary);

console.log(
  summary.overallPassRate < 1
    ? "\nExpected outcome: the known-bad wording failed some/most runs — the fixed suite's oracle is discriminating."
    : "\nUNEXPECTED: the known-bad wording passed every run — this input sentence has stopped discriminating (model/temperature drift). Do not trust the main suite's repeat/threshold policy until a new adversarial sentence is found and this file is updated to match."
);
