import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Message } from "../../core/types.js";
import {
  queueAllScans,
  queuePersonaSignalScan,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";
import { queuePersonRewritePhase, queueTopicRewritePhase } from "../../core/orchestrators/ceremony.js";
import { resolvePersonaLinkedPeople } from "../../core/utils/identifier-utils.js";
import { ensureAgentPersona, matchAgentPersona, resolveCanonicalAgent } from "../../core/personas/opencode-agent.js";
import { qualifyOmpMessage } from "../../core/utils/message-id.js";
import { stripControlChars } from "../../core/utils/message-refusal.js";
import { convertToEiMessage, convertToPreMarkedEiMessage } from "../shared/message-converter.js";
import { getMachineId } from "../machine-id.js";
import { MIN_SESSION_AGE_MS } from "../constants.js";
import { OmpReader } from "./reader.js";
import { agentNameOr, MAIN_SESSION_PERSONA, SUB_AGENT_FALLBACK_PERSONA } from "./agent-name.js";
import type { OmpMessage, OmpProvenance, OmpSettings, OmpTree } from "./types.js";

export interface OmpImportResult {
  treesCompleted: number;
  blocksQueued: number;
  scansQueued: number;
}

export interface OmpImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  /** Structural, not nominal: `OmpReader` itself, or any object exposing the
   * same two methods (test fixtures inject the latter). */
  reader?: Pick<OmpReader, "listTrees" | "readTranscript">;
  signal?: AbortSignal;
  /** Clock for the planning time and the quiet-tree guard; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * A block is the unit of work: one sub-agent transcript, or one persona's
 * messages in a main session. `key` identifies it within its tree and is stable
 * across a restart. `load` yields the block's messages and the agent they are
 * filed under; `provenance` is present for sub-agent blocks only, and
 * `hasIdentity` says whether the transcript recorded an agent at all.
 */
interface Block {
  key: string;
  kind: "main-session" | "sub-agent";
  /** The transcript file: the message-ID session segment and the source tag. */
  path: string;
  load(): Promise<{
    messages: OmpMessage[];
    agentName: string;
    hasIdentity: boolean;
    provenance?: OmpProvenance;
  } | null>;
}

interface Env {
  stateManager: StateManager;
  eiInterface?: Ei_Interface;
  reader: Pick<OmpReader, "listTrees" | "readTranscript">;
  signal?: AbortSignal;
  result: OmpImportResult;
}

function updateOmpSettings(stateManager: StateManager, patch: Partial<OmpSettings>): void {
  const human = stateManager.getHuman();
  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      omp: {
        ...human.settings?.omp,
        ...patch,
      },
    },
  });
}

/**
 * The tree's blocks in import order: main-session blocks first (one per
 * persona, in order of first appearance), then sub-agent transcripts by
 * first-message timestamp, ties by path. A transcript the reader rejects, or
 * one with no messages, has no block.
 *
 * Main-session messages group by the persona they will be filed under. Agent
 * names are taken in order of first appearance, as the blocks will run: a name
 * matches exactly (display name, then alias) either a stored persona or the
 * persona an earlier unmatched group's creation will install (its first
 * canonical name, with the aliases that name resolves to), and joins that
 * persona's group; otherwise it starts a new group. A resumed plan, with those
 * personas now stored, therefore groups the same way. The block key uses the
 * persona's display name, or the group's first canonical name. Planning only
 * reads personas; it creates none.
 */
async function planBlocks({ reader, stateManager }: Env, tree: OmpTree): Promise<Block[]> {
  const blocks: Block[] = [];

  const root = await reader.readTranscript(tree.rootPath);
  if (root) {
    const rootName = tree.rootPath.slice(Math.max(tree.rootPath.lastIndexOf("/"), tree.rootPath.lastIndexOf("\\")) + 1);
    type Group = { name: string; agentName: string; messages: OmpMessage[] };
    const candidates: { display_name: string; aliases?: string[]; group?: Group }[] = stateManager
      .persona_getAll()
      .map((p) => ({ display_name: p.display_name, aliases: p.aliases }));
    const groups: Group[] = [];
    const byAgentName = new Map<string, Group>();
    for (const message of root.messages) {
      const agentName = agentNameOr(message.agent, MAIN_SESSION_PERSONA);
      let group = byAgentName.get(agentName);
      if (!group) {
        const { canonical, aliases } = resolveCanonicalAgent(agentName);
        const match = matchAgentPersona(candidates, canonical);
        if (match) {
          match.group ??= { name: match.display_name, agentName, messages: [] };
          group = match.group;
        } else {
          group = { name: canonical, agentName, messages: [] };
          candidates.push({ display_name: canonical, aliases, group });
        }
        if (!groups.includes(group)) groups.push(group);
        byAgentName.set(agentName, group);
      }
      group.messages.push(message);
    }
    for (const group of groups) {
      blocks.push({
        key: `${rootName}|${group.name}`,
        kind: "main-session",
        path: tree.rootPath,
        load: async () => ({ messages: group.messages, agentName: group.agentName, hasIdentity: false }),
      });
    }
  }

  // Only the first-message time is kept while ordering, so a tree's transcripts
  // are never all held in memory at once; each is read again when its block runs.
  const siblingDir = tree.rootPath.slice(0, -".jsonl".length);
  const subAgents: { path: string; firstMessageMs: number }[] = [];
  for (const record of tree.transcripts) {
    const session = await reader.readTranscript(record.path);
    if (session?.firstMessageAt) subAgents.push({ path: record.path, firstMessageMs: Date.parse(session.firstMessageAt) });
  }
  subAgents.sort((a, b) => a.firstMessageMs - b.firstMessageMs || a.path.localeCompare(b.path));

  for (const { path } of subAgents) {
    blocks.push({
      key: path.slice(siblingDir.length + 1),
      kind: "sub-agent",
      path,
      load: async () => {
        const session = await reader.readTranscript(path);
        if (!session) return null;
        const agentId = agentNameOr(session.provenance.agent_id, "");
        return {
          messages: session.messages,
          agentName: agentId || SUB_AGENT_FALLBACK_PERSONA,
          hasIdentity: agentId !== "",
          provenance: session.provenance,
        };
      },
    });
  }

  return blocks;
}

/**
 * Imports one tree's blocks, one at a time. Returns true when the call must end:
 * a block's scans were queued (the next block waits for the queue to drain), the
 * queue was busy, the import was aborted, or the tree finished having queued
 * scans. Returns false only for a tree that finished with nothing queued, so the
 * caller moves on to the next one.
 *
 * `plannedAtMs` bounds the window: with `W_prev` the tree's stored watermark
 * (none: the beginning of time), messages at or before it are stored pre-marked
 * (never extracted), messages after it and at or before `plannedAtMs` are
 * extracted, later ones are left for a later pass. `plannedAtMs` becomes the
 * watermark once every block has been handled. `done` holds the keys of blocks
 * whose scans were already queued by an earlier call.
 */
async function importTree(env: Env, tree: OmpTree, plannedAtMs: number, done: string[]): Promise<boolean> {
  const { stateManager, eiInterface, signal, result } = env;
  const plannedAt = new Date(plannedAtMs).toISOString();
  const watermark = stateManager.getHuman().settings?.omp?.processed_sessions?.[tree.id];
  const previousMs = watermark ? Date.parse(watermark) : -Infinity;

  const blocks = await planBlocks(env, tree);

  for (const [index, block] of blocks.entries()) {
    if (signal?.aborted) return true;
    if (done.includes(block.key)) continue;

    const loaded = await block.load();
    if (!loaded) continue;

    const before = loaded.messages.filter((m) => Date.parse(m.timestamp) <= previousMs);
    const inWindow = loaded.messages.filter((m) => {
      const ms = Date.parse(m.timestamp);
      return ms > previousMs && ms <= plannedAtMs;
    });
    if (inWindow.length === 0) continue;

    // One block per persona at a time: nothing starts while earlier scans are pending.
    if (stateManager.queue_length() > 0) return true;

    const persona = await ensureAgentPersona(loaded.agentName, {
      stateManager,
      interface: eiInterface,
      creation: block.kind,
    });

    const external = stateManager.messages_get(persona.id).filter((m) => m.external === true);
    if (external.length > 0) {
      stateManager.messages_remove(persona.id, external.map((m) => m.id));
    }

    const convertOptions = { parentSpeaker: block.kind === "sub-agent" };
    for (const message of before) {
      stateManager.messages_append(persona.id, convertToPreMarkedEiMessage(message, block.path, qualifyOmpMessage, convertOptions));
    }
    const toAnalyze: Message[] = inWindow.map((m) => convertToEiMessage(m, block.path, qualifyOmpMessage, convertOptions));
    for (const message of toAnalyze) {
      stateManager.messages_append(persona.id, message);
    }
    stateManager.messages_sort(persona.id);
    eiInterface?.onMessageAdded?.(persona.id);

    const allInState = stateManager.messages_get(persona.id);
    const analyzeIds = new Set(toAnalyze.map((m) => m.id));
    const analyzeStartIndex = allInState.findIndex((m) => analyzeIds.has(m.id));
    const context: ExtractionContext = {
      personaId: persona.id,
      channelDisplayName: persona.display_name,
      messages_context: analyzeStartIndex > 0 ? allInState.slice(0, analyzeStartIndex) : [],
      messages_analyze: toAnalyze,
      sources: [`omp:${getMachineId()}:${block.path}`],
    };

    const extractionModel = stateManager.getHuman().settings?.omp?.extraction_model;
    const queuedBefore = stateManager.queue_length();
    queueAllScans(context, stateManager, { extraction_model: extractionModel, external_filter: "only" });

    // A direct signal scan needs an agent the transcript actually names, an
    // unarchived persona and exactly one linked Person; any of those missing
    // skips only this scan.
    if (block.kind === "sub-agent" && loaded.hasIdentity && !persona.is_archived) {
      const linkedPeople = resolvePersonaLinkedPeople(persona.id, stateManager.getHuman().people);
      if (linkedPeople.length === 1) {
        queuePersonaSignalScan(context, persona, linkedPeople[0].id, stateManager, extractionModel, loaded.provenance);
      }
    }
    result.scansQueued += stateManager.queue_length() - queuedBefore;
    result.blocksQueued++;

    // Recorded only now that the scans are queued, so a crash before this point redoes the block.
    done = [...done, block.key];
    updateOmpSettings(stateManager, { current_tree: { tree: tree.id, planned_at: plannedAt, done } });
    console.log(`[OMP] Queued ${inWindow.length} message(s) from ${stripControlChars(block.key)}`);

    if (index < blocks.length - 1) return true;
    break;
  }

  // Every block has been handled. The rewrite phases follow a tree that queued
  // scans (now, or before a restart); the watermark and the cursor clear together.
  if (done.length > 0) {
    queuePersonRewritePhase(stateManager);
    queueTopicRewritePhase(stateManager);
  }
  const processedSessions = stateManager.getHuman().settings?.omp?.processed_sessions;
  updateOmpSettings(stateManager, {
    processed_sessions: { ...processedSessions, [tree.id]: plannedAt },
    current_tree: undefined,
  });
  result.treesCompleted++;
  return done.length > 0;
}

/** True while any file in the tree (its newest mtime) is younger than the quiet period. */
function isActive(tree: OmpTree, nowMs: number): boolean {
  return nowMs - Math.floor(tree.newestMtimeMs) < MIN_SESSION_AGE_MS;
}

/**
 * Imports the session trees under the OMP sessions root, one block at a time.
 *
 * A call finishes trees that need nothing queued and returns as soon as a block
 * queues scans, or a tree that queued some completes: the sync manager calls it
 * again once the queue has drained, and it resumes from the `current_tree`
 * cursor. Trees are taken oldest first by their newest file mtime; a tree whose
 * newest mtime is at or before its watermark is skipped without opening a file,
 * and a tree with any file younger than the quiet period waits for a later pass.
 */
export async function importOmpSessions(options: OmpImporterOptions): Promise<OmpImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const result: OmpImportResult = { treesCompleted: 0, blocksQueued: 0, scansQueued: 0 };
  if (stateManager.getHuman().settings?.omp?.integration !== true) return result;

  const reader = options.reader ?? new OmpReader();
  const now = options.now ?? Date.now;
  const env: Env = { stateManager, eiInterface, reader, signal, result };

  const trees = await reader.listTrees();
  if (signal?.aborted) return result;
  trees.sort((a, b) => a.newestMtimeMs - b.newestMtimeMs);

  // A tree in progress resumes first, with its original planning time.
  const cursor = stateManager.getHuman().settings?.omp?.current_tree;
  const resumed = cursor && trees.find((t) => t.id === cursor.tree);
  if (resumed) {
    if (isActive(resumed, now())) return result;
    if (await importTree(env, resumed, Date.parse(cursor.planned_at), cursor.done)) return result;
  }

  for (const tree of trees) {
    if (signal?.aborted) break;

    const watermark = stateManager.getHuman().settings?.omp?.processed_sessions?.[tree.id];
    if (watermark && Math.floor(tree.newestMtimeMs) <= Date.parse(watermark)) continue;

    const plannedAtMs = now();
    if (isActive(tree, plannedAtMs)) continue;
    if (await importTree(env, tree, plannedAtMs, [])) break;
  }
  return result;
}
