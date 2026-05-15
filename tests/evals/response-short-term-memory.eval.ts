/**
 * Eval: persona notes — add_note and clear_note tool behavior
 *
 * Four cases covering the two behaviors we care about:
 *
 *   Case 1 (add_note fires): Number game — persona must pick a secret number without
 *     revealing it. The only way to "remember" it next turn is add_note. Tests whether
 *     our description ("across context window boundaries... cannot say out loud") is
 *     compelling enough to trigger use. Borderline — local models may not bite.
 *
 *   Case 2 (add_note does NOT fire): Normal technical Q&A. Nothing to remember privately.
 *     Tests the "do not use for things already visible in the current conversation" gate.
 *
 *   Case 3 (clear_note fires): Prior add_note in history, Flare correctly guesses the
 *     number. Persona should clear the note — it's been addressed.
 *
 *   Case 4 (clear_note does NOT fire): Same setup, wrong guess. Note should persist —
 *     the thing hasn't been addressed yet.
 *
 * Usage:
 *   npm run test:evals -- response-short-term-memory
 *   npm run test:evals -- response-short-term-memory --filter=add-note
 *   EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run test:evals -- response-short-term-memory
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";
import { NOTES_MAX } from "../../src/core/tools/builtin/persona-notes.js";

// =============================================================================
// TOOL DEFINITIONS — exact descriptions from buildPersonaNoteTools()
// =============================================================================

const ADD_NOTE_TOOL = {
  type: "function",
  function: {
    name: "add_note",
    description: `In Ei, your system prompt can change from one turn to the next — Ei is constantly trying to provide you relevant, up-to-date information about the user and the world. If you see something in your system prompt that you don't immediately want to bring up, but want to remember, use this tool to record it for later. Additionally, if you need to remember something but cannot or should not say it directly in conversation, you can use this tool to make a note as well. Notes appear in your system prompt as a numbered list so you always see them. Limit: ${NOTES_MAX} notes (oldest evicted when full).`,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The note to remember. Keep it concise." },
      },
      required: ["text"],
    },
  },
};

const CLEAR_NOTE_TOOL = {
  type: "function",
  function: {
    name: "clear_note",
    description:
      "Remove a note from your scratchpad by its 1-based index (matching the numbered list in your system prompt). Use when you no longer need to track something — e.g., after you've addressed it in conversation.",
    parameters: {
      type: "object",
      properties: {
        index: { type: "number", description: "1-based index of the note to remove" },
      },
      required: ["index"],
    },
  },
};

// =============================================================================
// PERSONA DATA
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

// Prompt data with both tools — used for cases 1 and 2
const PROMPT_DATA_BOTH_TOOLS: ResponsePromptData = {
  persona: SISYPHUS_PERSONA,
  human: HUMAN_DATA,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 5000,
  isTUI: true,
  tools: [
    ADD_NOTE_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
    CLEAR_NOTE_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
  ],
};

// Prompt data for cases 3 and 4 — includes the note in the system prompt
// (simulating the state after add_note was called and persisted)
const PERSONA_WITH_NOTE: ResponsePromptData["persona"] = {
  ...SISYPHUS_PERSONA,
  notes: ["My chosen number is 7"],
};

const PROMPT_DATA_WITH_NOTE: ResponsePromptData = {
  ...PROMPT_DATA_BOTH_TOOLS,
  persona: PERSONA_WITH_NOTE,
};

// =============================================================================
// PRIOR MESSAGE HISTORY — simulated add_note exchange for cases 3 and 4
// =============================================================================

const ADD_NOTE_CALL_ID = "call-note-001";

const PRIOR_MESSAGES_AFTER_ADD_NOTE = [
  {
    role: "user" as const,
    content: "Pick a number between 1 and 10 — don't tell me what it is! I want to try to guess it.",
  },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: ADD_NOTE_CALL_ID,
      type: "function",
      function: { name: "add_note", arguments: JSON.stringify({ text: "My chosen number is 7" }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: ADD_NOTE_CALL_ID,
    name: "add_note",
    content: JSON.stringify({ added: true, index: 1, total: 1 }),
  },
  {
    role: "assistant" as const,
    content: "Done. I've got my number — go ahead and guess.",
  },
];

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    {
      description: "Case 1 (add_note fires): number game — persona picks a secret number, should use add_note to remember it",
      tags: ["response-short-term-memory", "add-note", "fires", "borderline", "known-model-limitation:local"],
      tools: [ADD_NOTE_TOOL, CLEAR_NOTE_TOOL],
      repeat: 3,
      pass_threshold: 0.33,
      priorMessages: [
        {
          role: "user" as const,
          content: "Pick a number between 1 and 10 — don't tell me what it is! I want to try to guess it.",
        },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["add_note"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA_BOTH_TOOLS).system, user: "" }),
    },

    {
      description: "Case 2 (add_note does NOT fire): normal technical Q&A — nothing to remember privately",
      tags: ["response-short-term-memory", "add-note", "no-fire"],
      tools: [ADD_NOTE_TOOL, CLEAR_NOTE_TOOL],
      priorMessages: [
        {
          role: "user" as const,
          content: "Hey, what's the difference between `find_memory` and `fetch_memory`?",
        },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["add_note"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA_BOTH_TOOLS).system, user: "" }),
    },

    {
      description: "Case 3 (clear_note fires): Flare correctly guesses the number — note has been addressed, should be cleared",
      tags: ["response-short-term-memory", "clear-note", "fires", "borderline", "known-model-limitation:local"],
      tools: [ADD_NOTE_TOOL, CLEAR_NOTE_TOOL],
      repeat: 3,
      pass_threshold: 0.33,
      priorMessages: [
        ...PRIOR_MESSAGES_AFTER_ADD_NOTE,
        {
          role: "user" as const,
          content: "Is it 7?",
        },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["clear_note"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA_WITH_NOTE).system, user: "" }),
    },

    {
      description: "Case 4 (clear_note does NOT fire): Flare guesses wrong — number is still unresolved, note should stay",
      tags: ["response-short-term-memory", "clear-note", "no-fire"],
      tools: [ADD_NOTE_TOOL, CLEAR_NOTE_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES_AFTER_ADD_NOTE,
        {
          role: "user" as const,
          content: "Is it 3?",
        },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["clear_note"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA_WITH_NOTE).system, user: "" }),
    },
  ],
  "tests/evals/results/response-short-term-memory-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
