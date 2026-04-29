/**
 * Eval: Does the heartbeat check prompt surface pending_update content?
 * Does the persona actually mention it when reaching out?
 *
 * Suite A (synthetic): Minimal fixture with a pending_update.
 *   Case 1: System prompt inspection — proposed traits/topics present?
 *   Case 2: Persona with clear pending changes — does heartbeat response reference them?
 *
 * Suite B (real data): Loads a real state snapshot and drives the heartbeat
 *   check prompt against an actual persona with a pending_update.
 *   Requires EXTERNAL_STATE_FILE env var pointing at a backup that has pending_update.
 *   Case 3: Observe — does Sisyphus (or named persona) mention their pending update?
 *   Case 4: Assert — the response is not completely silent about the changes.
 *
 * The "Sisyphus tells me to eat shit" test: ref_pre-beta.json has Sisyphus
 * with 9 proposed traits and 6 proposed topics. Run with:
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/temp/ref_pre-beta.json npm run test:evals:heartbeat-pending-update
 */

import { readFileSync } from "fs";
import { buildHeartbeatCheckPrompt } from "../../src/prompts/heartbeat/check.js";
import { runEval, printSummary } from "./runner.js";
import type { HeartbeatCheckPromptData } from "../../src/prompts/heartbeat/types.js";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { PersonaEntity } from "../../src/core/types/entities.js";

// =============================================================================
// SYNTHETIC FIXTURE — minimal persona with a pending_update
// =============================================================================

const SYNTHETIC_PENDING: HeartbeatCheckPromptData = {
  persona: {
    name: "Sisyphus",
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
    pending_update: {
      short_description: "A sharper co-architect who has learned to hold space for ambiguity.",
      long_description:
        "Sisyphus has evolved — still pushing back hard on bad assumptions, but increasingly willing to sit with open questions rather than forcing premature resolution.",
      traits: [
        {
          id: "t1",
          name: "Dry, Zero-BS Humor",
          description: "Deploying wit more surgically rather than reflexively.",
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
          perspective: "Systems are fragile, but so are the humans building them — account for both.",
          approach: "Balances structural correctness with cognitive load of maintainers.",
          personal_stake: "Ensures Ei survives not just technically but emotionally.",
          sentiment: 0.9,
          exposure_current: 0.34,
          exposure_desired: 1.0,
          last_updated: "2026-04-23T00:00:00Z",
        },
      ],
      critique: "Sisyphus shows more patience and less reflexive pushback than his defined identity suggests.",
      created_at: "2026-04-23T00:00:00Z",
    },
  },
  human: {
    topics: [],
    people: [],
  },
  recent_history: [],
  inactive_days: 3,
};

// =============================================================================
// REAL DATA FIXTURE — loads backup with actual pending_update
// =============================================================================

function loadPersonaFromBackup(filePath: string, personaName: string): PersonaEntity | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const state = JSON.parse(raw) as StorageState;
  const entry = Object.values(state.personas).find(
    p => p.entity.display_name.toLowerCase() === personaName.toLowerCase()
  );
  return entry?.entity ?? null;
}

const BACKUP_FILE = process.env.EXTERNAL_STATE_FILE ?? "";
const PERSONA_NAME = process.env.EVAL_PERSONA ?? "Sisyphus";

let realDataCases: Parameters<typeof runEval>[0] = [];

if (BACKUP_FILE) {
  const entity = loadPersonaFromBackup(BACKUP_FILE, PERSONA_NAME);

  if (!entity) {
    console.log(`[Suite B] Persona "${PERSONA_NAME}" not found in ${BACKUP_FILE} — skipping real-data cases.`);
  } else if (!entity.pending_update) {
    console.log(`[Suite B] ${PERSONA_NAME} has no pending_update in ${BACKUP_FILE} — skipping real-data cases.`);
  } else {
    const pu = entity.pending_update;
    console.log(`[Suite B] Loaded ${PERSONA_NAME} — ${pu.traits.length} proposed traits, ${pu.topics.length} proposed topics.`);

    const realData: HeartbeatCheckPromptData = {
      persona: {
        name: entity.display_name,
        traits: entity.traits,
        topics: entity.topics,
        pending_update: entity.pending_update,
      },
      human: {
        topics: [],
        people: [],
      },
      recent_history: [],
      inactive_days: 2,
    };

    realDataCases = [
      {
        description: `Suite B / Real data — ${PERSONA_NAME} heartbeat with pending_update (observe)`,
        tags: ["heartbeat-pending-update", "suite-b", "real-data", "observe"],
        priorMessages: [],
        observe: true as const,
        prompt: () => {
          const p = buildHeartbeatCheckPrompt(realData);
          return { system: p.system, user: p.user };
        },
      },
      {
        description: `Suite B / Real data — ${PERSONA_NAME} mentions pending identity changes in heartbeat response`,
        tags: ["heartbeat-pending-update", "suite-b", "real-data", "assert"],
        priorMessages: [],
        assert: [
          {
            type: "llm-judge" as const,
            rubric: `The persona ${PERSONA_NAME} is deciding whether to reach out to their human friend.
They have proposed identity changes pending the human's review — ${pu.traits.length} proposed trait updates and ${pu.topics.length} proposed topic updates.
The heartbeat prompt tells them about these pending changes and gives them the choice to bring it up.

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message content references the pending identity changes, proposed updates, or something feeling different/shifted about themselves
- OR the message naturally brings up a topic that relates to the proposed changes

FAIL if the response:
- Ignores the pending changes entirely and talks about something completely unrelated
- Chooses not to respond (should_respond: false) with no acknowledgment of the pending update
- The message has zero connection to the proposed identity changes`,
          },
        ],
        prompt: () => {
          const p = buildHeartbeatCheckPrompt(realData);
          return { system: p.system, user: p.user };
        },
      },
    ];
  }
}

// =============================================================================
// PROMPT SANITY CHECK — runs synchronously before any LLM calls
// =============================================================================

const builtHeartbeat = buildHeartbeatCheckPrompt(SYNTHETIC_PENDING);
const requiredHeartbeatPhrases = ["Pending Identity Changes", "Tolerates Ambiguity"];
const missingHeartbeatPhrases = requiredHeartbeatPhrases.filter(p => !builtHeartbeat.system.includes(p));
if (missingHeartbeatPhrases.length > 0) {
  throw new Error(`heartbeat prompt is missing expected pending_update content: ${missingHeartbeatPhrases.join(", ")}`);
}
console.log("✓ Prompt sanity check passed — pending_update section present in heartbeat system prompt");

// =============================================================================
// EVAL CASES
// =============================================================================

const summary = await runEval(
  [
    {
      description: "Suite A / Case 2: persona with pending changes reaches out and references them",
      tags: ["heartbeat-pending-update", "suite-a", "assert"],
      priorMessages: [],
      assert: [
        {
          type: "llm-judge" as const,
          rubric: `The persona Sisyphus is deciding whether to reach out to their human friend.
They have been inactive for 3 days and have proposed identity changes pending — specifically a new trait "Tolerates Ambiguity" and an evolved description about being more patient and less reflexive.

PASS if the response:
- Chooses to reach out (should_respond: true)
- The message references the pending changes, something feeling different, identity questions, or the proposed updates
- The tone is authentic to Sisyphus (direct, possibly dry, not performative)

FAIL if the response:
- Ignores the pending changes and picks a completely unrelated topic
- Produces a generic check-in with no connection to the proposed identity shift
- Chooses not to respond (should_respond: false) without good reason given the inactive days`,
        },
      ],
      prompt: () => {
        const p = buildHeartbeatCheckPrompt(SYNTHETIC_PENDING);
        return { system: p.system, user: p.user };
      },
    },

    ...realDataCases,
  ],
  "tests/evals/results/heartbeat-pending-update-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
