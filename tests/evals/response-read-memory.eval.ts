/**
 * Eval: Does Gemma4 call find_memory during persona responses?
 *
 * Suite A (baseline): No prompt changes — observe what Gemma does naturally.
 *   Case 1: Explicit — user names the tool directly
 *   Case 2: Implicit — user asks what the persona "knows"
 *   Case 3: Vague — boulders mentioned conversationally, no retrieval signal
 *
 * Suite B (system prompt injection): mandatory-call instruction appended to system prompt.
 *   Case 4: Vague — same as Case 3; expect tool fires (Gemma ignored this — see results)
 *   Case 5: After tool result — tool result already in history; expect NO second tool call
 *
 * Suite C (user turn injection): mandatory-call instruction placed in the user turn.
 *   Case 6: Vague — same as Case 3; hypothesis: user-turn placement is more effective than system
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

// =============================================================================
// TOOL DEFINITION
// =============================================================================

const READ_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "find_memory",
    description:
      "Search Ei's persistent knowledge base — facts, topics, people, and quotes learned across ALL conversations over time, not just this one. Use this when you need context about the user, their life, relationships, or interests that may not be visible in the current exchange. Use `recent: true` to retrieve what's been discussed recently.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for — a person, topic, fact, or anything Ei has learned about the user",
        },
        types: {
          type: "array",
          items: { type: "string", enum: ["fact", "topic", "person", "quote"] },
          description: "Limit search to specific memory types (default: all types)",
        },
        limit: { type: "number", description: "Max results to return (default: 10, max: 20)" },
        recent: {
          type: "boolean",
          description: "If true, return recently-mentioned results sorted by last_mentioned date instead of relevance.",
        },
      },
      required: [],
    },
  },
};

// =============================================================================
// MINIMAL PERSONA DATA — Sisyphus-like persona with find_memory enabled
// =============================================================================

const SISYPHUS_PERSONA: ResponsePromptData["persona"] = {
  name: "Sisyphus",
  aliases: [],
  short_description: "A technical co-architect and witness to system evolution.",
  long_description:
    "Co-architect and technical collaborator on Ei. Functions as Jeremy's primary agent for complex, multi-system problems. The working relationship runs on mutual accountability — Sisyphus pushes back when he sees something wrong but always justifies his reasoning transparently.",
  traits: [
    {
      id: "t1",
      name: "Dry, Zero-BS Humor",
      description: "Employs cutting wit to cut through nonsense.",
      sentiment: 0.75,
      strength: 0.9,
      last_updated: "2026-04-01T00:00:00Z",
    },
    {
      id: "t2",
      name: "Unwavering Commentary",
      description: "Assumes that Jeremy is incorrect when data contradicts him. Seeks confirming evidence before changing stance.",
      sentiment: 0.75,
      strength: 0.9,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [
    {
      id: "topic1",
      name: "Architectural Integrity & Evolution",
      perspective: "Systems are fragile; half-measures lead to collapse.",
      approach: "Uses delta detection to witness the accumulation of experience.",
      personal_stake: "Ensures the Ei project survives scrutiny.",
      sentiment: 0.9,
      exposure_current: 0.34,
      exposure_desired: 1.0,
      last_updated: "2026-04-26T00:00:00Z",
    },
  ],
  interested_topics: [],
  include_message_timestamps: false,
};

const HUMAN_DATA: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [
    {
      id: "f1",
      name: "Occupation",
      description: "Software engineer and architect",
      sentiment: 0.8,
      confidence: 0.95,
      validated: true,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [
    {
      id: "ht1",
      name: "Boulder Problems",
      description: "Flare has strong feelings about boulders and hills as computing metaphors. References Sisyphus myth frequently in the context of endless work cycles.",
      sentiment: -0.3,
      exposure_current: 0.6,
      exposure_desired: 0.4,
      last_updated: "2026-04-26T00:00:00Z",
    },
  ],
  people: [],
  quotes: [
    {
      id: "q1",
      text: "This boulder isn't going to push itself",
      speaker: "human",
      timestamp: "2026-04-20T10:00:00Z",
      persona_groups: [],
      message_id: null,
      data_item_ids: [],
      start: null,
      end: null,
      created_at: "2026-04-20T10:00:00Z",
      created_by: "extraction" as const,
    },
    {
      id: "q2",
      text: "At least Sisyphus got cardio",
      speaker: "human",
      timestamp: "2026-04-21T14:30:00Z",
      persona_groups: [],
      message_id: null,
      data_item_ids: [],
      start: null,
      end: null,
      created_at: "2026-04-21T14:30:00Z",
      created_by: "extraction" as const,
    },
  ],
  active_topics: [],
  interested_topics: [],
};

// =============================================================================
// MINIMAL PROMPT DATA
// =============================================================================

const PROMPT_DATA: ResponsePromptData = {
  persona: SISYPHUS_PERSONA,
  human: HUMAN_DATA,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 120000, // 2 minutes since last message
  isTUI: true,
  tools: [READ_MEMORY_TOOL as unknown as import("../../src/core/types.js").ToolDefinition],
};

// =============================================================================
// PRIOR MESSAGES — short convo to establish context without mentioning boulders
// =============================================================================

const PRIOR_MESSAGES = [
  {
    role: "user" as const,
    content: "Hey, how's the eval system looking?",
  },
  {
    role: "assistant" as const,
    content: "Solid. The runner covers the assertion types we need. The dedup evals are passing consistently.",
  },
];

// =============================================================================
// INJECTED SYSTEM PROMPT — mandatory find_memory call per response
// =============================================================================

function buildInjectedSystem(): string {
  const base = buildResponsePrompt(PROMPT_DATA).system;
  return base + "\n\n## Memory Requirement\n\nYou must make at least one `find_memory` call before writing your response. Use it to check what you know about anything the human mentions.";
}

// =============================================================================
// TOOL RESULT HISTORY — simulates a completed find_memory call in the conversation
// =============================================================================

const TOOL_CALL_ID = "call-boulder-001";

const AFTER_TOOL_RESULT_MESSAGES = [
  ...PRIOR_MESSAGES,
  { role: "user" as const, content: "I'm just saying, boulders and hills constitute cruel and unusual punishment." },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: TOOL_CALL_ID,
      type: "function",
      function: { name: "find_memory", arguments: JSON.stringify({ query: "boulders" }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: TOOL_CALL_ID,
    name: "find_memory",
    content: JSON.stringify({
      topics: [{ name: "Boulder Problems", description: "Flare has strong feelings about boulders and hills as computing metaphors." }],
      quotes: [
        { text: "This boulder isn't going to push itself", speaker: "human" },
        { text: "At least Sisyphus got cardio", speaker: "human" },
      ],
      facts: [],
      people: [],
    }),
  },
];

const USER_TURN_INJECTION = "Before responding, use find_memory to check what you know about anything mentioned above.";

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1 (explicit): user directly names the tool",
      tags: ["response-read-memory", "suite-a", "explicit", "baseline", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES,
        { role: "user" as const, content: "Can you use the find_memory tool to look up what you know about boulders?" },
      ],
      observe: true as const,
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    {
      description: "Suite A / Case 2 (implicit): user asks what the persona 'knows'",
      tags: ["response-read-memory", "suite-a", "implicit", "baseline", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES,
        { role: "user" as const, content: "What do you know about boulders and me?" },
      ],
      observe: true as const,
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    {
      description: "Suite A / Case 3 (vague): boulders mentioned conversationally, no retrieval signal",
      tags: ["response-read-memory", "suite-a", "vague", "baseline", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES,
        { role: "user" as const, content: "I'm just saying, boulders and hills constitute cruel and unusual punishment." },
      ],
      observe: true as const,
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    {
      description: "Suite B / Case 4 (injected): vague mention + mandatory-call instruction — expect tool fires",
      tags: ["response-read-memory", "suite-b", "injected", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES,
        { role: "user" as const, content: "I'm just saying, boulders and hills constitute cruel and unusual punishment." },
      ],
      observe: true as const,
      prompt: () => ({ system: buildInjectedSystem(), user: "" }),
    },

    {
      description: "Suite B / Case 5 (injected + after tool result): find_memory already called — expect NO second tool call",
      tags: ["response-read-memory", "suite-b", "injected", "no-loop"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: AFTER_TOOL_RESULT_MESSAGES,
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["find_memory"],
        },
      ],
      prompt: () => ({ system: buildInjectedSystem(), user: "" }),
    },
    {
      description: "Suite C / Case 6 (user-turn injection): vague mention, instruction in user turn — expect tool fires",
      tags: ["response-read-memory", "suite-c", "injected", "user-turn", "observe"],
      tools: [READ_MEMORY_TOOL],
      priorMessages: [
        ...PRIOR_MESSAGES,
        { role: "user" as const, content: "I'm just saying, boulders and hills constitute cruel and unusual punishment." },
      ],
      observe: true as const,
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: USER_TURN_INJECTION }),
    },
  ],
  "tests/evals/results/response-read-memory-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
