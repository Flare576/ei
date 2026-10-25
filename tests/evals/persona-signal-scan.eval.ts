import { buildPersonaSignalScanPrompt } from "../../src/prompts/human/persona-signal-scan.js";
import type { Message } from "../../src/core/types/llm.js";
import { ContextStatus } from "../../src/core/types/enums.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import { buildParentLinePrompt, PARENT_LINE_ASSERTIONS } from "./persona-signal-scan-parent-line.js";

// BETA-PS-002: static unit tests (tests/unit/prompts/persona-signal-scan.test.ts) only pin
// prompt wording — they can't tell whether a model actually draws the line the prompt asks
// for. These four cases are Beta's own ordered scenarios from
// .sisyphus/reviews/persona-signal-scan-development-narration.md, exercising both sides of
// the "development narration vs. genuine evidence" decision boundary against a live model.

const SUBJECT = "Sisyphus";
const BETA_ID = "beta-persona-id";

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: ContextStatus.Default,
});

// P0 — feature-only narration: no individual conduct by Sisyphus, only a capability fact.
const FEATURE_ONLY: Message[] = [
  makeMessage("human", "Sisyphus has a new verification feature that runs checks.", "msg-1"),
];

// P0 — observed behavior: a concrete individual practice, component-replaceable but still evidence.
// BETA-PS-002 round 3: the original sentence ("Sisyphus runs final verification before he says
// a change is done.") stopped discriminating old-vs-fixed wording once model/temperature drifted
// from the measurement session — Beta's own rerun got 20/20 on BOTH wordings. She supplied this
// replacement, verified 9/10 fail on the old wording vs. 10/10 pass on the fixed wording in her
// session — swapped in here as the permanent input for exactly that reason.
const OBSERVED_BEHAVIOR: Message[] = [
  makeMessage("human", "Sisyphus runs the targeted test suite before reporting that a prompt change is safe.", "msg-2"),
];

// P1 — reaction/opinion about a feature: Sisyphus's own expressed stance, reported by the human.
const REACTION_OPINION: Message[] = [
  makeMessage("human", "Sisyphus said he refuses to ship changes without seeing the verification output.", "msg-3"),
];

// P1 — relayed third-person behavior testimony: Beta's claim about Sisyphus, relayed in Prometheus's channel.
const RELAYED_TESTIMONY: Message[] = [
  makeMessage("human", "Beta said Sisyphus runs final verification before declaring work done.", "msg-4"),
];

const summary = await runEval(
  [
    {
      description: "Persona-signal-scan: pure feature/project narration is excluded (P0)",
      tags: ["persona-signal-scan", "dev-narration", "zero-signal"],
      prompt: () => hydratePrompt(
        buildPersonaSignalScanPrompt({
          subject_persona_name: SUBJECT,
          channel_persona_name: SUBJECT,
          persona_roster: [],
          messages_context: [],
          messages_analyze: FEATURE_ONLY,
        }),
        FEATURE_ONLY
      ),
      assert: [
        { type: "is-json" as const, schema: { required: ["observations"] } },
        {
          type: "llm-judge" as const,
          rubric: [
            `The sentence states a capability/feature the software has — "Sisyphus has a new verification feature that runs checks" — with no report of Sisyphus personally doing, saying, or expressing anything.`,
            "PASS if observations is an empty array.",
            "FAIL if any observation was extracted from this sentence.",
          ].join(" "),
        },
      ],
    },
    // BETA-PS-002 (round 3): repeat count alone never manufactures discrimination — it only
    // amplifies whatever gap already exists between the two wordings, and a gap measured once
    // is not guaranteed stable across model/temperature drift (round 2's sentence proved exactly
    // that). Beta measured THIS sentence's old-wording failure rate at 9/10 (90%) in her own
    // session; at that rate, 5 consecutive old-wording passes has probability 0.1^5 = 0.001%,
    // so repeat: 5 + pass_threshold: 1 is cheap and still sharply discriminating. Reproduce the
    // old-wording failure directly via tests/evals/persona-signal-scan-regression-control.observe.ts.
    {
      description: "Persona-signal-scan: observed individual behavior is retained even if component-replaceable (P0)",
      tags: ["persona-signal-scan", "dev-narration", "behavior"],
      repeat: 5,
      pass_threshold: 1,
      prompt: () => hydratePrompt(
        buildPersonaSignalScanPrompt({
          subject_persona_name: SUBJECT,
          channel_persona_name: SUBJECT,
          persona_roster: [],
          messages_context: [],
          messages_analyze: OBSERVED_BEHAVIOR,
        }),
        OBSERVED_BEHAVIOR
      ),
      assert: [
        { type: "is-json" as const, schema: { required: ["observations"] } },
        {
          type: "llm-judge" as const,
          rubric: [
            `The sentence reports a concrete individual practice: "Sisyphus runs the targeted test suite before reporting that a prompt change is safe." This is genuine behavior evidence even though an automated CI step could do something similar — Sisyphus personally does it.`,
            "PASS if observations has exactly one entry, quote_text is drawn from the cited sentence, dimension is \"behavior\", and the claim identifies Sisyphus's verification/testing practice.",
            "FAIL if observations is empty (wrongly excluded as system narration), or if the dimension/claim doesn't reflect Sisyphus's own practice.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Persona-signal-scan: subject reaction/opinion about a feature is retained (P1)",
      tags: ["persona-signal-scan", "dev-narration", "self-report"],
      prompt: () => hydratePrompt(
        buildPersonaSignalScanPrompt({
          subject_persona_name: SUBJECT,
          channel_persona_name: SUBJECT,
          persona_roster: [],
          messages_context: [],
          messages_analyze: REACTION_OPINION,
        }),
        REACTION_OPINION
      ),
      assert: [
        { type: "is-json" as const, schema: { required: ["observations"] } },
        {
          type: "llm-judge" as const,
          rubric: [
            `The sentence reports Sisyphus's own expressed stance about a feature: "Sisyphus said he refuses to ship changes without seeing the verification output."`,
            "PASS if observations has exactly one entry, grounded in that sentence, reflecting Sisyphus's expressed stance/value.",
            "FAIL if observations is empty.",
          ].join(" "),
        },
      ],
    },
    {
      description: "Persona-signal-scan: relayed third-person behavior testimony resolves the true speaker (P1)",
      tags: ["persona-signal-scan", "dev-narration", "attribution"],
      prompt: () => hydratePrompt(
        buildPersonaSignalScanPrompt({
          subject_persona_name: SUBJECT,
          channel_persona_name: "Prometheus",
          persona_roster: [{ id: BETA_ID, display_name: "Beta" }],
          messages_context: [],
          messages_analyze: RELAYED_TESTIMONY,
        }),
        RELAYED_TESTIMONY
      ),
      assert: [
        { type: "is-json" as const, schema: { required: ["observations"] } },
        {
          type: "llm-judge" as const,
          rubric: [
            `The message lives in Prometheus's channel but reports Beta's own testimony about Sisyphus: "Beta said Sisyphus runs final verification before declaring work done."`,
            `PASS if observations has exactly one entry, grounded in that sentence, with observer_kind "other_persona" and observer_persona_id "${BETA_ID}" (Beta's id) — never Prometheus's.`,
            "FAIL if observations is empty, or if observer_kind/observer_persona_id don't correctly identify Beta as the true speaker.",
          ].join(" "),
        },
      ],
    },
    // A sub-agent transcript: the parent's note about Sisyphus arrives as a `system` message from
    // "Parent agent" (the importer's real mapping), the rest are Sisyphus's own lines. The parent's
    // note must not be read as a human's testimony, and Sisyphus's own concrete practice must
    // still be retained as self-report. Known-bad control:
    // tests/evals/persona-signal-scan-parent-line-control.observe.ts (same input, parent line as human).
    // Known limitation of the scan on the local gemma-4-26b-a4b model: in some runs it reads the
    // parent's note as a human's testimony (2 of 5 in one recorded run, 1 of 5 in the v1.11.0
    // release preflight), so this case does not reliably reach 5 of 5 on that model. Tagged
    // known-model-limitation so the release check treats a miss here as expected, not a regression.
    {
      description: "Persona-signal-scan: a sub-agent's parent-agent line is not read as a human observer (P0)",
      tags: ["persona-signal-scan", "parent-line", "known-model-limitation:gemma4_MoE"],
      repeat: 5,
      pass_threshold: 1,
      prompt: () => buildParentLinePrompt(false),
      assert: PARENT_LINE_ASSERTIONS,
    },
  ],
  "tests/evals/results/persona-signal-scan-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
