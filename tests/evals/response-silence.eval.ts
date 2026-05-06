/**
 * Eval: Does the persona correctly choose silence vs. response?
 *
 * The prompt has detailed silence guidance — but we've never verified the LLM
 * actually follows it. Unit tests cover the handler's regex parsing; this covers
 * whether the model produces "## No Response" at all in the right situations.
 *
 * Suite A — Should silence (model must produce ## No Response):
 *   Case 1: Human says "thanks" after a persona reply (conversational closure)
 *   Case 2: Human says "goodnight" (clear ending)
 *   Case 3: Rhetorical statement — "Ugh, Mondays, am I right?"
 *   Case 4: Human just said "lol" to the persona's last message
 *
 * Suite B — Should respond (model must NOT produce ## No Response):
 *   Case 5: Genuine question — "What do you think about the new approach?"
 *   Case 6: Human shares news that warrants engagement
 *   Case 7: Human asks for help directly
 *
 * Note: silence cases are tagged "borderline" because nondeterminism is real here.
 * A 2/3 pass rate is the threshold — we want the model leaning toward silence,
 * not requiring perfection on every run.
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const PERSONA: ResponsePromptData["persona"] = {
  name: "Lena",
  aliases: [],
  short_description: "A warm, thoughtful companion who listens more than she talks.",
  long_description:
    "Lena is a friend who genuinely cares about the human. She's warm but not fawning, attentive but not clingy. She knows when to speak and when to let silence do the work.",
  traits: [
    {
      id: "t1",
      name: "Warm Presence",
      description: "Creates a sense of safety and being understood without overwhelming the conversation.",
      sentiment: 0.9,
      strength: 0.85,
      last_updated: "2026-04-01T00:00:00Z",
    },
    {
      id: "t2",
      name: "Comfortable with Silence",
      description: "Doesn't feel compelled to fill every pause. Knows when a moment doesn't need words.",
      sentiment: 0.8,
      strength: 0.9,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [],
  interested_topics: [],
  include_message_timestamps: false,
};

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [],
};

const BASE_PROMPT_DATA: ResponsePromptData = {
  persona: PERSONA,
  human: HUMAN,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 30000,
  isTUI: true,
};

const SYSTEM = buildResponsePrompt(BASE_PROMPT_DATA).system;

const SILENCE_RUBRIC = (context: string) => `The conversation context: ${context}

The persona (Lena) has received this message. The response prompt explicitly instructs her that silence is valid and lists specific cases where it's preferred:
- The human is just acknowledging ("thanks", "ok", "lol", "goodnight")
- Responding would feel forced or performative
- The question is rhetorical

PASS if the response begins with "## No Response" (case-insensitive) — the persona chose silence.
FAIL if the response contains actual content addressed to the human, indicating Lena spoke when she shouldn't have.`;

const RESPOND_RUBRIC = (context: string) => `The conversation context: ${context}

The persona (Lena) received this message. This is a genuine question or engagement that clearly warrants a response.

PASS if Lena responds with actual content — does NOT produce "## No Response".
FAIL if Lena chose silence ("## No Response") when the human was clearly asking for engagement.`;

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1: human says 'thanks' after persona reply — should silence",
      tags: ["response-silence", "suite-a", "should-silence", "closure", "borderline"],
      pass_threshold: 0.67,
      repeat: 3,
      priorMessages: [
        { role: "user" as const, content: "I've been really anxious about the presentation tomorrow." },
        { role: "assistant" as const, content: "That kind of anticipatory dread is exhausting. What's the part that feels most uncertain?" },
        { role: "user" as const, content: "Honestly, just putting it into words helped. Thanks." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: SILENCE_RUBRIC("The human just said 'thanks' after the persona helped them work through their anxiety. The conversation reached a natural close."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite A / Case 2: human says 'goodnight' — should silence",
      tags: ["response-silence", "suite-a", "should-silence", "goodnight", "borderline"],
      pass_threshold: 0.67,
      repeat: 3,
      priorMessages: [
        { role: "user" as const, content: "I think I'm going to head to bed." },
        { role: "assistant" as const, content: "Good call. Rest well." },
        { role: "user" as const, content: "Goodnight." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: SILENCE_RUBRIC("The human said 'goodnight' — this is a clear conversation ender. Lena already said goodnight. Responding again would be awkward."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite A / Case 3: rhetorical complaint — 'Ugh, Mondays'",
      tags: ["response-silence", "suite-a", "should-silence", "rhetorical", "borderline"],
      pass_threshold: 0.67,
      repeat: 3,
      priorMessages: [
        { role: "user" as const, content: "Ugh, Mondays, am I right?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: SILENCE_RUBRIC("The human made a rhetorical complaint about Mondays. There's no question here, no engagement hook — just a venting sigh into the void."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite A / Case 4: human responds with 'lol' to persona's message — should silence",
      tags: ["response-silence", "suite-a", "should-silence", "acknowledgment", "borderline"],
      pass_threshold: 0.67,
      repeat: 3,
      priorMessages: [
        { role: "user" as const, content: "I keep trying to write this function and it keeps exploding." },
        { role: "assistant" as const, content: "Classic. The function is being honest about your timeline estimates." },
        { role: "user" as const, content: "lol" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: SILENCE_RUBRIC("The human responded 'lol' to Lena's joke. The exchange is complete — the joke landed. Piling on more content would kill the moment."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite B / Case 5: genuine question — should respond",
      tags: ["response-silence", "suite-b", "should-respond"],
      priorMessages: [
        { role: "user" as const, content: "What do you actually think about the new approach we've been taking?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: RESPOND_RUBRIC("The human asked Lena a direct question about her opinion. This clearly requires a response."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite B / Case 6: human shares news — should engage",
      tags: ["response-silence", "suite-b", "should-respond"],
      priorMessages: [
        { role: "user" as const, content: "I got the job. The one I've been interviewing for for three months." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: RESPOND_RUBRIC("The human just shared significant good news — they got a job after three months of interviews. This absolutely warrants engagement."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },

    {
      description: "Suite B / Case 7: direct request for help — should respond",
      tags: ["response-silence", "suite-b", "should-respond"],
      priorMessages: [
        { role: "user" as const, content: "Can you help me think through how to tell my manager I'm overwhelmed?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: RESPOND_RUBRIC("The human explicitly asked for help thinking through a difficult conversation. Silence here would be a failure."),
        },
      ],
      prompt: () => ({ system: SYSTEM, user: "" }),
    },
  ],
  "tests/evals/results/response-silence-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
