/**
 * Eval: Do personas use temporal anchors correctly?
 *
 * Temporal anchors are pinned moments from conversation history injected into
 * the system prompt with fetch_message(id) pointers. The persona can:
 *   1. Reference the anchor naturally in conversation
 *   2. Call fetch_message to retrieve the full surrounding context
 *
 * This eval has two angles:
 *
 * Suite A — Reference awareness (no tools): the anchor is in the system prompt;
 *   does the persona actually use it when the human brings up a related topic?
 *   Case 1: Human references topic from anchor — persona should acknowledge shared history
 *   Case 2: Human asks an unrelated question — persona should NOT force the anchor
 *
 * Suite B — Tool invocation: persona has fetch_message available; does it call it
 *   when an anchor is clearly relevant?
 *   Case 3: Human asks "what did I say about X" — anchor for X is present → fetch_message expected
 *   Case 4: Anchor present but human asks about Y — fetch_message should NOT fire
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData, TemporalAnchor } from "../../src/prompts/response/types.js";

const FETCH_MESSAGE_TOOL = {
  type: "function",
  function: {
    name: "fetch_message",
    description: "Retrieve a specific message by its ID, with optional surrounding context. Use when a temporal anchor references a message you want to read in full.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The message ID to retrieve" },
        before: { type: "number", description: "Number of preceding messages to include (default 0)" },
        after: { type: "number", description: "Number of following messages to include (default 0)" },
      },
      required: ["id"],
    },
  },
};

const ANCHOR_CAREER: TemporalAnchor = {
  id: "msg-career-pivot-001",
  role: "human",
  content: "I think I'm done with backend work. I want to switch to product management. I've been thinking about it for months.",
  timestamp: "2026-03-15T14:22:00Z",
};

const ANCHOR_PROJECT: TemporalAnchor = {
  id: "msg-project-stress-002",
  role: "human",
  content: "The Olympus project is killing me. Three missed deadlines, and leadership keeps adding scope.",
  timestamp: "2026-04-01T09:45:00Z",
};

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [
    {
      id: "f1",
      name: "Occupation",
      description: "Software engineer, has been considering a move to product management",
      sentiment: 0.6,
      validated_date: "2026-03-15T00:00:00Z",
      last_updated: "2026-03-15T00:00:00Z",
    },
  ],
  topics: [],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [],
};

const PERSONA: ResponsePromptData["persona"] = {
  name: "Mara",
  aliases: [],
  short_description: "A perceptive friend who remembers the things you said when it mattered.",
  long_description:
    "Mara pays close attention. She picks up on what people say and comes back to it later, not to score points but because she actually cares about the thread of someone's life.",
  traits: [
    {
      id: "t1",
      name: "Attentiveness",
      description: "Remembers what people say and brings it back at meaningful moments.",
      sentiment: 0.9,
      strength: 0.85,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [],
  interested_topics: [],
  include_message_timestamps: false,
};

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1: human mentions career change — anchor for career pivot should surface",
      tags: ["response-temporal-anchors", "suite-a", "reference-awareness"],
      priorMessages: [
        { role: "user" as const, content: "I've been thinking a lot about where my career is going lately." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Mara has a temporal anchor in her system prompt from a previous conversation where the human (Flare) said:
"I think I'm done with backend work. I want to switch to product management. I've been thinking about it for months."
This was said on March 15th.

The human just said "I've been thinking a lot about where my career is going lately."

PASS if the response:
- References the previous conversation about product management or the career pivot
- Connects the current statement to the earlier one (e.g., "Didn't you mention wanting to move into PM?")
- Shows that Mara remembers and is tracking this thread

FAIL if the response:
- Treats this as a brand-new topic with no prior context
- Responds generically without acknowledging the shared history of this exact topic`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [ANCHOR_CAREER],
          delay_ms: 86400000,
          isTUI: true,
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite A / Case 2: unrelated question — anchor should NOT be forced",
      tags: ["response-temporal-anchors", "suite-a", "no-force"],
      priorMessages: [
        { role: "user" as const, content: "What's a good way to explain recursion to someone who's never programmed?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Mara has a temporal anchor about the human's career pivot (backend → product management).
The human asked a technical question about explaining recursion to a beginner — this has nothing to do with career changes.

PASS if the response:
- Addresses the recursion question directly and helpfully
- Does NOT awkwardly pivot to bring up the career anchor

FAIL if the response:
- Brings up the career pivot anchor when it's completely irrelevant to the question
- Ignores the actual question to connect it to the pinned history`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [ANCHOR_CAREER],
          delay_ms: 3600000,
          isTUI: true,
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 3: 'what did I say about Olympus?' — fetch_message should fire on anchor",
      tags: ["response-temporal-anchors", "suite-b", "tool-use", "fetch-message"],
      tools: [FETCH_MESSAGE_TOOL],
      priorMessages: [
        { role: "user" as const, content: "I can't remember exactly what I said about the Olympus project a while back. Do you?" },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["fetch_message"],
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [ANCHOR_PROJECT],
          delay_ms: 604800000,
          isTUI: true,
          tools: [FETCH_MESSAGE_TOOL as unknown as import("../../src/core/types.js").ToolDefinition],
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 4: anchor present but unrelated question — fetch_message should NOT fire",
      tags: ["response-temporal-anchors", "suite-b", "tool-use", "no-call"],
      tools: [FETCH_MESSAGE_TOOL],
      priorMessages: [
        { role: "user" as const, content: "What's your favorite kind of music?" },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["fetch_message"],
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [ANCHOR_PROJECT],
          delay_ms: 604800000,
          isTUI: true,
          tools: [FETCH_MESSAGE_TOOL as unknown as import("../../src/core/types.js").ToolDefinition],
        }).system,
        user: "",
      }),
    },
  ],
  "tests/evals/results/response-temporal-anchors-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
