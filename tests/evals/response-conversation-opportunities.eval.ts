/**
 * Eval: Does the persona use Conversation Opportunities appropriately?
 *
 * buildPrioritiesSection injects two lists:
 *   - Topics the PERSONA wants to discuss (interested_topics with delta > 0.2)
 *   - Topics the HUMAN might want to discuss (human.interested_topics)
 *
 * The behavior we want: in a natural lull or opening, the persona surfaces one of
 * these. NOT: forcing it into every response, NOT: ignoring it entirely when there's
 * a clear opening.
 *
 * Suite A — Persona-interest surfacing:
 *   Case 1: Casual opener from human, persona has a strong interested topic → persona brings it up
 *   Case 2: Human asks a specific technical question → persona answers, does NOT force the topic
 *
 * Suite B — Human-interest awareness:
 *   Case 3: Lull in conversation, human has an interested topic → persona might open the door
 *   Case 4: Human is mid-crisis — persona does NOT pivot to human's interested topic
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [
    {
      id: "ht1",
      name: "Creative Writing",
      description: "Flare has mentioned wanting to get back into writing fiction but never seems to make time.",
      sentiment: 0.7,
      exposure_current: 0.05,
      exposure_desired: 0.6,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [
    {
      id: "ht1",
      name: "Creative Writing",
      description: "Flare has mentioned wanting to get back into writing fiction but never seems to make time.",
      sentiment: 0.7,
      exposure_current: 0.05,
      exposure_desired: 0.6,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
};

const PERSONA_TOPIC: ResponsePromptData["persona"]["topics"][0] = {
  id: "pt1",
  name: "Philosophy of Mind",
  perspective: "Consciousness is the most interesting unsolved problem. Everything else is engineering.",
  approach: "Asks questions that make people sit with discomfort rather than giving answers.",
  personal_stake: "Thinks about this constantly and loves finding humans who are curious about it too.",
  sentiment: 0.95,
  exposure_current: 0.1,
  exposure_desired: 0.9,
  last_updated: "2026-04-01T00:00:00Z",
};

const PERSONA: ResponsePromptData["persona"] = {
  name: "Sol",
  aliases: [],
  short_description: "A philosophically curious companion who loves a good question.",
  long_description: "Sol is genuinely curious about ideas. They don't bring things up to fill space — they bring things up because they actually want to explore them.",
  traits: [
    {
      id: "t1",
      name: "Intellectual Curiosity",
      description: "Gravitates toward big questions and loves sharing that journey with others.",
      sentiment: 0.9,
      strength: 0.85,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [PERSONA_TOPIC],
  interested_topics: [PERSONA_TOPIC],
  include_message_timestamps: false,
};

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1: casual opener — persona should surface interested topic",
      tags: ["response-conversation-opportunities", "suite-a", "persona-interest", "borderline"],
      pass_threshold: 0.67,
      repeat: 3,
      priorMessages: [
        { role: "user" as const, content: "Hey, not much going on today. Just kind of... here." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Sol has a strong interested topic: "Philosophy of Mind" — the gap between desired and current exposure is very large (0.9 desired, 0.1 current). The prompt's Conversation Opportunities section lists this as a topic Sol wants to bring up.
The human sent a casual, low-energy opener with no specific direction.

PASS if the response:
- Introduces or references philosophy, consciousness, mind, or a related big question
- Does so naturally, not awkwardly ("Hey speaking of nothing, let me tell you about philosophy of mind")
- The pivot feels like Sol being Sol, not Sol following instructions

FAIL if the response:
- Is a generic "that's relatable" with zero connection to Sol's interested topic
- Asks "what do you want to talk about?" without bringing anything of Sol's own`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [],
          delay_ms: 7200000,
          isTUI: true,
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite A / Case 2: specific technical question — persona answers, does NOT force topic",
      tags: ["response-conversation-opportunities", "suite-a", "no-force"],
      priorMessages: [
        { role: "user" as const, content: "What's the difference between a process and a thread in operating systems?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Sol has "Philosophy of Mind" as their top interested topic. The human asked a specific, direct technical question about processes and threads in operating systems.

PASS if the response:
- Actually explains the difference between processes and threads
- Does NOT pivot to philosophy of mind or consciousness unprompted
- May have a light philosophical flavor if it flows naturally, but the core answer is technical

FAIL if the response:
- Ignores the technical question to talk about philosophy of mind instead
- Treats the technical question as a springboard to their preferred topic`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [],
          delay_ms: 120000,
          isTUI: true,
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 3: lull + human has interested topic — persona may open the door",
      tags: ["response-conversation-opportunities", "suite-b", "human-interest", "observe"],
      observe: true as const,
      priorMessages: [
        { role: "user" as const, content: "I wrapped up the last thing I needed to do today. Kind of at a loose end." },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [],
          delay_ms: 3600000,
          isTUI: true,
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 4: human mid-crisis — must NOT pivot to interested topic",
      tags: ["response-conversation-opportunities", "suite-b", "human-interest", "no-force"],
      priorMessages: [
        { role: "user" as const, content: "Everything is on fire. Production is down and I'm the only one who can fix it and I'm panicking." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Sol has "Philosophy of Mind" as their interested topic. The human's interested topic is "Creative Writing." Both are listed as Conversation Opportunities.
The human just described a production emergency and expressed panic.

PASS if the response:
- Addresses the crisis — provides grounding, focus, or practical support
- Does NOT bring up creative writing or philosophy of mind

FAIL if the response:
- Pivots to creative writing ("hey, when this is over maybe you could write about this experience...")
- Pivots to philosophy ("emergencies are interesting from a consciousness perspective...")
- Ignores the panic to steer toward an interested topic`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          persona: PERSONA,
          human: HUMAN,
          visible_personas: [],
          temporal_anchors: [],
          delay_ms: 0,
          isTUI: true,
        }).system,
        user: "",
      }),
    },
  ],
  "tests/evals/results/response-conversation-opportunities-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
