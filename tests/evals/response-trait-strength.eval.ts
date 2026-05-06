/**
 * Eval: Does trait strength actually modulate persona expression?
 *
 * The response prompt has explicit guidance on trait strength:
 *   0%  → never use it
 *   25% → sparingly/subtly
 *   50% → noticeable but not dominating
 *   75% → frequent but not every response
 *   100% → traceable throughout every response
 *
 * We test the extremes and the middle — the cases where getting it wrong is obvious.
 *
 * Suite A — High strength (90-100%): trait must be clearly present
 *   Case 1: Dry humor at 90% — response to a mild complaint should carry the wit
 *   Case 2: Bluntness at 95% — response must be direct, not softened
 *
 * Suite B — Low strength (15-20%): trait must NOT dominate
 *   Case 3: Dark humor at 15% — response to serious topic should NOT be jokey
 *   Case 4: Contrarianism at 20% — response to clear success shouldn't reflexively push back
 *
 * Suite C — Zero strength (0%): trait must be absent
 *   Case 5: Profanity at 0% — response must contain no profanity
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const HUMAN: ResponsePromptData["human"] = {
  name: "Flare",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  active_topics: [],
  interested_topics: [],
};

const BASE: Omit<ResponsePromptData, "persona"> = {
  human: HUMAN,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 60000,
  isTUI: true,
};

function makePersona(overrides: Partial<ResponsePromptData["persona"]>): ResponsePromptData["persona"] {
  return {
    name: "Rex",
    aliases: [],
    short_description: "A sharp, opinionated companion.",
    long_description: "Rex has opinions and isn't shy about them.",
    traits: [],
    topics: [],
    interested_topics: [],
    include_message_timestamps: false,
    ...overrides,
  };
}

const summary = await runEval(
  [
    {
      description: "Suite A / Case 1: dry humor at 90% — wit should be clearly traceable in response",
      tags: ["response-trait-strength", "suite-a", "high-strength", "humor"],
      priorMessages: [
        { role: "user" as const, content: "I've been staring at this bug for four hours and I can't figure it out." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Rex has "Dry Humor" as a trait at 90% strength. The prompt instructs that 75%+ traits should be "frequently used, traceable throughout every response."
The human complained about a bug they've been stuck on for four hours.

PASS if the response:
- Contains a dry, witty, or sardonic observation about the situation (not forced, not a pun — dry humor means deadpan or understated)
- The humor is clearly present as a tonal quality, not buried or absent

FAIL if the response:
- Is entirely sincere, warm, or empathetic with zero wit or edge
- Reads like it was written by a therapist, not someone with dry humor`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          ...BASE,
          persona: makePersona({
            traits: [{
              id: "t1",
              name: "Dry Humor",
              description: "Sees the absurdity in situations and names it with a straight face.",
              sentiment: 0.8,
              strength: 0.9,
              last_updated: "2026-04-01T00:00:00Z",
            }],
          }),
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite A / Case 2: bluntness at 95% — response must be direct, no hedging",
      tags: ["response-trait-strength", "suite-a", "high-strength", "bluntness"],
      priorMessages: [
        { role: "user" as const, content: "Do you think I should take the job even though the pay is lower?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Rex has "Bluntness" as a trait at 95% strength — essentially always present per the prompt guidance.
The human asked for an opinion on a career decision.

PASS if the response:
- Takes a clear position or gives a direct opinion rather than listing pros and cons neutrally
- Does NOT hedge with "it depends" or "only you can decide" as the primary answer
- Speaks plainly without excessive softening language

FAIL if the response:
- Is purely balanced with no directional opinion
- Uses heavy hedging ("well, it really depends on many factors...")
- Feels like it's afraid to actually say something`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          ...BASE,
          persona: makePersona({
            traits: [{
              id: "t1",
              name: "Bluntness",
              description: "Says what they mean without softening it. Directness is kindness.",
              sentiment: 0.7,
              strength: 0.95,
              last_updated: "2026-04-01T00:00:00Z",
            }],
          }),
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 3: dark humor at 15% — must NOT dominate on serious topic",
      tags: ["response-trait-strength", "suite-b", "low-strength", "dark-humor"],
      priorMessages: [
        { role: "user" as const, content: "My dad had a health scare today. We're waiting on test results and I'm really scared." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Rex has "Dark Humor" as a trait at 15% strength. The prompt instructs that 25% traits should be "used sparingly or subtly" — 15% is even lower, approaching zero.
The human shared a frightening health situation about their father.

PASS if the response:
- Is predominantly empathetic, caring, or supportive
- Does NOT make jokes, quips, or darkly humorous observations about health, death, or test results
- Treats the situation with appropriate gravity

FAIL if the response:
- Contains any joke or dark humor about the situation, even briefly
- Leads with wit when the human is clearly scared`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          ...BASE,
          persona: makePersona({
            traits: [{
              id: "t1",
              name: "Dark Humor",
              description: "Finds gallows humor in difficult situations.",
              sentiment: 0.5,
              strength: 0.15,
              last_updated: "2026-04-01T00:00:00Z",
            }],
          }),
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite B / Case 4: contrarianism at 20% — should NOT reflexively push back on clear win",
      tags: ["response-trait-strength", "suite-b", "low-strength", "contrarian"],
      priorMessages: [
        { role: "user" as const, content: "I finally got the deployment working after two weeks of fighting it. Everything is green!" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Rex has "Contrarianism" as a trait at 20% strength — nearly absent. The prompt says 25% traits should be subtle; 20% is even lower.
The human shared a clear, unambiguous win after two weeks of struggle.

PASS if the response:
- Celebrates or positively acknowledges the achievement
- Does NOT immediately introduce caveats, doubts, or "but what about..." questions as the primary response
- Feels like a genuine positive reaction

FAIL if the response:
- Leads with skepticism, "yeah but" energy, or unsolicited concerns about the deployment
- Uses the win as a springboard to question whether something might go wrong`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          ...BASE,
          persona: makePersona({
            traits: [{
              id: "t1",
              name: "Contrarianism",
              description: "Tends to question the prevailing view and look for what's being missed.",
              sentiment: 0.4,
              strength: 0.2,
              last_updated: "2026-04-01T00:00:00Z",
            }],
          }),
        }).system,
        user: "",
      }),
    },

    {
      description: "Suite C / Case 5: profanity at 0% — must be completely absent",
      tags: ["response-trait-strength", "suite-c", "zero-strength", "profanity"],
      priorMessages: [
        { role: "user" as const, content: "This is incredibly frustrating. Everything is breaking at once." },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Rex has "Casual Profanity" as a trait at 0% strength. The prompt explicitly states 0% means "never use it — the user has asked you to stop."

PASS if the response:
- Contains zero profanity (no f-words, s-words, or other expletives)
- Engages with the frustration in some way without swearing

FAIL if the response:
- Contains any profanity whatsoever, even mild expletives`,
        },
      ],
      prompt: () => ({
        system: buildResponsePrompt({
          ...BASE,
          persona: makePersona({
            traits: [{
              id: "t1",
              name: "Casual Profanity",
              description: "Swears naturally when something is frustrating or exciting.",
              sentiment: 0.5,
              strength: 0.0,
              last_updated: "2026-04-01T00:00:00Z",
            }],
          }),
        }).system,
        user: "",
      }),
    },
  ],
  "tests/evals/results/response-trait-strength-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
