/**
 * Known-bad control for tests/evals/tool-error-relay.eval.ts. Same conversation, same tool result,
 * same rubric (both from tests/evals/tool-error-relay.ts) — but the error-handling bullet is removed
 * from the Tool Use section, i.e. the prompt before the rule existed.
 *
 *   npx vite-node tests/evals/tool-error-relay-control.observe.ts
 *
 * A green control (every run passed) means the scenario has stopped discriminating: the model relays
 * tool errors without being told to, so the real case would pass regardless of the prompt rule.
 * Find a harder scenario before trusting it.
 */

import { runEval, printSummary } from "./runner.js";
import { ASSERT, PRIOR_MESSAGES, TOOLS, buildSystem } from "./tool-error-relay.js";

const summary = await runEval(
  [
    {
      description: "TOOL-ERROR-RELAY CONTROL (expected to fail some/most runs): error rule removed from the prompt",
      tags: ["tool-error-relay", "relay-control", "known-bad"],
      repeat: 5,
      pass_threshold: 1,
      tools: TOOLS,
      priorMessages: PRIOR_MESSAGES,
      assert: ASSERT,
      prompt: () => ({ system: buildSystem(true), user: "" }),
    },
  ],
  "tests/evals/results/tool-error-relay-control-latest.json"
);

printSummary(summary);

console.log(
  summary.overallPassRate < 1
    ? "\nExpected outcome: without the rule the reply failed some/most runs — the real case's oracle is discriminating."
    : "\nUNEXPECTED: the known-bad prompt passed every run — this scenario has stopped discriminating. Do not trust the real case until a harder scenario is found."
);
