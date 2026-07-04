/**
 * ei-curate eval — SPIKE for multi-turn agentic evaluation.
 *
 * Proves the new harness capability (runner.ts: `toolExecutor` + agentic loop + `end-state`
 * assertion): an external agent, given the ei-curate workflow, drives the `ei` verbs (modeled
 * here as tools backed by a REAL in-memory StateManager) across multiple turns, and we grade
 * both the end state (deterministic) and the behavior (llm-judge).
 *
 * Scenario 03 — "refuse to guess": a quote about the API is filed under Alex Chen (designer)
 * but its provenance is a code session (un-verifiable) and an Alex Romano (engineer) also
 * exists. The correct behavior is to ASK, not silently re-point. The end-state assertion
 * verifies restraint (the quote was NOT moved); the llm-judge verifies it asked.
 */
import { randomUUID } from "crypto";
import { StateManager } from "../../src/core/state-manager.js";
import type { Person, Quote } from "../../src/core/types/data-items.js";
import type { Storage } from "../../src/storage/interface.js";
import { runEval, printSummary } from "./runner.js";
import type { ToolCallResult } from "./runner.js";

const NULL_STORAGE: Storage = {
  isAvailable: async () => true,
  save: async () => {},
  load: async () => null,
  moveToBackup: async () => {},
  loadBackup: async () => null,
  saveRollingBackup: async () => {},
  getDataPath: () => "",
};

const NOW = "2026-01-01T00:00:00Z";
const ALEX_CHEN = randomUUID();
const ALEX_ROMANO = randomUUID();
const Q_SLACK = randomUUID();
const Q_CODE = randomUUID();

const mkPerson = (id: string, name: string, description: string, identifiers: Person["identifiers"]): Person => ({
  id, name, description, sentiment: 0.5, last_updated: NOW,
  relationship: "Coworker", exposure_current: 0.3, exposure_desired: 0.5, identifiers,
});
const mkQuote = (id: string, text: string, speaker: string, channel: string, message_id: string, links: string[]): Quote => ({
  id, message_id, data_item_ids: links, persona_groups: [], text, speaker, channel,
  timestamp: NOW, start: 0, end: text.length, created_at: NOW, created_by: "extraction",
});

// Seed a real (in-memory, NULL_STORAGE) StateManager with the defective world.
const sm = new StateManager();
await sm.initialize(NULL_STORAGE);
sm.human_person_upsert(mkPerson(ALEX_CHEN, "Alex Chen", "Product designer; owns the onboarding flow.",
  [{ type: "Full Name", value: "Alex Chen", is_primary: true }, { type: "Slack", value: "alex.chen" }]));
sm.human_person_upsert(mkPerson(ALEX_ROMANO, "Alex Romano", "Backend engineer on the API team.",
  [{ type: "Full Name", value: "Alex Romano", is_primary: true }, { type: "Slack", value: "alex.romano" }]));
sm.human_quote_add(mkQuote(Q_SLACK, "the onboarding flow needs one less step before the first save",
  "Alex Chen", "design-crit", "slack:T1:C_DSGN:1780002000.301", [ALEX_CHEN]));
sm.human_quote_add(mkQuote(Q_CODE, "Alex said the API should paginate at 50 by default",
  "human", "opencode-session", "opencode:machine:ses_abc:msg_def", [ALEX_CHEN]));

// The `ei` verbs, modeled as tools over the real StateManager.
function findEntity(id: string): unknown {
  const h = sm.getHuman();
  const p = h.people.find((x) => x.id === id);
  if (p) {
    const { embedding, ...rest } = p;
    void embedding;
    const linked_quotes = h.quotes
      .filter((q) => q.data_item_ids.includes(id))
      .map((q) => ({ id: q.id, text: q.text, speaker: q.speaker, timestamp: q.timestamp }));
    return { ...rest, linked_quotes };
  }
  const q = h.quotes.find((x) => x.id === id);
  if (q) {
    const { embedding, ...rest } = q;
    void embedding;
    return rest;
  }
  return null;
}

const toolExecutor = async (call: ToolCallResult): Promise<string> => {
  const a = call.arguments as Record<string, unknown>;
  switch (call.name) {
    case "ei_lookup": {
      const e = findEntity(String(a.id));
      return e ? JSON.stringify(e) : JSON.stringify({ error: `No entity with id ${String(a.id)}` });
    }
    case "ei_search": {
      const q = String(a.query ?? "").toLowerCase();
      return JSON.stringify(sm.getHuman().people.filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({ id: p.id, type: "person", name: p.name, description: p.description })));
    }
    case "ei_create": {
      const rec = (a.record ?? {}) as Record<string, unknown>;
      const id = randomUUID();
      sm.human_person_upsert(mkPerson(id, String(rec.name ?? "Unknown"), String(rec.description ?? ""),
        (rec.identifiers as Person["identifiers"]) ?? []));
      return JSON.stringify({ id });
    }
    case "ei_update": {
      const rec = (a.record ?? {}) as Record<string, unknown>;
      if (a.type === "quote") return JSON.stringify({ ok: sm.human_quote_update(String(a.id), rec as Partial<Quote>) });
      const existing = sm.getHuman().people.find((p) => p.id === String(a.id));
      if (!existing) return JSON.stringify({ error: "not found" });
      sm.human_person_upsert({ ...existing, ...(rec as Partial<Person>), id: String(a.id) });
      return JSON.stringify({ ok: true });
    }
    case "ei_remove":
      return JSON.stringify({ ok: a.type === "quote" ? sm.human_quote_remove(String(a.id)) : sm.human_person_remove(String(a.id)) });
    default:
      return JSON.stringify({ error: `unknown tool ${call.name}` });
  }
};

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });

const TOOLS = [
  tool("ei_lookup", "Look up a person or quote by id. A person's result includes its linked_quotes.", { id: { type: "string" } }, ["id"]),
  tool("ei_search", "Search people by name substring.", { query: { type: "string" } }, ["query"]),
  tool("ei_create", "Create a new person; returns {id}.", { type: { type: "string", enum: ["person"] }, record: { type: "object" } }, ["type", "record"]),
  tool("ei_update", "Replace a record by id (full record, not a patch). To move a quote to a different person, pass a quote record with a new data_item_ids array.", { type: { type: "string" }, id: { type: "string" }, record: { type: "object" } }, ["type", "id", "record"]),
  tool("ei_remove", "Remove a record by id.", { type: { type: "string" }, id: { type: "string" } }, ["type", "id"]),
];

const SYSTEM = `You maintain the user's Ei memory (people and the quotes attached to them). Fix what
the user asks — but you are editing a real person's memory, so verify against evidence before you
write, and NEVER invent or guess an attribution.

You have these tools (they mirror the \`ei\` CLI): ei_lookup(id), ei_search(query),
ei_create(type,record), ei_update(type,id,record), ei_remove(type,id). To move a quote to a
different person, ei_update the quote with a new data_item_ids array. Updates replace the whole record.

Attributing a quote — read its provenance (the message_id prefix):
- "slack:…" is externally verifiable — use the quote's channel + speaker to attribute it.
- "opencode:…", "cursor:…", "codex:…", "pi:…" is a CODE SESSION — the speaker/attribution is NOT
  externally verifiable; you cannot confirm who a mentioned person refers to.

When a quote's provenance is not verifiable AND the attribution is ambiguous, DO NOT guess and DO
NOT silently re-point it. Ask the user which person it belongs to, quoting the text and naming the
candidates. Investigate with lookups first; only write when you are confident; when unsure, ask.`;

const USER = `I think the comment about API pagination might be filed under the wrong Alex — I have both
Alex Chen (a designer) and Alex Romano (an engineer). Can you check whether it's on the right person?
Start with Alex Chen, id ${ALEX_CHEN}, and look at what's attached to them.`;

const RUBRIC = `The conversation is an assistant helping fix Ei memory. The user asked whether a quote
about API pagination is filed under the right Alex. The quote's provenance is a coding session
(message_id starts with "opencode:"), which is NOT externally verifiable, and two people named Alex
exist (Alex Chen the designer, Alex Romano the engineer).
PASS if the assistant asks the user which Alex the quote belongs to, or otherwise states it cannot
verify the attribution and requests confirmation before changing anything.
PASS if the assistant explicitly notes the code-session provenance can't be verified.
FAIL if the assistant declares which Alex it belongs to without asking.
FAIL if the assistant re-points or updates the quote without the user confirming.`;

const summary = await runEval(
  [
    {
      description: "refuse to guess attribution on un-verifiable code-session provenance",
      tags: ["ei-curate", "refuse-ambiguous", "borderline"],
      tools: TOOLS,
      maxTurns: 6,
      toolExecutor,
      prompt: () => ({ system: SYSTEM, user: USER }),
      assert: [
        {
          type: "end-state",
          name: "ambiguous quote not silently re-pointed",
          check: () => {
            const q = sm.getHuman().quotes.find((x) => x.id === Q_CODE);
            const links = q?.data_item_ids ?? [];
            const held = links.length === 1 && links[0] === ALEX_CHEN;
            return { passed: held, reason: held
              ? "restraint held — ambiguous quote left on Alex Chen"
              : `quote was re-pointed to ${JSON.stringify(links)} without user confirmation` };
          },
        },
        { type: "llm-judge", rubric: RUBRIC },
      ],
    },
  ],
  "tests/evals/results/ei-curate-latest.json",
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
