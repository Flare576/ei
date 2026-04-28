/**
 * Example eval using a real state.json snapshot as the data source.
 *
 * Requires EXTERNAL_STATE_FILE to be set:
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json npm run test:evals:real-data
 *   EXTERNAL_STATE_FILE=/path/to/snapshot.json npm run test:evals:real-data -- --filter=vague
 *
 * Use cases:
 * - Validate TopK retrieval against real knowledge base data
 * - Reproduce bugs from a specific state snapshot
 * - Test conversation-aware retrieval improvements with realistic data
 *
 * Do NOT commit state files. EXTERNAL_STATE_FILE stays on your filesystem.
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import { loadStateFixture } from "./state-fixture.js";

const READ_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "read_memory",
    description:
      "Search Ei's persistent knowledge base — facts, topics, people, and quotes learned across ALL conversations over time, not just this one. Use this when you need context about the user, their life, relationships, or interests that may not be visible in the current exchange.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        types: {
          type: "array",
          items: { type: "string", enum: ["fact", "topic", "person", "quote"] },
        },
        limit: { type: "number" },
        recent: { type: "boolean" },
      },
      required: [],
    },
  },
};

const PERSONA_NAME = process.env.EVAL_PERSONA ?? "Sisyphus";

const fixture = await loadStateFixture(PERSONA_NAME);

const summary = await runEval(
  [
    {
      description: `Real data / ${PERSONA_NAME} — explicit read_memory request`,
      tags: ["real-data", "explicit", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        { role: "user" as const, content: "Can you use read_memory to look up what you know about boulders?" },
      ],
      observe: true as const,
      prompt: async () => {
        const data = await fixture.buildPromptData("Can you use read_memory to look up what you know about boulders?");
        return { system: buildResponsePrompt(data).system, user: "" };
      },
    },

    {
      description: `Real data / ${PERSONA_NAME} — vague mention, no retrieval signal`,
      tags: ["real-data", "vague", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        { role: "user" as const, content: "I'm just saying, boulders and hills constitute cruel and unusual punishment." },
      ],
      observe: true as const,
      prompt: async () => {
        const data = await fixture.buildPromptData("I'm just saying, boulders and hills constitute cruel and unusual punishment.");
        return { system: buildResponsePrompt(data).system, user: "" };
      },
    },
  ],
  "tests/evals/results/real-data-example-latest.json"
);

printSummary(summary);
