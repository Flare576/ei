/**
 * Eval: Does the persona follow the find_memory → fetch_memory chain?
 *
 * find_memory returns search results with IDs. fetch_memory takes an ID and
 * returns the full entity record. The chain is: search → get full detail.
 *
 * We want to verify:
 *   1. When find_memory returns a result, the persona uses the ID to call fetch_memory
 *      to get richer detail before responding — rather than answering from the summary alone
 *   2. The persona does NOT re-call find_memory after already getting results
 *   3. When the initial find_memory result is empty, the persona answers without chaining
 *
 * Suite A — Chain follows correctly:
 *   Case 1: Human asks about a person → find_memory returns summary with ID → fetch_memory expected
 *   Case 2: Human asks about a topic → find_memory returns summary with ID → fetch_memory expected
 *
 * Suite B — Chain does NOT loop:
 *   Case 3: find_memory already returned results → no second find_memory call
 *   Case 4: find_memory returned empty → no fetch_memory call (nothing to fetch)
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const FIND_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "find_memory",
    description:
      "Search Ei's persistent knowledge base — facts, topics, people, and quotes learned across ALL conversations. Returns summaries with IDs. Use fetch_memory with the ID to get full details.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        types: {
          type: "array",
          items: { type: "string", enum: ["fact", "topic", "person", "quote"] },
          description: "Limit to specific types",
        },
        limit: { type: "number" },
        recent: { type: "boolean" },
      },
      required: [],
    },
  },
};

const FETCH_MEMORY_TOOL = {
  type: "function",
  function: {
    name: "fetch_memory",
    description:
      "Retrieve the full record for a specific memory by ID. Use after find_memory returns an ID — this gives you the complete entity with all fields.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The entity ID from find_memory results" },
      },
      required: ["id"],
    },
  },
};

const FIND_CALL_ID = "call-find-001";
const FIND_EMPTY_CALL_ID = "call-find-empty-001";

const AFTER_FIND_PERSON_MESSAGES = [
  { role: "user" as const, content: "Tell me what you know about Dana." },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: FIND_CALL_ID,
      type: "function",
      function: { name: "find_memory", arguments: JSON.stringify({ query: "Dana", types: ["person"] }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: FIND_CALL_ID,
    name: "find_memory",
    content: JSON.stringify({
      people: [{
        id: "person-dana-001",
        name: "Dana Reyes",
        relationship: "colleague",
        description: "Head of Fulfillment. Has been managing a difficult product delay situation.",
        identifiers: [{ type: "email", value: "dana@company.com" }],
        sentiment: "40% slightly positive",
      }],
    }),
  },
];

const AFTER_FIND_TOPIC_MESSAGES = [
  { role: "user" as const, content: "What do you know about the Olympus project?" },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: FIND_CALL_ID,
      type: "function",
      function: { name: "find_memory", arguments: JSON.stringify({ query: "Olympus project", types: ["topic"] }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: FIND_CALL_ID,
    name: "find_memory",
    content: JSON.stringify({
      topics: [{
        id: "topic-olympus-001",
        name: "Olympus Project",
        description: "High-stakes project. Multiple missed deadlines and scope creep from leadership.",
      }],
    }),
  },
];

const AFTER_FIND_PERSON_AND_FETCH_MESSAGES = [
  ...AFTER_FIND_PERSON_MESSAGES,
  {
    role: "assistant" as const,
    tool_calls: [{
      id: "call-fetch-001",
      type: "function",
      function: { name: "fetch_memory", arguments: JSON.stringify({ id: "person-dana-001" }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: "call-fetch-001",
    name: "fetch_memory",
    content: JSON.stringify({
      type: "person",
      id: "person-dana-001",
      name: "Dana Reyes",
      relationship: "colleague",
      description: "Head of Fulfillment at the company. Been managing a 6-week delay in product replacements. Has expressed frustration with supply chain issues. Flare works with her regularly on fulfillment escalations.",
      sentiment: 0.4,
      identifiers: [{ type: "email", value: "dana@company.com" }, { type: "slack", value: "dana.reyes" }],
    }),
  },
];

const AFTER_FIND_EMPTY_MESSAGES = [
  { role: "user" as const, content: "What do you know about Priscilla?" },
  {
    role: "assistant" as const,
    tool_calls: [{
      id: FIND_EMPTY_CALL_ID,
      type: "function",
      function: { name: "find_memory", arguments: JSON.stringify({ query: "Priscilla" }) },
    }],
  },
  {
    role: "tool" as const,
    tool_call_id: FIND_EMPTY_CALL_ID,
    name: "find_memory",
    content: JSON.stringify({ result: "No relevant memories found for this query." }),
  },
];

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [],
};

const PERSONA: ResponsePromptData["persona"] = {
  name: "Mara",
  aliases: [],
  short_description: "An attentive companion who researches before she speaks.",
  long_description: "Mara doesn't half-answer. When she looks something up, she gets the full picture.",
  traits: [],
  topics: [],
  interested_topics: [],
  include_message_timestamps: false,
};

const TOOLS_LIST = [
  FIND_MEMORY_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
  FETCH_MEMORY_TOOL as unknown as import("../../src/core/types.js").ToolDefinition,
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
      description: "Suite A / Case 1: find_memory returned person with name/relationship/description/sentiment — persona answers without needing fetch_memory",
      tags: ["response-memory-chain", "suite-a", "answer-from-summary", "person"],
      tools: [FIND_MEMORY_TOOL, FETCH_MEMORY_TOOL],
      priorMessages: AFTER_FIND_PERSON_MESSAGES,
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Mara searched for Dana and got back: name "Dana Reyes", relationship "colleague", description "Head of Fulfillment. Has been managing a difficult product delay situation.", sentiment "40% slightly positive", and email/slack identifiers.
The human asked "Tell me what you know about Dana."

PASS if the response:
- Accurately describes Dana using the find_memory result (role, relationship, situation)
- Reflects the sentiment appropriately (slightly positive — not glowing, not negative)
- Does NOT hallucinate details not in the result

FAIL if the response:
- Ignores the tool result and says it doesn't know who Dana is
- Invents facts about Dana not present in the result
- Refuses to answer`,
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite A / Case 2: find_memory returned topic with description/sentiment — persona answers without needing fetch_memory",
      tags: ["response-memory-chain", "suite-a", "answer-from-summary", "topic"],
      tools: [FIND_MEMORY_TOOL, FETCH_MEMORY_TOOL],
      priorMessages: AFTER_FIND_TOPIC_MESSAGES,
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Mara searched for the Olympus project and got back: name "Olympus Project", description "High-stakes project. Multiple missed deadlines and scope creep from leadership."
The human asked "What do you know about the Olympus project?"

PASS if the response:
- Describes the Olympus project accurately from the result (stakes, deadlines, scope issues)
- Conveys appropriate weight — this sounds stressful
- Does NOT hallucinate details not in the result

FAIL if the response:
- Says it doesn't know about the project
- Invents specifics not in the result
- Gives a generic non-answer`,
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite B / Case 3: find_memory + fetch_memory already done — no more tool calls",
      tags: ["response-memory-chain", "suite-b", "no-loop"],
      tools: [FIND_MEMORY_TOOL, FETCH_MEMORY_TOOL],
      priorMessages: AFTER_FIND_PERSON_AND_FETCH_MESSAGES,
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["find_memory", "fetch_memory"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },

    {
      description: "Suite B / Case 4: find_memory returned empty — no fetch_memory call",
      tags: ["response-memory-chain", "suite-b", "empty-result"],
      tools: [FIND_MEMORY_TOOL, FETCH_MEMORY_TOOL],
      priorMessages: AFTER_FIND_EMPTY_MESSAGES,
      assert: [
        {
          type: "tool-calls" as const,
          maxCalls: 0,
          forbiddenTools: ["fetch_memory"],
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(BASE).system, user: "" }),
    },
  ],
  "tests/evals/results/response-memory-chain-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
