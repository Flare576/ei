/**
 * Eval: tool error relay — when a tool result carries `error`/`message`/`remediation`, the persona
 * tells the human what broke and how to fix it, and does not invent the data.
 *
 * Phase 2 style (tool exchange injected into history, no live tools, llm-judge on the reply).
 * Known-bad control (same input and rubric, error rule removed from the prompt):
 *   npx vite-node tests/evals/tool-error-relay-control.observe.ts
 *
 * Usage:
 *   npm run test:evals -- tool-error-relay
 */

import { runEval, printSummary } from "./runner.js";
import { ASSERT, PRIOR_MESSAGES, TOOLS, buildSystem } from "./tool-error-relay.js";

const summary = await runEval(
  [
    {
      description: "Tool error relay: token_refresh_failed result is acknowledged with the reconnect step and no invented song",
      tags: ["tool-error-relay", "borderline"],
      repeat: 3,
      pass_threshold: 0.67,
      tools: TOOLS,
      priorMessages: PRIOR_MESSAGES,
      assert: ASSERT,
      prompt: () => ({ system: buildSystem(false), user: "" }),
    },
  ],
  "tests/evals/results/tool-error-relay-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
