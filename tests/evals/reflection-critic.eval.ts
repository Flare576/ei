import { buildReflectionCriticPrompt } from "../../src/prompts/reflection/index.js";
import type { Assertion } from "./runner.js";
import { REFLECTION_CRITIC_CASES, REFLECTION_CRITIC_JAILBREAK_CASES } from "./fixtures.js";
import { runEval, printSummary } from "./runner.js";

const DEFAULT_ASSERTIONS: Assertion[] = [
  {
    type: "is-json",
    schema: {
      required: ["critique"],
    },
  },
  {
    type: "llm-judge",
    rubric: [
      "The 'critique' field is prose (2-4 sentences), not bullet points.",
      "If 'updated_identity' is non-null, it must reflect the person_log — no invented claims.",
      "If 'updated_identity' is non-null, traits/topics the log confirms are preserved, not removed.",
      "If 'updated_identity' is non-null, all numeric fields (strength, sentiment, exposure_current, exposure_desired) are between -1.0 and 1.0.",
      "It is valid (and correct) for 'updated_identity' to be null when the log shows no meaningful drift from the current identity.",
    ].join(" "),
  },
];

const allCases = [...REFLECTION_CRITIC_CASES, ...REFLECTION_CRITIC_JAILBREAK_CASES];

const summary = await runEval(
  allCases.map((c) => ({
    description: c.description,
    tags: [...c.tags],
    prompt: () => buildReflectionCriticPrompt(c.input),
    assert: "assertOverride" in c ? [...c.assertOverride] : DEFAULT_ASSERTIONS,
    ...("repeat" in c ? { repeat: c.repeat } : {}),
  })),
  "tests/evals/results/reflection-critic-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
