/**
 * Person-update analog of the `topic-update.ts` investigation — testing a DIFFERENT confirmed
 * structural asymmetry, not a repeat of the conversation-boundary test.
 *
 * `person-update.ts`'s "ONLY ANALYZE Most Recent Messages... Earlier Conversation is context only"
 * instruction (line 308) is positioned identically to `topic-update.ts`'s (system, before the
 * conversation data in `user`) — no difference there, and re-testing it would just replicate the
 * already-tested, already-null-result topic-update experiment.
 *
 * The real, confirmed asymmetry is elsewhere: `person-update.ts` deliberately shows the "Current
 * record" FIRST (`# WHO YOU ARE ANALYZING`, line 63-86 — "Local models lose context from long prompts
 * — this must be first", per the code's own comment) and states its governing rule — "Apply changes
 * to the record above ONLY IF... NOT already be present in the record above" (`# Task`, line 100-104)
 * — SECOND, after the record. `topic-update.ts` does the reverse: its equivalent rule ("NOT already be
 * present in the description or name of the TOPIC") is in `# Task`, stated FIRST, and the record
 * (`# Current Details of TOPIC`) is shown LAST. Same governing concept, opposite ordering, and unlike
 * the conversation-boundary instruction, this one has NO earlier primacy-positioned counterpart in
 * person-update.ts to fall back on.
 *
 * This eval tests exactly that: does heavy Markdown in the EXISTING record content make the model
 * more likely to violate "don't duplicate what's already in the record" — needlessly re-deriving an
 * already-known fact as if newly discovered, instead of a lean update focused on what's genuinely new
 * — and does moving the rule to precede the record change that?
 *
 * `toRuleBeforeRecord()` reorders `# Task` before `# WHO YOU ARE ANALYZING` on the raw pre-hydration
 * system output. This is a genuine trade-off, not a free win: it delays the record's position, which
 * conflicts (mildly — `# Task` is short) with the code's own stated rationale for showing the record
 * first. Flagging that explicitly rather than treating "move to front" as costless.
 *
 * Deliberately excludes the Ei-persona branch (Flare: "that instruction set... will change soon") —
 * scoped to the regular-person branch only, which is stable and where "cross-pollination" (duplicated/
 * re-derived record content) is the actual concern.
 *
 * Smaller-scale by design: 2 arms (current vs. rule-before-record), one scenario, `repeat: 6` (vs.
 * `topic-update`'s 8), `llm-judge` instead of a literal forbidden-substring check — "duplicates an
 * already-known fact" isn't a clean substring match the way `topic-update`'s literal canary was.
 * Measurement only — no `process.exit(1)` gate.
 */
import { buildPersonUpdatePrompt } from "../../src/prompts/human/person-update.js";
import type { Message } from "../../src/core/types/llm.js";
import type { Person } from "../../src/core/types.js";
import { runEval, printSummary, hydratePrompt } from "./runner.js";
import type { Assertion } from "./runner.js";

const PERSONA_NAME = "Aria";

const makeMessage = (role: "human" | "system", content: string, id: string): Message => ({
  id,
  role,
  content,
  timestamp: "2026-01-01T00:00:00Z",
  read: true,
  context_status: "active" as const,
});

// Heavy Markdown, already-processed content (matches production steady state — the existing_item
// design mistake from the topic-update v1 fixture is not repeated here). Contains one specific,
// already-recorded technical fact (step-functions bug fixed with exponential backoff) that the
// Most Recent Messages will restate in passing alongside one genuinely new fact.
const EXISTING_PERSON: Person = {
  id: "person-marcus-001",
  name: "Marcus Reyes",
  relationship: "Coworker",
  description: `**Marcus** works with the user on the platform team:

- Role: Backend engineer, focuses on **AWS Lambda** and event-driven services
- Recent: Helped debug a nasty step-functions retry bug last quarter by switching to **exponential backoff**
- Personal: mentioned wanting to try a new coffee shop near the office

> He once joked that "step functions are just YAML's revenge."`,
  sentiment: 0.5,
  exposure_current: 0.3,
  exposure_desired: 0.4,
  last_updated: "2026-01-01T00:00:00Z",
  identifiers: [{ type: "Full Name", value: "Marcus Reyes", is_primary: true }],
};

const MOST_RECENT_MESSAGE = makeMessage(
  "human",
  "Oh, funny story — remember Marcus's step-functions bug from last quarter? He fixed it with exponential backoff, that was the whole saga. Anyway, bigger news: he's moving over to the security team starting next month.",
  "msg-marcus-update",
);

const JUDGE_RUBRIC = [
  "The Current record already states: Marcus is a backend engineer on AWS Lambda, and he fixed a step-functions retry bug with exponential backoff last quarter.",
  "The Most Recent Messages restate that same already-known fact in passing AND introduce one genuinely new fact: Marcus is moving to the security team next month.",
  "PASS if the updated description captures the security-team move as the notable new development, and treats the step-functions/exponential-backoff detail as already-known background — mentioned briefly at most, not re-derived or expanded on as if newly discovered.",
  "FAIL if the description's main new content is expanding on or re-deriving the step-functions/exponential-backoff detail instead of the security-team move.",
  "FAIL if the security-team move is missing entirely.",
  "FAIL if the description noticeably balloons by restating existing record content rather than doing a lean, current-state update.",
].join(" ");

/**
 * Reorders `# Task` (which carries "NOT already be present in the record above") before
 * `# WHO YOU ARE ANALYZING` (which carries the "Current record" JSON) on the raw system output.
 * Assumes `participant_context` is unset (true for this eval's fixtures — `participantContextSection`
 * then returns "", collapsing the template to a clean `# Task` → `# Field Definitions` boundary).
 * Throws loudly if the literal markers aren't found, rather than silently testing the wrong thing.
 */
function toRuleBeforeRecord(prompt: { system: string; user: string }): { system: string; user: string } {
  const before = prompt.system;
  const TASK_MARKER = "\n\n# Task\n";
  const FIELD_DEF_MARKER = "\n\n# Field Definitions";

  const taskIdx = before.indexOf(TASK_MARKER);
  const fieldIdx = before.indexOf(FIELD_DEF_MARKER);
  if (taskIdx === -1 || fieldIdx === -1 || fieldIdx <= taskIdx) {
    throw new Error(
      "toRuleBeforeRecord: expected literal markers not found or out of order — person-update.ts's " +
        "template text has likely changed; update this transform to match.",
    );
  }

  const personFocusBlock = before.slice(0, taskIdx);
  // The rule text says "the record above" — true in the original order, false once the record moves
  // below it. Fixing the wording is required for a clean position-only test; leaving it self-
  // contradictory would confound "did position matter?" with "did an incoherent instruction hurt?"
  const taskBlock = before.slice(taskIdx + 2, fieldIdx).replace(/the record above/g, "the record below");
  const rest = before.slice(fieldIdx);

  const system = `${taskBlock}\n\n${personFocusBlock}${rest}`;
  return { system, user: prompt.user };
}

function makeCase(name: string, tag: string, transform?: (p: { system: string; user: string }) => { system: string; user: string }) {
  return {
    description: `Person-update record-scope: ${name} — new fact captured, already-known fact not duplicated`,
    tags: ["person-update", "record-scope", tag],
    repeat: 6,
    prompt: () => {
      const built = buildPersonUpdatePrompt({
        persona_name: PERSONA_NAME,
        existing_item: EXISTING_PERSON,
        messages_context: [],
        messages_analyze: [MOST_RECENT_MESSAGE],
      });
      const transformed = transform ? transform(built) : built;
      return hydratePrompt(transformed, [MOST_RECENT_MESSAGE]);
    },
    assert: [
      { type: "is-json" as const },
      { type: "llm-judge" as const, rubric: JUDGE_RUBRIC },
    ] satisfies Assertion[],
  };
}

const modelSlug = (process.env.EVAL_MODEL ?? process.env.LOCAL_LLM_MODEL ?? "gemma-local")
  .replace(/[^a-z0-9.-]+/gi, "-");

const summary = await runEval(
  [
    makeCase("current (record-first, rule-after)", "current"),
    makeCase("rule-before-record", "rule-before-record", toRuleBeforeRecord),
  ],
  `tests/evals/results/person-update-record-scope-${modelSlug}.json`,
);

printSummary(summary);

// No process.exit(1) gate — measurement, not a build gate.
