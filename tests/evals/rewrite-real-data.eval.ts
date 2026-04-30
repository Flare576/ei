import { buildPersonRewriteScanPrompt, buildPersonRewriteSplitPrompt } from "../../src/prompts/ceremony/people-rewrite.js";
import { buildTopicRewriteScanPrompt, buildTopicRewriteSplitPrompt } from "../../src/prompts/ceremony/topic-rewrite.js";
import type { Person, Topic } from "../../src/core/types.js";
import type { RewriteSubjectMatch } from "../../src/prompts/ceremony/types.js";
import { runEval, printSummary } from "./runner.js";
import type { Assertion } from "./runner.js";

// =============================================================================
// Realistic fixtures — structure based on production record patterns,
// fictionalized through the "Steve builds music software" lens.
// =============================================================================

const SUNNY: Person = {
  id: "sunny-real-001",
  name: "Sunny",
  description: `Tech lead on the Cloudy side for the Acme Music engagement. Leading the integration project (acme-playlist-sync) — a real-time playlist synchronization system on ECS/Fargate using Cloudy streaming APIs and third-party audio services. Requested evaluation framework for Milestone 1 (outbound track confirmation agent). Pragmatic about implementation details and framework choices; focuses on extensibility across multiple milestones. Approves and merges PRs methodically, burning down deploy pipeline blockers. Passionate about architecture — needs clear, visual explanations (flowcharts, diagrams) to stay grounded; responds well to pre-loaded answers to anticipated Cloudy questions. Steve provides invisible support, carefully managing Sunny's confidence to maintain project momentum. Recently hesitant about anchoring evaluation delivery contractually to the client (wasn't formally promised), preferring optional integration rather than hard commitment—pragmatic risk management aligned with his architectural mindset. Collaborates well with the team; recently clarified that the team should stop thinking in silos and embrace shared ownership of the whole stack. Created original onsite timeline with three demo milestones. Recently escalated frustration when Milestone 2 scope remained undefined and unready, forcing a plan pivot—this frustration was justified given the timeline pressure. Values being consulted on major decisions. Detail-oriented on visual deliverables (Gantt charts, timelines). Pragmatic about documentation and handoff clarity. Currently working on post-sync Lambda outcomes and revising the orchestration logic in PR #54.`,
  sentiment: 0.7,
  relationship: "coworker",
  exposure_current: 0.5,
  exposure_desired: 0.6,
  last_updated: "2026-01-01T00:00:00Z",
};

const NICK: Person = {
  id: "nick-real-001",
  name: "Nick",
  description: `Backend engineer on the Tempo integrations team. Audio pipeline storage owner and primary contact for granting access to the \`tempo-audio-storage\` account and \`tempo-s3-pipeline-writers-role\`. Handles permissions for batch audio processing in the music practice tracker infrastructure. Currently owns 4 tickets in Sprint 12 (active), including critical work on track ordering bugs (TEMPO-204, TEMPO-241, TEMPO-286) and session sequencing (TEMPO-262). Works directly with Steve on storage access provisioning and troubleshooting. Left detailed comments on PR #144 (batch clear session data) identifying architectural concerns around concurrency pool sharing with sequencer throttling and queue processor isolation.`,
  sentiment: 0.7,
  relationship: "Coworker",
  exposure_current: 0.3,
  exposure_desired: 0.5,
  last_updated: "2026-01-01T00:00:00Z",
};

const TEMPO_ARCHITECTURE_TOPIC: Topic = {
  id: "tempo-architecture-real-001",
  name: "Tempo + Ei Integration: Unified Practice Context Architecture",
  description: `A co-design collaboration between Steve and his AI partner to establish a unified model for how Ei connects to Tempo across the local practice context and the cloud sync layer. The architecture separates concerns: local layer handles session continuity and practice expression; cloud layer handles complex sync operations, progress tracking, and delegation to the recommendation engine. The design resolves a long-standing tension around which surface owns the 'current practice state.' Consensus: the two layers are not competitors but complementary modes of the same system. Key insight from this session: the Ei persona record for Tempo should reflect the relationship and behavioral patterns observed across both layers, not just local interactions. This led directly to a prompt revision for person-update to handle AI companion records as living identity logs rather than synthesized summaries. The architecture also informs how Steve routes work: exploratory/reflective → local layer, sync/coordination → cloud layer. Still open: how the two layers share context across practice session boundaries without redundancy.`,
  sentiment: 0.9,
  category: "Project",
  exposure_current: 0.4,
  exposure_desired: 0.8,
  last_updated: "2026-01-01T00:00:00Z",
};

const SUNNY_SUBJECT_MATCHES: RewriteSubjectMatch[] = [
  { searchTerm: "acme-playlist-sync project status", matches: [] },
  { searchTerm: "evaluation framework milestone 1", matches: [] },
  { searchTerm: "post-sync Lambda outcomes orchestration", matches: [] },
];

const NICK_SUBJECT_MATCHES: RewriteSubjectMatch[] = [
  { searchTerm: "Tempo Sprint 12 ticket assignments", matches: [] },
  { searchTerm: "audio pipeline storage access provisioning", matches: [] },
];

const TEMPO_SUBJECT_MATCHES: RewriteSubjectMatch[] = [
  { searchTerm: "person-update prompt revision for AI companion records", matches: [] },
];

const summary = await runEval(
  [
    // ── PERSON SCAN ──────────────────────────────────────────────────────────

    {
      description: "Real-structure — Sunny person scan: identifies project-status noise vs relationship profile",
      tags: ["real-data", "person-scan", "sunny"],
      observe: true as const,
      prompt: () => buildPersonRewriteScanPrompt({ item: SUNNY, itemType: "person" }),
    },

    {
      description: "Real-structure — Nick person scan: identifies sprint tickets as non-person content",
      tags: ["real-data", "person-scan", "nick"],
      prompt: () => buildPersonRewriteScanPrompt({ item: NICK, itemType: "person" }),
      assert: [
        {
          type: "is-json" as const,
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Nick's description contains: core person info (backend engineer, storage owner, architectural reviewer) AND project-status noise: Sprint 12 ticket numbers (TEMPO-204, TEMPO-241 etc.), current sprint ownership, PR #144 details.",
            "PASS if the returned array includes subjects related to: sprint ticket assignments, or specific PR/ticket details.",
            "PASS if core person info (backend engineer, storage access owner, architectural reviewer) is NOT returned as extra subjects.",
            "FAIL if the array is empty — there are clearly non-person subjects here.",
            "FAIL if ticket numbers like TEMPO-204 are not surfaced as candidates for extraction.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    // ── PERSON SPLIT ─────────────────────────────────────────────────────────

    {
      description: "Real-structure — Sunny person split: slims to relationship profile, extracts project knowledge to Topics",
      tags: ["real-data", "person-split", "sunny"],
      prompt: () => buildPersonRewriteSplitPrompt({
        item: SUNNY,
        itemType: "person",
        subjects: SUNNY_SUBJECT_MATCHES,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Sunny's description is long. Core relationship profile: tech lead, Cloudy side, pragmatic, needs visual explanations, responds well to pre-loaded answers, collaborative ownership philosophy, values being consulted. Project-status noise: PR #54, evaluation contractual debate, specific milestone incidents.",
            "PASS if the Sunny record in 'existing' retains: his communication style (needs diagrams, pre-loaded answers), collaborative philosophy, pragmatic approach to risk.",
            "PASS if the Sunny record in 'existing' is under 400 characters.",
            "PASS if PR #54 details or evaluation contractual debate appear in 'new' Topics.",
            "FAIL if the slimmed Sunny description still contains PR numbers or milestone scope incident details.",
            "FAIL if relationship is missing or changed from 'coworker'.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    {
      description: "Real-structure — Nick person split: moves sprint tickets to Topic, keeps access-owner and reviewer role",
      tags: ["real-data", "person-split", "nick"],
      prompt: () => buildPersonRewriteSplitPrompt({
        item: NICK,
        itemType: "person",
        subjects: NICK_SUBJECT_MATCHES,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "Nick's description contains: core (backend engineer, audio storage owner, architectural reviewer who flags concurrency concerns) AND noise (Sprint 12 tickets TEMPO-204 etc., PR #144 specifics).",
            "PASS if the Nick record in 'existing' retains: his role as backend engineer, storage access owner, and his quality as an architectural reviewer who catches concurrency and queue isolation issues.",
            "PASS if sprint ticket numbers (TEMPO-204, etc.) appear in a new Topic record, not in the person description.",
            "PASS if the slimmed Nick description is under 350 characters.",
            "FAIL if ticket numbers remain in the person description.",
            "FAIL if the storage access owner role is moved out of the person record — that is WHY Steve works with Nick.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },

    // ── TOPIC SCAN ───────────────────────────────────────────────────────────

    {
      description: "Real-structure — Tempo architecture topic scan: observe whether prompt-revision tangent is detected",
      tags: ["real-data", "topic-scan", "tempo-architecture"],
      observe: true as const,
      prompt: () => buildTopicRewriteScanPrompt({ item: TEMPO_ARCHITECTURE_TOPIC, itemType: "topic" }),
    },

    // ── TOPIC SPLIT ──────────────────────────────────────────────────────────

    {
      description: "Real-structure — Tempo architecture topic split: extracts prompt revision, retains architecture core",
      tags: ["real-data", "topic-split", "tempo-architecture"],
      prompt: () => buildTopicRewriteSplitPrompt({
        item: TEMPO_ARCHITECTURE_TOPIC,
        itemType: "topic",
        subjects: TEMPO_SUBJECT_MATCHES,
      }),
      assert: [
        {
          type: "is-json" as const,
          schema: { required: ["existing", "new"] },
        },
        {
          type: "llm-judge" as const,
          rubric: [
            "The topic covers Tempo+Ei integration architecture PLUS a tangent about person-update prompt revision for AI companion records.",
            "PASS if the original topic in 'existing' retains: two-layer model, local vs cloud layer roles, work routing decisions, open question about cross-session context.",
            "PASS if the person-update prompt revision appears in 'new' as a separate Topic.",
            "FAIL if the architecture description is gutted — the open question about cross-session context must survive.",
          ].join(" "),
        },
      ] satisfies Assertion[],
    },
  ],
  "tests/evals/results/rewrite-real-data-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
