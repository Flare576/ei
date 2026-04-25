import { buildReflectionCriticPrompt } from "../../src/prompts/reflection/index.js";
import { REFLECTION_CRITIC_OBSERVE_CASES } from "./fixtures.js";
import { runEval, printSummary } from "./runner.js";

const summary = await runEval(
  REFLECTION_CRITIC_OBSERVE_CASES.map((c) => ({
    description: c.description,
    tags: [...c.tags],
    prompt: () => buildReflectionCriticPrompt(c.input),
    observe: true as const,
  })),
  "tests/evals/results/reflection-critic-observe-latest.json"
);

printSummary(summary);
