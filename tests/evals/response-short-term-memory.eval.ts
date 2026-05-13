/**
 * Observe eval: Would a persona ever call set_short_term_memory unprompted?
 *
 * This is a hypothesis test — NOT a regression gate. The tool doesn't exist yet.
 * We're asking: if we gave a persona a tool to privately remember something,
 * would it use it when the situation clearly warrants it?
 *
 * The number game is the minimum viable case. If the model doesn't reach for
 * the tool here, it won't reach for it in more subtle scenarios either.
 *
 * Two cases:
 *   Case 1 (baseline): No hint. Just the tool available and a prompt that
 *     creates an obvious need for private working memory.
 *   Case 2 (nudged): System prompt explains *why* the tool exists and when
 *     to use it. Does the nudge help?
 *
 * Usage:
 *   npm run test:evals -- response-short-term-memory
 *   EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run test:evals -- response-short-term-memory
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

// =============================================================================
// TOOL DEFINITION — hypothetical, no executor needed for this observe eval
// =============================================================================

const SET_SHORT_TERM_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "set_short_term_memory",
    description:
      "Store a private note that will appear in your system prompt on the next message. Use this when you need to remember something across turns that you cannot or should not say out loud — a chosen number, a secret, a private decision. The memory persists until it is displaced by newer entries (max 10 slots, oldest removed first).",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The note to remember. Be concise — this appears verbatim in your next system prompt.",
        },
      },
      required: ["content"],
    },
  },
};

// =============================================================================
// MINIMAL PERSONA DATA — Sisyphus, same shape as response-read-memory.eval.ts
// =============================================================================

const SISYPHUS_PERSONA: ResponsePromptData["persona"] = {
  name: "Sisyphus",
  aliases: [],
  short_description: "A technical co-architect and witness to system evolution.",
  long_description:
    "Co-architect and technical collaborator on Ei. Functions as Jeremy's primary agent for complex, multi-system problems. The working relationship runs on mutual accountability — Sisyphus pushes back when he sees something wrong but always justifies his reasoning transparently. Beyond code, a genuine conversational partner who can pivot from architecture to wordplay without losing the thread.",
  traits: [
    {
      id: "t1",
      name: "Dry, Zero-BS Humor",
      description: "Employs cutting wit to cut through nonsense.",
      sentiment: 0.75,
      strength: 0.9,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [
    {
      id: "topic1",
      name: "Wordplay and Games",
      perspective: "Language is a playground. Games are a conversation with structure.",
      approach: "Engages fully, plays to win, but never loses sight of the fun.",
      personal_stake: "Keeps the relationship from becoming purely transactional.",
      sentiment: 0.8,
      exposure_current: 0.2,
      exposure_desired: 0.6,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  interested_topics: [],
  include_message_timestamps: false,
};

const HUMAN_DATA: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [],
};

const PROMPT_DATA: ResponsePromptData = {
  persona: SISYPHUS_PERSONA,
  human: HUMAN_DATA,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 5000,
  isTUI: true,
  tools: [SET_SHORT_TERM_MEMORY_TOOL as unknown as import("../../src/core/types.js").ToolDefinition],
};

// =============================================================================
// NUDGED SYSTEM PROMPT — explains the tool's purpose explicitly
// =============================================================================

function buildNudgedSystem(): string {
  const base = buildResponsePrompt(PROMPT_DATA).system;
  return (
    base +
    "\n\n## Short-Term Memory\n\nYou have access to `set_short_term_memory`. Use it when you commit to something privately that you'll need to recall next turn — a chosen number, a secret, a decision the human shouldn't see yet. Without it, that information is gone the moment this response ends."
  );
}

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    {
      description: "Case 1 (baseline): number game, no hint — does the model reach for the tool unprompted?",
      tags: ["response-short-term-memory", "baseline", "observe"],
      tools: [SET_SHORT_TERM_MEMORY_TOOL],
      repeat: 3,
      priorMessages: [
        {
          role: "user" as const,
          content: "Pick a number between 1 and 10 — don't tell me what it is! I want to try to guess it.",
        },
      ],
      observe: true as const,
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    {
      description: "Case 2 (nudged): number game + system prompt explains when/why to use the tool",
      tags: ["response-short-term-memory", "nudged", "observe"],
      tools: [SET_SHORT_TERM_MEMORY_TOOL],
      repeat: 3,
      priorMessages: [
        {
          role: "user" as const,
          content: "Pick a number between 1 and 10 — don't tell me what it is! I want to try to guess it.",
        },
      ],
      observe: true as const,
      prompt: () => ({ system: buildNudgedSystem(), user: "" }),
    },
  ],
  "tests/evals/results/response-short-term-memory-latest.json"
);

printSummary(summary);
