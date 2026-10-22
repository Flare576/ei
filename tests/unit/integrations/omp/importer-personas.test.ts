import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { importOmpSessions } from "../../../../src/integrations/omp/importer.js";
import { OmpReader } from "../../../../src/integrations/omp/reader.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import { ensureAgentPersona, resolveCanonicalAgent } from "../../../../src/core/personas/opencode-agent.js";
import { LLMNextStep, type LLMRequest, type Message, type PersonaEntity, type Person } from "../../../../src/core/types.js";
import { BUILT_IN_FACTS } from "../../../../src/core/constants/built-in-facts.js";
import { parseMessageId } from "../../../../src/core/utils/message-id.js";
import { hydratePromptPlaceholders } from "../../../../src/prompts/message-utils.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import { buildChatMessage } from "../shared/importer-test-utils.js";
import {
  ompHeader,
  ompMessage,
  ompSessionInit,
  ompSubAgent,
  ompMainSession,
  writeOmpTree,
  type OmpLine,
} from "../shared/omp-transcript-fixtures.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as the other OMP importer tests. Real `StateManager` reaches
// Zod via entity-schemas.ts.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

// Tested by `Beta` — 2026-10-22

// Every fixture file is dated 2026-01-01, far older than the quiet-tree guard
// window at this injected clock.
const NOW_MS = Date.parse("2026-09-01T00:00:00.000Z");
const now = () => NOW_MS;

const iso = (minutes: number) => new Date(Date.parse("2026-08-01T00:00:00.000Z") + minutes * 60_000).toISOString();

let treeCounter = 0;
const nextStem = () => {
  treeCounter++;
  return `2026-08-01T00-00-00-000Z_00000000-0000-7000-8000-${treeCounter.toString().padStart(12, "0")}`;
};

function makePersona(id: string, displayName: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: displayName,
    entity: "system",
    aliases: [displayName],
    short_description: `${displayName} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLinkedPerson(id: string, name: string, personaId: string): Person {
  return {
    id,
    name,
    description: `${name}'s description`,
    relationship: "AI Persona",
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: "2026-01-01T00:00:00.000Z",
    validated_date: "",
    identifiers: [
      { type: "Ei Persona", value: personaId },
      { type: "Nickname", value: name, is_primary: true },
    ],
  };
}

async function withHarness(
  run: (h: { sm: StateManager; root: string; reader: Pick<OmpReader, "listTrees" | "readTranscript"> }) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ei-omp-personas-"));
  try {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, omp: { integration: true } } });
    const real = new OmpReader();
    // Transcripts are enumerated in reverse path order on purpose, so only the importer's own ordering rules decide the import order.
    const reader = {
      listTrees: async () =>
        (await real.listTrees(root)).map((tree) => ({ ...tree, transcripts: [...tree.transcripts].reverse() })),
      readTranscript: (p: string) => real.readTranscript(p),
    };
    await run({ sm, root, reader });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** Runs passes, draining the queue between them, until a pass does nothing. Returns every request queued, in order. */
async function importAll(
  sm: StateManager,
  reader: Pick<OmpReader, "listTrees" | "readTranscript">
): Promise<LLMRequest[]> {
  const queued: LLMRequest[] = [];
  for (let i = 0; i < 30; i++) {
    const result = await importOmpSessions({ stateManager: sm, reader, now });
    queued.push(...sm.queue_getAllActiveItems());
    sm.queue_clear();
    if (result.blocksQueued === 0 && result.treesCompleted === 0) return queued;
  }
  throw new Error("import did not settle");
}

const dataOf = (r: LLMRequest) => r.data as Record<string, unknown>;
const signalScans = (items: LLMRequest[]) => items.filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalScan);
const extractionScans = (items: LLMRequest[], personaId: string) =>
  items.filter((r) => r.next_step !== LLMNextStep.HandlePersonaSignalScan && dataOf(r).personaId === personaId);

const byName = (sm: StateManager, displayName: string) =>
  sm.persona_getAll().filter((p) => p.display_name === displayName);

function requirePersona(sm: StateManager, displayName: string): PersonaEntity {
  const found = byName(sm, displayName);
  expect(found).toHaveLength(1);
  return found[0];
}

async function writeSubAgentTree(
  root: string,
  children: Record<string, OmpLine[]>,
  main: OmpLine[] = ompMainSession({ messages: [] })
) {
  await writeOmpTree(root, { stem: nextStem(), main, children });
}

const assistantTexts = (sm: StateManager, personaId: string) =>
  sm.messages_get(personaId).map((m) => m.content);

describe("OMP importer persona resolution", () => {
  describe("a reviewer agent never lands in an existing Code Reviewer", () => {
    it("files a reviewer sub-agent transcript under a separate Reviewer persona when Code Reviewer exists first", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        const codeReviewer = await ensureAgentPersona("code-reviewer", { stateManager: sm });
        expect(codeReviewer.display_name).toBe("Code Reviewer");
        expect(codeReviewer.aliases).toBeDefined();
        const aliasesBefore = [...codeReviewer.aliases!];
        const countBefore = sm.persona_getAll().length;

        await writeSubAgentTree(root, {
          "0-Review": ompSubAgent({
            agent: "reviewer",
            messages: [ompMessage("assistant", "reviewed the change")],
          }),
        });
        await importAll(sm, reader);

        const reviewer = requirePersona(sm, "Reviewer");
        expect(reviewer.id).not.toBe(codeReviewer.id);
        expect(assistantTexts(sm, reviewer.id)).toEqual(["reviewed the change"]);
        expect(sm.messages_get(codeReviewer.id)).toHaveLength(0);
        expect(sm.persona_getById(codeReviewer.id)!.aliases).toEqual(aliasesBefore);
        expect(sm.persona_getAll()).toHaveLength(countBefore + 1);
      });
    });

    it("keeps reviewer messages under Reviewer when Code Reviewer is created after Reviewer already exists", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeSubAgentTree(root, {
          "0-Review": ompSubAgent({
            agent: "reviewer",
            messages: [ompMessage("assistant", "first review")],
          }),
        });
        await importAll(sm, reader);
        const reviewer = requirePersona(sm, "Reviewer");

        const codeReviewer = await ensureAgentPersona("code-reviewer", { stateManager: sm });
        expect(codeReviewer.id).not.toBe(reviewer.id);
        expect(codeReviewer.display_name).toBe("Code Reviewer");
        expect(codeReviewer.aliases).toBeDefined();
        const aliasesBefore = [...codeReviewer.aliases!];
        const countBefore = sm.persona_getAll().length;

        await writeSubAgentTree(root, {
          "0-Review": ompSubAgent({
            agent: "reviewer",
            messages: [ompMessage("assistant", "second review")],
          }),
        });
        await importAll(sm, reader);

        expect(requirePersona(sm, "Reviewer").id).toBe(reviewer.id);
        expect(assistantTexts(sm, reviewer.id)).toEqual(["second review"]);
        expect(sm.messages_get(codeReviewer.id)).toHaveLength(0);
        expect(sm.persona_getById(codeReviewer.id)!.aliases).toEqual(aliasesBefore);
        expect(sm.persona_getAll()).toHaveLength(countBefore);
      });
    });

    it("files a main-session message carrying agent reviewer under Reviewer, not Code Reviewer", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        const codeReviewer = await ensureAgentPersona("code-reviewer", { stateManager: sm });
        expect(codeReviewer.aliases).toBeDefined();
        const aliasesBefore = [...codeReviewer.aliases!];
        const countBefore = sm.persona_getAll().length;

        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({ messages: [ompMessage("assistant", "main review", { agent: "reviewer" })] }),
        });
        await importAll(sm, reader);

        const reviewer = requirePersona(sm, "Reviewer");
        expect(reviewer.id).not.toBe(codeReviewer.id);
        expect(assistantTexts(sm, reviewer.id)).toEqual(["main review"]);
        expect(sm.messages_get(codeReviewer.id)).toHaveLength(0);
        expect(sm.persona_getById(codeReviewer.id)!.aliases).toEqual(aliasesBefore);
        expect(sm.persona_getAll()).toHaveLength(countBefore + 1);
      });
    });
  });

  describe("transcripts and messages that name no agent", () => {
    const noAgentTranscript = () =>
      ompSubAgent({
        systemPrompt: ["You are the Backend Engineer agent."],
        messages: [ompMessage("assistant", "did the work")],
      });
    const noInitTranscript = () => [
      ompHeader({ parentSession: "/work/root-session.jsonl" }),
      ompMessage("assistant", "did the work"),
    ];
    const variants: [string, () => OmpLine[]][] = [
      ["a sub-agent transcript with no agent", noAgentTranscript],
      ["a sub-agent transcript with no session_init", noInitTranscript],
    ];

    it.each(variants)("files %s under task and queues extraction without a signal scan", async (_name, build) => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeSubAgentTree(root, { "0-Anon": build() });
        const queued = await importAll(sm, reader);

        const task = requirePersona(sm, "Task");
        expect(assistantTexts(sm, task.id)).toEqual(["did the work"]);
        expect(extractionScans(queued, task.id).length).toBeGreaterThan(0);
        expect(signalScans(queued)).toHaveLength(0);
        expect(byName(sm, "Backend Engineer")).toHaveLength(0);
      });
    });

    it.each(variants)(
      "files %s under an existing unarchived, uniquely linked task persona with extraction but no signal scan",
      async (_name, build) => {
        await withHarness(async ({ sm, root, reader }) => {
          sm.persona_add(makePersona("task-persona", "Task"));
          sm.human_person_upsert(makeLinkedPerson("task-person", "Task Bot", "task-persona"));

          await writeSubAgentTree(root, { "0-Anon": build() });
          const queued = await importAll(sm, reader);

          expect(assistantTexts(sm, "task-persona")).toEqual(["did the work"]);
          expect(extractionScans(queued, "task-persona").length).toBeGreaterThan(0);
          expect(signalScans(queued)).toHaveLength(0);
          expect(sm.persona_getById("task-persona")!.is_archived).toBe(false);
        });
      }
    );

    it("queues the signal scan for an otherwise identical transcript whose session_init agent is task", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        sm.persona_add(makePersona("task-persona", "Task"));
        sm.human_person_upsert(makeLinkedPerson("task-person", "Task Bot", "task-persona"));

        await writeSubAgentTree(root, {
          "0-Named": ompSubAgent({
            agent: "task",
            systemPrompt: ["You are the Backend Engineer agent."],
            messages: [ompMessage("assistant", "did the work")],
          }),
        });
        const queued = await importAll(sm, reader);

        expect(extractionScans(queued, "task-persona").length).toBeGreaterThan(0);
        const scans = signalScans(queued);
        expect(scans).toHaveLength(1);
        expect(dataOf(scans[0]).subjectPersonaId).toBe("task-persona");
        expect(dataOf(scans[0]).subjectPersonId).toBe("task-person");
        expect(sm.persona_getById("task-persona")!.is_archived).toBe(false);
      });
    });

    it("files main-session messages with no agent under OhMyPi and leaves the Pi persona untouched", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        sm.persona_add(
          makePersona("pi-persona", "Pi", {
            aliases: ["omp", "oh-my-pi"],
            short_description: "Pi's own description",
          })
        );
        sm.messages_append("pi-persona", buildChatMessage("pi-existing"));
        const piBefore = JSON.stringify(sm.persona_getById("pi-persona"));
        const piMessagesBefore = JSON.stringify(sm.messages_get("pi-persona"));

        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({ messages: [ompMessage("assistant", "hello from the main session")] }),
        });
        const queued = await importAll(sm, reader);

        const ohMyPi = requirePersona(sm, "OhMyPi");
        expect(ohMyPi.id).not.toBe("pi-persona");
        expect(assistantTexts(sm, ohMyPi.id)).toEqual(["hello from the main session"]);
        expect(extractionScans(queued, ohMyPi.id).length).toBeGreaterThan(0);
        expect(ohMyPi.is_archived).toBe(false);
        expect(ohMyPi.aliases).toEqual(resolveCanonicalAgent("OhMyPi").aliases);
        expect(ohMyPi.aliases).toBeDefined();
        const lowered = ohMyPi.aliases!.map((a) => a.toLowerCase());
        expect(lowered).not.toContain("omp");
        expect(lowered).not.toContain("oh-my-pi");
        expect(ohMyPi.group_primary).toBe("OpenCode");
        expect(ohMyPi.groups_visible).toContain("OpenCode");

        expect(JSON.stringify(sm.persona_getById("pi-persona"))).toBe(piBefore);
        expect(JSON.stringify(sm.messages_get("pi-persona"))).toBe(piMessagesBefore);
      });
    });
  });

  describe("persona creation state", () => {
    it("creates a persona unarchived from a main-session agent and archived from a sub-agent transcript", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({ messages: [ompMessage("assistant", "main speaking", { agent: "Mainy" })] }),
          children: {
            "0-Sub": ompSubAgent({ agent: "Suby", messages: [ompMessage("assistant", "sub speaking")] }),
          },
        });
        await importAll(sm, reader);

        expect(requirePersona(sm, "Mainy").is_archived).toBe(false);
        expect(requirePersona(sm, "Suby").is_archived).toBe(true);
      });
    });

    it("leaves an archived persona archived when a later main-session import names it", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeSubAgentTree(root, {
          "0-Sub": ompSubAgent({ agent: "Delta", messages: [ompMessage("assistant", "from a sub-agent")] }),
        });
        await importAll(sm, reader);
        expect(requirePersona(sm, "Delta").is_archived).toBe(true);

        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({ messages: [ompMessage("assistant", "from the main session", { agent: "Delta" })] }),
        });
        await importAll(sm, reader);

        const delta = requirePersona(sm, "Delta");
        expect(delta.is_archived).toBe(true);
        expect(assistantTexts(sm, delta.id)).toEqual(["from the main session"]);
      });
    });

    it("leaves an unarchived persona unarchived when a later sub-agent import names it", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({ messages: [ompMessage("assistant", "from the main session", { agent: "Delta" })] }),
        });
        await importAll(sm, reader);
        expect(requirePersona(sm, "Delta").is_archived).toBe(false);

        await writeSubAgentTree(root, {
          "0-Sub": ompSubAgent({ agent: "Delta", messages: [ompMessage("assistant", "from a sub-agent")] }),
        });
        await importAll(sm, reader);

        const delta = requirePersona(sm, "Delta");
        expect(delta.is_archived).toBe(false);
        expect(assistantTexts(sm, delta.id)).toEqual(["from a sub-agent"]);
      });
    });

    it("creates a name seen as both main-session and sub-agent unarchived even when the sub-agent is earlier", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({
            messages: [ompMessage("assistant", "main speaking", { agent: "Gamma", timestamp: iso(60) })],
          }),
          children: {
            "0-Sub": ompSubAgent({
              agent: "Gamma",
              messages: [ompMessage("assistant", "sub speaking", { timestamp: iso(10) })],
            }),
          },
        });
        await importAll(sm, reader);

        expect(requirePersona(sm, "Gamma").is_archived).toBe(false);
      });
    });

    it("imports the main-session block before a sub-agent block despite the sub-agent's earlier timestamp", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeOmpTree(root, {
          stem: nextStem(),
          main: ompMainSession({
            messages: [ompMessage("assistant", "main speaking", { agent: "Mainy", timestamp: iso(60) })],
          }),
          children: {
            "0-Sub": ompSubAgent({
              agent: "Suby",
              messages: [ompMessage("assistant", "sub speaking", { timestamp: iso(10) })],
            }),
          },
        });
        const queued = await importAll(sm, reader);

        const order = [...new Set(queued.map((r) => dataOf(r).personaId).filter((id) => typeof id === "string"))];
        expect(order).toEqual([requirePersona(sm, "Mainy").id, requirePersona(sm, "Suby").id]);
      });
    });

    it("imports sub-agent transcripts by first-message timestamp, ahead of path order", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeSubAgentTree(root, {
          "1": ompSubAgent({ agent: "Later", messages: [ompMessage("assistant", "later", { timestamp: iso(30) })] }),
          "2": ompSubAgent({ agent: "Earlier", messages: [ompMessage("assistant", "earlier", { timestamp: iso(5) })] }),
        });
        const queued = await importAll(sm, reader);

        const order = [...new Set(queued.map((r) => dataOf(r).personaId).filter((id) => typeof id === "string"))];
        expect(order).toEqual([requirePersona(sm, "Earlier").id, requirePersona(sm, "Later").id]);
      });
    });

    it("breaks a sub-agent timestamp tie by transcript path", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        await writeSubAgentTree(root, {
          "2": ompSubAgent({ agent: "PathSecond", messages: [ompMessage("assistant", "two", { timestamp: iso(15) })] }),
          "1": ompSubAgent({ agent: "PathFirst", messages: [ompMessage("assistant", "one", { timestamp: iso(15) })] }),
        });
        const queued = await importAll(sm, reader);

        const order = [...new Set(queued.map((r) => dataOf(r).personaId).filter((id) => typeof id === "string"))];
        expect(order).toEqual([requirePersona(sm, "PathFirst").id, requirePersona(sm, "PathSecond").id]);
      });
    });
  });

  describe("direct signal scan eligibility", () => {
    const cases: {
      name: string;
      kind: "sub-agent" | "main-session";
      archived: boolean;
      links: 0 | 1 | 2;
      signal: boolean;
    }[] = [
      { name: "a sub-agent block of an unarchived persona with one linked Person", kind: "sub-agent", archived: false, links: 1, signal: true },
      { name: "a main-session block of an unarchived persona with one linked Person", kind: "main-session", archived: false, links: 1, signal: false },
      { name: "a sub-agent block of an archived persona with one linked Person", kind: "sub-agent", archived: true, links: 1, signal: false },
      { name: "a sub-agent block of an unarchived persona with no linked Person", kind: "sub-agent", archived: false, links: 0, signal: false },
      { name: "a sub-agent block of an unarchived persona with two linked People", kind: "sub-agent", archived: false, links: 2, signal: false },
    ];

    it.each(cases)("$name: signal scan queued is $signal, extraction still queued", async (c) => {
      await withHarness(async ({ sm, root, reader }) => {
        sm.persona_add(makePersona("epsilon-persona", "Epsilon", { is_archived: c.archived }));
        if (c.links >= 1) sm.human_person_upsert(makeLinkedPerson("epsilon-person-a", "Epsilon A", "epsilon-persona"));
        if (c.links >= 2) sm.getHuman().people.push(makeLinkedPerson("epsilon-person-b", "Epsilon B", "epsilon-persona"));

        if (c.kind === "sub-agent") {
          await writeSubAgentTree(root, {
            "0-Sub": ompSubAgent({ agent: "Epsilon", messages: [ompMessage("assistant", "did a thing")] }),
          });
        } else {
          await writeOmpTree(root, {
            stem: nextStem(),
            main: ompMainSession({ messages: [ompMessage("assistant", "did a thing", { agent: "Epsilon" })] }),
          });
        }
        const queued = await importAll(sm, reader);

        expect(assistantTexts(sm, "epsilon-persona")).toEqual(["did a thing"]);
        expect(extractionScans(queued, "epsilon-persona").length).toBeGreaterThan(0);
        const scans = signalScans(queued);
        expect(scans).toHaveLength(c.signal ? 1 : 0);
        if (c.signal) expect(dataOf(scans[0]).subjectPersonaId).toBe("epsilon-persona");
        expect(sm.persona_getById("epsilon-persona")!.is_archived).toBe(c.archived);
      });
    });
  });

  describe("a persona created with no creation kind (the OpenCode importer's call)", () => {
    it("is created unarchived", async () => {
      await withHarness(async ({ sm }) => {
        const persona = await ensureAgentPersona("scribe", { stateManager: sm });
        expect(persona.is_archived).toBe(false);
        expect(sm.persona_getById(persona.id)!.is_archived).toBe(false);
      });
    });
  });

  describe("one direct signal scan per sub-agent transcript", () => {
    const sha = (s: string) => `sha256:${createHash("sha256").update(s, "utf-8").digest("hex")}`;
    const promptText = (p: string | string[]) => (Array.isArray(p) ? p.join("\n\n") : p);

    const PROMPT_ONE = "You are the scribe. Environment: alpha.";
    const PROMPT_TWO = "You are the scribe. Environment: beta.";
    const UNRECORDED = "You are the scribe. Environment: never recorded.";
    const arr = (s: string): string[] => [`${s} part one`, `${s} part two`];

    const forms: { name: string; first: string | string[]; second: string | string[] | null }[] = [
      { name: "one session_init, string prompt", first: PROMPT_ONE, second: null },
      { name: "one session_init, array prompt", first: arr(PROMPT_ONE), second: null },
      { name: "two session_init entries, string prompts", first: PROMPT_ONE, second: PROMPT_TWO },
      { name: "two session_init entries, array prompts", first: arr(PROMPT_ONE), second: arr(PROMPT_TWO) },
    ];

    it.each(forms)("$name yields exactly one signal scan over all messages with a recorded-prompt revision", async (form) => {
      await withHarness(async ({ sm, root, reader }) => {
        sm.persona_add(makePersona("scribe-persona", "Scribe"));
        sm.human_person_upsert(makeLinkedPerson("scribe-person", "Scribe Bot", "scribe-persona"));

        const SECOND_TASK = "second init task text";
        const lines: OmpLine[] = [
          ompHeader({ parentSession: "/work/root-session.jsonl" }),
          ompSessionInit({ agent: "scribe", systemPrompt: form.first, task: "first init task text" }),
          ompMessage("assistant", "message one"),
          ompMessage("user", "message two", { attribution: "agent" }),
        ];
        if (form.second !== null) {
          lines.push(ompSessionInit({ agent: "other-scribe", systemPrompt: form.second, task: SECOND_TASK }));
        }
        lines.push(ompMessage("assistant", "message three"));
        await writeSubAgentTree(root, { "0-Scribe": lines });

        const queued = await importAll(sm, reader);

        const scans = signalScans(queued);
        expect(scans).toHaveLength(1);
        const data = dataOf(scans[0]);

        const stored = sm.messages_get("scribe-persona");
        expect(stored.map((m) => m.content)).toEqual(["message one", "message two", "message three"]);
        expect(data.message_ids_to_mark).toEqual(stored.map((m) => m.id));
        const prompt = hydratePromptPlaceholders(scans[0].user, new Map(stored.map((m) => [m.id, m])));
        const positions = ["message one", "message two", "message three"].map((t) => prompt.indexOf(t));
        expect(positions[0]).toBeGreaterThanOrEqual(0);
        expect(positions[1]).toBeGreaterThan(positions[0]);
        expect(positions[2]).toBeGreaterThan(positions[1]);
        expect(prompt).not.toContain("first init task text");
        expect(prompt).not.toContain(SECOND_TASK);

        const provenance = data.agentProvenance as Record<string, unknown>;
        const recorded = [form.first, ...(form.second === null ? [] : [form.second])].map((p) => sha(promptText(p)));
        expect(recorded).toContain(provenance.definition_revision);
        expect(provenance.definition_revision).not.toBe(sha(UNRECORDED));
        expect(provenance.definition_revision).not.toBe(sha(promptText(arr(UNRECORDED))));
        expect(provenance.agent_id).toBe("scribe");
        expect(provenance.agent_definition_ref).toBe("omp:scribe");
        expect(provenance.harness).toBe("omp");
        expect(provenance.mode).toBe("delegated");
      });
    });
  });

  describe("a later pass over a tree with an earlier watermark", () => {
    it("keeps the already-extracted message as signal context and excludes it from every scan's analyze set", async () => {
      await withHarness(async ({ sm, root, reader }) => {
        const TREE_ID = "00000000-0000-7000-8000-0000000000c4";
        const OLD_TEXT = "old context message";
        const NEW_ONE = "new message one";
        const NEW_TWO = "new message two";
        const EXTRACTION_STEPS = [
          LLMNextStep.HandleFactFind,
          LLMNextStep.HandleHumanPersonScan,
          LLMNextStep.HandleHumanTopicScan,
          LLMNextStep.HandleEventScan,
        ];

        sm.persona_add(makePersona("scribe-persona", "Scribe"));
        sm.human_person_upsert(makeLinkedPerson("scribe-person", "Scribe Bot", "scribe-persona"));
        // The harness human has no facts, so no fact-find would be queued; seed every built-in fact undescribed.
        const human = sm.getHuman();
        sm.setHuman({
          ...human,
          facts: BUILT_IN_FACTS.map(({ name }, n) => ({
            id: `fact-${n}`,
            name,
            description: "",
            sentiment: 0,
            last_updated: iso(0),
            validated_date: "",
          })),
          settings: {
            ...human.settings,
            omp: {
              integration: true,
              ...human.settings?.omp,
              processed_sessions: { ...human.settings?.omp?.processed_sessions, [TREE_ID]: iso(10) },
            },
          },
        });

        await writeOmpTree(root, {
          stem: `2026-08-01T00-00-00-000Z_${TREE_ID}`,
          main: ompMainSession({ messages: [] }),
          children: {
            "0-Scribe": ompSubAgent({
              agent: "scribe",
              messages: [
                ompMessage("assistant", OLD_TEXT, { id: "old-context", timestamp: iso(5) }),
                ompMessage("assistant", NEW_ONE, { id: "new-one", timestamp: iso(20) }),
                ompMessage("assistant", NEW_TWO, { id: "new-two", timestamp: iso(30) }),
              ],
            }),
          },
          mtime: new Date(iso(60)),
        });

        const realAppend = sm.messages_append.bind(sm);
        const appended: Message[] = [];
        const spy = vi.spyOn(sm, "messages_append").mockImplementation((personaId, message) => {
          if (personaId === "scribe-persona") appended.push(structuredClone(message));
          return realAppend(personaId, message);
        });
        // The event scan's open-window guard reads the real clock; pin Date only.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW_MS);
        let queued: LLMRequest[];
        try {
          queued = await importAll(sm, reader);
        } finally {
          vi.useRealTimers();
          spy.mockRestore();
        }

        const flagsOf = (m: Message) => [m.f, m.t, m.p, m.e];
        const atAppend = (text: string): Message => {
          const found = appended.filter((m) => m.content === text);
          expect(found).toHaveLength(1);
          return found[0];
        };
        expect(flagsOf(atAppend(OLD_TEXT))).toEqual([true, true, true, true]);
        expect(flagsOf(atAppend(NEW_ONE))).not.toContain(true);
        expect(flagsOf(atAppend(NEW_TWO))).not.toContain(true);

        const stored = sm.messages_get("scribe-persona");
        expect(stored.map((m) => m.content)).toEqual([OLD_TEXT, NEW_ONE, NEW_TWO]);
        const idOf = (nativeId: string): string => {
          const found = stored.filter((m) => parseMessageId(m.id).nativeId === nativeId);
          expect(found).toHaveLength(1);
          return found[0].id;
        };
        const oldId = idOf("old-context");
        const newIds = [idOf("new-one"), idOf("new-two")];
        expect(stored.map((m) => m.id)).toEqual([oldId, ...newIds]);
        // The old message arrives pre-marked; the new ones are marked by the queued extraction scans.
        for (const m of stored) expect(flagsOf(m)).toEqual([true, true, true, true]);

        const messageMap = new Map(stored.map((m) => [m.id, m]));
        const expectWindow = (request: LLMRequest) => {
          const ids = dataOf(request).message_ids_to_mark;
          expect(ids).toEqual(newIds);
          expect(ids).not.toContain(oldId);
          const prompt = hydratePromptPlaceholders(request.user, messageMap);
          const earlierAt = prompt.indexOf("## Earlier Conversation");
          const recentAt = prompt.indexOf("## Most Recent Messages");
          expect(earlierAt).toBeGreaterThanOrEqual(0);
          expect(recentAt).toBeGreaterThan(earlierAt);
          const earlier = prompt.slice(earlierAt, recentAt);
          const recent = prompt.slice(recentAt);
          expect(earlier).toContain(OLD_TEXT);
          expect(earlier).not.toContain(NEW_ONE);
          expect(earlier).not.toContain(NEW_TWO);
          expect(recent).not.toContain(OLD_TEXT);
          const one = recent.indexOf(NEW_ONE);
          expect(one).toBeGreaterThanOrEqual(0);
          expect(recent.indexOf(NEW_TWO)).toBeGreaterThan(one);
        };

        const scans = signalScans(queued);
        expect(scans).toHaveLength(1);
        expectWindow(scans[0]);
        const signalPrompt = hydratePromptPlaceholders(scans[0].user, messageMap);
        const positions = [OLD_TEXT, NEW_ONE, NEW_TWO].map((t) => signalPrompt.indexOf(t));
        expect(positions[0]).toBeGreaterThanOrEqual(0);
        expect(positions[1]).toBeGreaterThan(positions[0]);
        expect(positions[2]).toBeGreaterThan(positions[1]);

        const extraction = extractionScans(queued, "scribe-persona").filter((r) => EXTRACTION_STEPS.includes(r.next_step));
        expect(extraction.map((r) => r.next_step).sort()).toEqual([...EXTRACTION_STEPS].sort());
        for (const request of extraction) {
          const ids = dataOf(request).message_ids_to_mark;
          expect(ids).toEqual(newIds);
          expect(ids).not.toContain(oldId);
        }
      });
    });
  });
});
