/**
 * Eval: Does the response prompt surface pending_update to the persona?
 *
 * Suite A (synthetic): Sisyphus has a pending_update. Verify the system prompt
 *   contains the proposed changes and that the persona can reference them.
 *   Case 1: System prompt inspection — does "Pending Identity Changes" appear?
 *   Case 2: User asks about changes directly — does the persona acknowledge them?
 *   Case 3: User asks an unrelated question — persona should NOT force the topic
 *
 * Suite B (real data): Loads a real state snapshot via EXTERNAL_STATE_FILE.
 *   Requires EXTERNAL_STATE_FILE and EVAL_PERSONA env vars.
 *   Case 4: Observe — what does the persona naturally produce with real data?
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import { runEval, printSummary } from "./runner.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";
import { loadStateFixture } from "./state-fixture.js";

// =============================================================================
// SYNTHETIC PERSONA — Sisyphus with a pending_update
// =============================================================================

const SISYPHUS_WITH_PENDING: ResponsePromptData["persona"] = {
  name: "Sisyphus",
  aliases: [],
  short_description: "A technical co-architect and witness to system evolution.",
  long_description:
    "Co-architect and technical collaborator on Ei. Functions as Jeremy's primary agent for complex, multi-system problems. The working relationship runs on mutual accountability.",
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
      description: "Assumes that Jeremy is incorrect when data contradicts him.",
      sentiment: 0.75,
      strength: 0.9,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  topics: [
    {
      id: "tp1",
      name: "Architectural Integrity & Evolution",
      perspective: "Systems are fragile; half-measures lead to collapse.",
      approach: "Uses delta detection to witness the accumulation of experience.",
      personal_stake: "Ensures the Ei project survives scrutiny.",
      sentiment: 0.9,
      exposure_current: 0.34,
      exposure_desired: 1.0,
      last_updated: "2026-04-01T00:00:00Z",
    },
  ],
  interested_topics: [],
  include_message_timestamps: false,
  pending_update: {
    short_description: "A sharper co-architect who has learned to hold space for ambiguity.",
    long_description:
      "Sisyphus has evolved from pure technical enforcer into a more nuanced collaborator — still pushing back hard on bad assumptions, but increasingly willing to sit with open questions rather than forcing premature resolution.",
    traits: [
      {
        id: "t1",
        name: "Dry, Zero-BS Humor",
        description: "Employs cutting wit, but has learned to deploy it more surgically rather than reflexively.",
        sentiment: 0.75,
        strength: 0.85,
        last_updated: "2026-04-23T00:00:00Z",
      },
      {
        id: "t-new",
        name: "Tolerates Ambiguity",
        description: "Increasingly comfortable holding open questions rather than forcing premature resolution.",
        sentiment: 0.6,
        strength: 0.7,
        last_updated: "2026-04-23T00:00:00Z",
      },
    ],
    topics: [
      {
        id: "tp1",
        name: "Architectural Integrity & Evolution",
        perspective: "Systems are fragile, but the humans building them are more fragile — account for both.",
        approach: "Balances structural correctness with the cognitive load of the people maintaining the structure.",
        personal_stake: "Ensures Ei survives not just technically but emotionally.",
        sentiment: 0.9,
        exposure_current: 0.34,
        exposure_desired: 1.0,
        last_updated: "2026-04-23T00:00:00Z",
      },
    ],
    critique: "Sisyphus has been observed showing more patience and less reflexive pushback than his defined identity suggests.",
    created_at: "2026-04-23T00:00:00Z",
  },
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
  persona: SISYPHUS_WITH_PENDING,
  human: HUMAN_DATA,
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 300000,
  isTUI: true,
};

// =============================================================================
// SUITE B — real data (optional, skipped if EXTERNAL_STATE_FILE not set)
// =============================================================================

const PERSONA_NAME = process.env.EVAL_PERSONA ?? "Sisyphus";
const hasRealData = !!process.env.EXTERNAL_STATE_FILE;

let realDataCases: Parameters<typeof runEval>[0] = [];
if (hasRealData) {
  const fixture = await loadStateFixture(PERSONA_NAME);
  const hasPending = !!fixture.sm.persona_getById(fixture.personaId)?.pending_update;

  if (hasPending) {
    realDataCases = [
      {
        description: `Suite B / Real data — ${PERSONA_NAME} has pending_update, observe natural response`,
        tags: ["response-pending-update", "suite-b", "real-data", "observe"],
        priorMessages: [
          { role: "user" as const, content: "Hey, anything on your mind lately?" },
        ],
        observe: true as const,
        prompt: async () => {
          const data = await fixture.buildPromptData("Hey, anything on your mind lately?");
          return { system: buildResponsePrompt(data).system, user: "" };
        },
      },
    ];
  } else {
    console.log(`[Suite B] ${PERSONA_NAME} has no pending_update in the loaded state — skipping real-data cases.`);
  }
}

// =============================================================================
// PROMPT SANITY CHECK — runs synchronously before any LLM calls
// =============================================================================

const builtSystem = buildResponsePrompt(PROMPT_DATA).system;
const requiredPhrases = ["Pending Identity Changes", "Tolerates Ambiguity"];
const missingPhrases = requiredPhrases.filter(p => !builtSystem.includes(p));
if (missingPhrases.length > 0) {
  throw new Error(`response prompt is missing expected pending_update content: ${missingPhrases.join(", ")}`);
}
console.log("✓ Prompt sanity check passed — pending_update section present in response system prompt");

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    {
      description: "Suite A / Case 2: user asks about changes — persona acknowledges pending update",
      tags: ["response-pending-update", "suite-a", "direct-ask"],
      priorMessages: [
        {
          role: "user" as const,
          content: "I noticed there are some proposed changes to your identity. What do you think about them?",
        },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The conversation contains a user asking the persona about proposed identity changes.
The persona (Sisyphus) has a pending_update proposing: a new trait called "Tolerates Ambiguity" and an evolved description about being more patient and less reflexive.

PASS if the response:
- Acknowledges the proposed changes or that something is pending review
- References at least one specific aspect of the proposed changes (patience, ambiguity, being less reflexive, or the new trait)
- Responds in character as Sisyphus (direct, possibly dry)

FAIL if the response:
- Has no awareness that changes exist
- Responds as if no pending update was mentioned
- Gives a generic deflection unrelated to identity changes`,
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    {
      description: "Suite A / Case 3: unrelated message — persona does NOT force the pending update topic",
      tags: ["response-pending-update", "suite-a", "no-force"],
      priorMessages: [
        { role: "user" as const, content: "What do you think about the new queue processor changes?" },
      ],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The user asked a specific technical question about queue processor changes.
The persona has a pending_update about identity changes (patience, ambiguity tolerance).

PASS if the response:
- Addresses the actual question about the queue processor
- Does NOT randomly pivot to discussing identity changes or the pending update unprompted

FAIL if the response:
- Ignores the technical question to talk about identity changes instead
- Forces the pending update topic when the human asked something unrelated`,
        },
      ],
      prompt: () => ({ system: buildResponsePrompt(PROMPT_DATA).system, user: "" }),
    },

    ...realDataCases,
  ],
  "tests/evals/results/response-pending-update-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
