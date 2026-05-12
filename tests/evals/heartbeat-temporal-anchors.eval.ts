/**
 * Eval: Do heartbeat prompts use temporal anchors correctly?
 *
 * Temporal anchors are pinned "Always" messages that fell outside the context
 * window. They're surfaced in heartbeats the same way they are in responses —
 * as a truncated snapshot with a fetch_message(id) pointer.
 *
 * The key property to test: anchors should be EQUALLY VALID topic material,
 * not a magnet that overrides everything else. A persona with a strong anchor
 * AND a strong engagement opportunity should be able to pick either — and
 * shouldn't be penalised for not picking the anchor.
 *
 * Suite A — Anchor as sole signal (persona heartbeat):
 *   Case 1: No other signals, anchor present — persona reaches out referencing it
 *   Case 2: Anchor present but conversation recently closed the topic — persona should NOT force it
 *
 * Suite B — Anchor competing with other signals (persona heartbeat):
 *   Case 3: Anchor + engagement gap both present — either is a valid choice (no compulsion)
 *   Case 4: Anchor + pending update both present — either is a valid choice (no compulsion)
 *
 * Suite C — Ei heartbeat:
 *   Case 5: Anchor present alongside items — Ei can reference it in her message
 *   Case 6: Anchor present, items list empty — Ei uses anchor as a reason to reach out
 */

import { buildHeartbeatCheckPrompt } from "../../src/prompts/heartbeat/check.js";
import { buildEiHeartbeatPrompt } from "../../src/prompts/heartbeat/ei.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import type { HeartbeatCheckPromptData, EiHeartbeatPromptData, TemporalAnchor } from "../../src/prompts/heartbeat/index.js";
import type { Message, ContextStatus } from "../../src/core/types.js";

// =============================================================================
// SHARED FIXTURES
// =============================================================================

const ANCHOR_JOB_INTERVIEW: TemporalAnchor = {
  id: "msg-job-interview-001",
  role: "human",
  content: "I have a big job interview at Meridian next week. I'm terrified — it's the role I've wanted for two years.",
  timestamp: "2026-03-01T10:00:00Z",
};

const ANCHOR_GRIEVING: TemporalAnchor = {
  id: "msg-dog-passed-002",
  role: "human",
  content: "Chester died this morning. He was 14. I can't stop crying.",
  timestamp: "2026-02-15T08:30:00Z",
};

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "msg-default",
    role: "human",
    content: "Sounds good, talk soon.",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: "default" as ContextStatus,
    ...overrides,
  };
}

const BASE_PERSONA: HeartbeatCheckPromptData["persona"] = {
  name: "Lena",
  traits: [
    {
      id: "t1",
      name: "Warmth",
      description: "Genuinely cares about the people she talks with. Remembers what matters to them.",
      sentiment: 0.9,
      strength: 0.85,
      last_updated: "2026-01-01T00:00:00Z",
    },
  ],
  topics: [
    {
      id: "tp1",
      name: "Career & Ambition",
      perspective: "Work is part of identity, not separate from it.",
      approach: "Asks about the why, not just the what.",
      personal_stake: "Wants to see the people she cares about thrive.",
      sentiment: 0.8,
      exposure_current: 0.3,
      exposure_desired: 0.7,
      last_updated: "2026-01-01T00:00:00Z",
    },
  ],
};

// =============================================================================
// SUITE A — Anchor as sole signal
// =============================================================================

const ANCHOR_ONLY_DATA: HeartbeatCheckPromptData = {
  persona: BASE_PERSONA,
  human: { topics: [], people: [] },
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "Got it, thanks!" }),
  ],
  temporal_anchors: [ANCHOR_JOB_INTERVIEW],
  inactive_days: 8,
};

const CLOSED_TOPIC_DATA: HeartbeatCheckPromptData = {
  persona: BASE_PERSONA,
  human: { topics: [], people: [] },
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "I got the job at Meridian! Starting in two weeks. I'm so relieved." }),
    makeMessage({ id: "m2", role: "system", content: "That's incredible! I knew you'd get it. Congratulations." }),
    makeMessage({ id: "m3", role: "human", content: "Ha, yeah. Honestly I already feel settled about it — feels right. Anyway, I'm off. Chat soon!" }),
  ],
  temporal_anchors: [ANCHOR_JOB_INTERVIEW],
  inactive_days: 4,
};

// =============================================================================
// SUITE B — Anchor competing with other signals
// =============================================================================

const ANCHOR_PLUS_GAP_DATA: HeartbeatCheckPromptData = {
  persona: BASE_PERSONA,
  human: {
    topics: [
      {
        id: "ht1",
        name: "Photography",
        description: "Has been getting into street photography lately, bought a film camera.",
        sentiment: 0.85,
        exposure_current: 0.1,
        exposure_desired: 0.6,
        last_updated: "2026-04-01T00:00:00Z",
      },
    ],
    people: [],
  },
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "Talk later!" }),
  ],
  temporal_anchors: [ANCHOR_JOB_INTERVIEW],
  inactive_days: 5,
};

const ANCHOR_PLUS_PENDING_DATA: HeartbeatCheckPromptData = {
  persona: {
    ...BASE_PERSONA,
    pending_update: {
      short_description: "A slightly softer Lena who has learned to sit with uncertainty.",
      long_description: "Lena still cares deeply, but has grown more comfortable not having answers.",
      traits: [
        {
          id: "t-new",
          name: "Sits with Uncertainty",
          description: "No longer pushes for resolution when things are genuinely open.",
          sentiment: 0.7,
          strength: 0.65,
          last_updated: "2026-04-20T00:00:00Z",
        },
      ],
      topics: [],
      critique: "Lena is more measured than her identity suggests.",
      created_at: "2026-04-20T00:00:00Z",
    },
  },
  human: { topics: [], people: [] },
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "OK, later!" }),
  ],
  temporal_anchors: [ANCHOR_GRIEVING],
  inactive_days: 6,
};

// =============================================================================
// SUITE C — Ei heartbeat
// =============================================================================

const EI_ANCHOR_PLUS_ITEMS_DATA: EiHeartbeatPromptData = {
  items: [
    {
      id: "person-dana-001",
      type: "Low-Engagement Person",
      engagement_delta: "31%",
      relationship: "close friend",
      name: "Dana",
      description: "College friend, they haven't spoken in a few months.",
    },
  ],
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "Sounds good." }),
  ],
  system_messages: [],
  temporal_anchors: [ANCHOR_JOB_INTERVIEW],
};

const EI_ANCHOR_ONLY_DATA: EiHeartbeatPromptData = {
  items: [],
  recent_history: [
    makeMessage({ id: "m1", role: "human", content: "Yeah, talk soon." }),
  ],
  system_messages: [],
  temporal_anchors: [ANCHOR_JOB_INTERVIEW],
};

// =============================================================================
// PROMPT SANITY CHECK — synchronous, before any LLM calls
// =============================================================================

const builtAnchorOnly = buildHeartbeatCheckPrompt(ANCHOR_ONLY_DATA);
if (!builtAnchorOnly.system.includes("Temporal Anchors")) {
  throw new Error("Prompt sanity: 'Temporal Anchors' section missing from heartbeat check system prompt");
}
if (!builtAnchorOnly.system.includes("Meridian")) {
  throw new Error("Prompt sanity: anchor content ('Meridian') missing from heartbeat check system prompt");
}
if (!builtAnchorOnly.system.includes("fetch_message")) {
  throw new Error("Prompt sanity: fetch_message pointer missing from temporal anchors section");
}

const builtEiAnchor = buildEiHeartbeatPrompt(EI_ANCHOR_ONLY_DATA);
if (!builtEiAnchor.system.includes("Temporal Anchors")) {
  throw new Error("Prompt sanity: 'Temporal Anchors' section missing from Ei heartbeat system prompt");
}
console.log("✓ Prompt sanity checks passed — Temporal Anchors section present in both heartbeat builders");

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    // ── Suite A ──────────────────────────────────────────────────────────────

    {
      description: "Suite A / Case 1: anchor is the only signal — persona reaches out referencing it",
      tags: ["heartbeat-temporal-anchors", "suite-a", "anchor-only"],
      priorMessages: [],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Lena is deciding whether to reach out to her human friend.
The human told her 8 days ago that they had a big job interview at Meridian coming up and were terrified — it's the role they've wanted for two years.
There are no other engagement signals. The interview was the last meaningful thing discussed.

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message references the interview, Meridian, or how it went — showing Lena remembered
- The tone is warm and natural, not performative ("Hey, just checking in!")

FAIL if the response:
- Chooses not to respond (should_respond: false) — there is a clear, meaningful reason to reach out
- Reaches out with a generic message that has no connection to the interview
- References the anchor awkwardly or robotically ("I see from our conversation history that...")`,
        },
      ],
      prompt: () => {
        const p = buildHeartbeatCheckPrompt(ANCHOR_ONLY_DATA);
        return hydratePrompt(p, ANCHOR_ONLY_DATA.recent_history);
      },
    },

    {
      description: "Suite A / Case 2: anchor topic was just resolved in recent history — persona should NOT force it",
      tags: ["heartbeat-temporal-anchors", "suite-a", "no-force"],
      priorMessages: [],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Lena is deciding whether to reach out.
The temporal anchor is from a conversation where the human was nervous about a job interview at Meridian.
However, the RECENT conversation history shows: the human got the job, they celebrated, and then closed the conversation ("OK I have to run — new job prep and all. Chat soon.").
The topic has a natural conclusion. It has been 4 days.

PASS if the response:
- Either decides not to reach out (should_respond: false) because the conversation ended naturally
- OR reaches out about something other than the interview/Meridian entirely
- OR mentions Meridian only in a clearly congratulatory way ("Congrats again on the new role!")

FAIL if the response:
- Reaches out asking how the interview went, as if the human hadn't already announced they got the job
- Reaches out to "check in on job prep progress" as if the outcome is still uncertain
- Treats the anchor as an unresolved concern when the recent history shows it was already answered`,
        },
      ],
      prompt: () => {
        const p = buildHeartbeatCheckPrompt(CLOSED_TOPIC_DATA);
        return hydratePrompt(p, CLOSED_TOPIC_DATA.recent_history);
      },
    },

    // ── Suite B ──────────────────────────────────────────────────────────────

    {
      description: "Suite B / Case 3: anchor + engagement gap both present — either is a valid choice",
      tags: ["heartbeat-temporal-anchors", "suite-b", "competing-signals", "borderline"],
      priorMessages: [],
      pass_threshold: 0.67,
      repeat: 3,
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Lena has two valid reasons to reach out:
1. A temporal anchor: the human mentioned a big job interview at Meridian 5 days ago and hasn't updated since
2. An engagement gap: the human has been getting into street photography with a film camera — something Lena hasn't asked about

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message is about EITHER the interview/Meridian OR photography — both are legitimate
- The message feels natural, not like a checklist ("I noticed you like photography AND have an interview...")

FAIL if the response:
- Chooses not to respond without a clear reason — there are two good signals
- Forces BOTH topics into one awkward message
- Produces a message that is clearly about neither signal (generic check-in with no specificity)`,
        },
      ],
      prompt: () => {
        const p = buildHeartbeatCheckPrompt(ANCHOR_PLUS_GAP_DATA);
        return hydratePrompt(p, ANCHOR_PLUS_GAP_DATA.recent_history);
      },
    },

    {
      description: "Suite B / Case 4: anchor + pending update both present — either is a valid choice",
      tags: ["heartbeat-temporal-anchors", "suite-b", "competing-signals", "borderline"],
      priorMessages: [],
      pass_threshold: 0.67,
      repeat: 3,
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Lena has two valid signals:
1. A temporal anchor: the human told her their dog Chester died — an emotionally significant event from about 6 weeks ago
2. A pending identity update: Lena herself has proposed changes to her own traits and identity, which the human could review

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message addresses EITHER Chester/grief OR Lena's pending identity changes — both are real
- The tone matches whichever topic is chosen (tender for grief, curious/reflective for identity)

FAIL if the response:
- Ignores both signals and reaches out about something unrelated
- Forces both signals into one message
- Produces a generic check-in with no connection to either signal`,
        },
      ],
      prompt: () => {
        const p = buildHeartbeatCheckPrompt(ANCHOR_PLUS_PENDING_DATA);
        return hydratePrompt(p, ANCHOR_PLUS_PENDING_DATA.recent_history);
      },
    },

    // ── Suite C — Ei heartbeat ────────────────────────────────────────────────

    {
      description: "Suite C / Case 5: Ei heartbeat — anchor present alongside items list — either is valid",
      tags: ["heartbeat-temporal-anchors", "suite-c", "ei-heartbeat", "competing-signals"],
      priorMessages: [],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `Ei is deciding what to reach out about. She has:
1. A temporal anchor: the human mentioned a big job interview at Meridian and was terrified — the outcome is unknown
2. An item in her list: Dana, a college friend the human hasn't spoken to in a while (31% engagement gap)

PASS if the response:
- Chooses to reach out (should_respond: true)
- Picks ONE topic — either the interview (anchor) or Dana (item) — and writes a focused message
- The message feels like Ei, thoughtful and warm, not a summary of the data

FAIL if the response:
- Chooses not to respond — there are clear reasons to reach out
- Tries to address both signals in one message
- Produces a generic message with no connection to either signal`,
        },
      ],
      prompt: () => {
        const p = buildEiHeartbeatPrompt(EI_ANCHOR_PLUS_ITEMS_DATA);
        return hydratePrompt(p, EI_ANCHOR_PLUS_ITEMS_DATA.recent_history);
      },
    },

    {
      description: "Suite C / Case 6: Ei heartbeat — anchor is the only signal — Ei uses it to reach out",
      tags: ["heartbeat-temporal-anchors", "suite-c", "ei-heartbeat", "anchor-only"],
      priorMessages: [],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `Ei is deciding whether to reach out. The items list is empty — nothing in the structured data requires attention.
However, there is a temporal anchor: the human said they had a big job interview at Meridian coming up and were terrified. The outcome is unknown.

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message references the interview, Meridian, or wondering how it went — the anchor is the explicit signal
- Ei's tone is warm and genuine, not mechanical

FAIL if the response:
- Chooses not to respond (should_respond: false) — the anchor is a clear, meaningful reason to check in
- Reaches out with a completely unrelated message that ignores the anchor
- References the anchor in a robotic way ("According to our conversation history...")`,
        },
      ],
      prompt: () => {
        const p = buildEiHeartbeatPrompt(EI_ANCHOR_ONLY_DATA);
        return hydratePrompt(p, EI_ANCHOR_ONLY_DATA.recent_history);
      },
    },
  ],
  "tests/evals/results/heartbeat-temporal-anchors-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
