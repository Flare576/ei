import { buildReflectionCriticPrompt } from "../../src/prompts/reflection/index.js";
import { REFLECTION_CRITIC_CASES } from "./fixtures.js";
import { runEval, printSummary } from "./runner.js";

const summary = await runEval(
  REFLECTION_CRITIC_CASES.map((c) => ({
    description: c.description,
    tags: [...c.tags],
    prompt: () => buildReflectionCriticPrompt(c.input),
    assert: [
      {
        type: "is-json" as const,
        schema: {
          required: ["critique", "updated_identity"],
          properties: {
            updated_identity: {
              required: ["long_description", "short_description", "traits", "topics"],
            },
          },
        },
      },
      {
        type: "llm-judge" as const,
        rubric: [
          "The 'critique' field is prose (2-4 sentences), not bullet points.",
          "The 'updated_identity' reflects the person_log — no invented claims.",
          "Traits/topics the log confirms are preserved, not removed.",
          "All numeric fields (strength, sentiment, exposure_current, exposure_desired) are between -1.0 and 1.0.",
        ].join(" "),
      },
    ],
  })),
  "tests/evals/results/reflection-critic-latest.json"
);

printSummary(summary);

if (summary.passRate < 1) process.exit(1);
