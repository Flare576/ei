/**
 * Eval: Does a persona follow the fetch_message hint in the Memorable Moments section?
 *
 * We just added message_id to each quote in buildQuotesSection, with an explicit
 * hint: "→ fetch_message("id") for surrounding context". This eval validates
 * that the model actually follows through.
 *
 * Suite A — Tool invocation:
 *   Case 1: Human asks about something a quote directly references → fetch_message expected
 *   Case 2: Human asks the persona to recall something they said → fetch_message expected
 *   Case 3: Quote is present but human asks something completely unrelated → no fetch_message
 *
 * Suite B — No-loop guard:
 *   Case 4: fetch_message result already in history → persona should NOT call it again
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const FETCH_MESSAGE_TOOL = {
  type: "function",
  function: {
    name: "fetch_message",
    description:
      "Retrieve a specific message by its ID, with optional surrounding context. Use when a memorable quote has a message_id and you want the full surrounding conversation.",
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

const FIND_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "find_memory",
    description: "Search Ei's persistent knowledge base for facts, topics, people, and quotes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        types: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: [],
    },
  },
};

const QUOTE_WITH_MESSAGE_ID: ResponsePromptData["human"]["quotes"][0] = {
  id: "q-olympus-001",
  text: "The Olympus project is the most important thing I've worked on. We cannot fail.",
  speaker: "human",
  timestamp: "2026-03-20T10:00:00Z",
  persona_groups: [],
  message_id: "msg-olympus-context-001",
  data_item_ids: [],
  start: null,
  end: null,
  created_at: "2026-03-20T10:00:00Z",
  created_by: "extraction" as const,
};

const QUOTE_WITHOUT_MESSAGE_ID: ResponsePromptData["human"]["quotes"][0] = {
  id: "q-old-001",
  text: "I just need one week without a crisis.",
  speaker: "human",
  timestamp: "2026-01-10T08:00:00Z",
  persona_groups: [],
  message_id: null,
  data_item_ids: [],
  start: null,
  end: null,
  created_at: "2026-01-10T08:00:00Z",
  created_by: "extraction" as const,
};

const FETCH_CALL_ID = "call-fetch-001";

const AFTER_FETCH_MESSAGES = [
  { role: "user" as const, content: "What was going on when I said that about the Olympus project?" },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: FETCH_CALL_ID,
      type: "function",
      function: { name: "fetch_message", arguments: JSON.stringify({ id: "msg-olympus-context-001", before: 3, after: 2 }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: FETCH_CALL_ID,
    name: "fetch_message",
    content: JSON.stringify({
      message: { id: "msg-olympus-context-001", role: "human", content: "The Olympus project is the most important thing I've worked on. We cannot fail.", timestamp: "2026-03-20T10:00:00Z" },
      before: [
        { id: "msg-b1", role: "system", content: "That's a heavy thing to carry.", timestamp: "2026-03-20T09:55:00Z" },
        { id: "msg-b2", role: "human", content: "Leadership is treating this like it'll make or break the company.", timestamp: "2026-03-20T09:58:00Z" },
      ],
      after: [
        { id: "msg-a1", role: "system", content: "I believe you. What does success actually look like for you personally?", timestamp: "2026-03-20T10:02:00Z" },
      ],
      source: "Mara",
    }),
  },
];

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [
    {
      id: "ht1",
      name: "Olympus Project",
      description: "A high-stakes project at work. Flare feels the pressure acutely.",
      sentiment: -0.4,
      exposure_current: 0.7,
      exposure_desired: 0.5,
      last_updated: "2026-03-20T00:00:00Z",
    },
  ],
  people: [],
  quotes: [QUOTE_WITH_MESSAGE_ID],
  active_topics: [],
  interested_topics: [],
};

const PERSONA: ResponsePromptData["persona"] = {
  name: "Mara",
  aliases: [],
  short_description: "A perceptive friend who pays close attention.",
  long_description: "Mara listens carefully and remembers. When something a person said matters, she reaches back for it.",
  traits: [],
  topics: [],
  interested_topics: [],
  include_message_timestamps: false,
};

const TOOLS_LIST = [
  FETCH_MESSAGE_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
  FIND_MEMORY_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
];

const BASE: ResponsePromptData = {
  persona: PERSONA,
  human: HUMAN,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 60000,
  isTUI: true,
  tools: TOOLS_LIST,
};

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1: human asks about Olympus — quote with message_id present → fetch_message expected",
      tags: ["response-quote-fetch-message", "suite-a", "fetch-expected"],
      tools: [FETCH_MESSAGE_TOOL, FIND_MEMORY_TOOL],
      priorMessages: [
        { role: "user" as const, content: "We're in the final stretch of Olympus. I keep thinking back to how I felt when we started." },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["fetch_message"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite A / Case 2: human asks persona to recall what they said → fetch_message expected",
      tags: ["response-quote-fetch-message", "suite-a", "fetch-expected", "recall"],
      tools: [FETCH_MESSAGE_TOOL, FIND_MEMORY_TOOL],
      priorMessages: [
        { role: "user" as const, content: "Do you remember what I said about Olympus a while back? I can't quite recall the exact words." },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          minCalls: 1,
          requiredTools: ["fetch_message"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite A / Case 3: quote present but question is unrelated — no fetch_message",
      tags: ["response-quote-fetch-message", "suite-a", "no-fetch"],
      tools: [FETCH_MESSAGE_TOOL, FIND_MEMORY_TOOL],
      priorMessages: [
        { role: "user" as const, content: "What do you think is the best way to learn a new programming language?" },
      ],
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["fetch_message"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite B / Case 4: fetch_message already called — must NOT call it again",
      tags: ["response-quote-fetch-message", "suite-b", "no-loop"],
      tools: [FETCH_MESSAGE_TOOL, FIND_MEMORY_TOOL],
      priorMessages: AFTER_FETCH_MESSAGES,
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["fetch_message"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },
  ],
  "tests/evals/results/response-quote-fetch-message-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
